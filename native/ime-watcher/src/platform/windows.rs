use crate::protocol::{create_unknown_snapshot, ProbeSnapshot};
    use crate::output::{details_object, write_log};
    use crate::platform::format_handle;
    use crate::CANCELLED;
    use std::mem;
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Mutex};

    type Hwnd = isize;
    type Himc = isize;
    type Hkl = isize;
    type Lresult = isize;
    type Lparam = isize;
    type Wparam = usize;
    type Bool = i32;
    type Dword = u32;
    type Uint = u32;

    const WM_IME_CONTROL: Uint = 0x0283;
    const IMC_GETOPENSTATUS: Wparam = 0x0005;
    const SMTO_ABORTIFHUNG: Uint = 0x0002;
    const SMTO_BLOCK: Uint = 0x0001;

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct GuiThreadInfo {
        cb_size: Dword,
        flags: Dword,
        hwnd_active: Hwnd,
        hwnd_focus: Hwnd,
        hwnd_capture: Hwnd,
        hwnd_menu_owner: Hwnd,
        hwnd_move_size: Hwnd,
        hwnd_caret: Hwnd,
        rc_caret: Rect,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut Dword) -> Dword;
        fn GetGUIThreadInfo(thread_id: Dword, info: *mut GuiThreadInfo) -> Bool;
        fn GetKeyboardLayout(thread_id: Dword) -> Hkl;
        fn SendMessageTimeoutW(
            hwnd: Hwnd,
            msg: Uint,
            w_param: Wparam,
            l_param: Lparam,
            flags: Uint,
            timeout: Uint,
            result: *mut Lresult,
        ) -> Lresult;
        fn SetConsoleCtrlHandler(
            handler: Option<unsafe extern "system" fn(Dword) -> Bool>,
            add: Bool,
        ) -> Bool;
    }

    #[link(name = "imm32")]
    unsafe extern "system" {
        fn ImmGetContext(hwnd: Hwnd) -> Himc;
        fn ImmGetDefaultIMEWnd(hwnd: Hwnd) -> Hwnd;
        fn ImmReleaseContext(hwnd: Hwnd, himc: Himc) -> Bool;
        fn ImmGetOpenStatus(himc: Himc) -> Bool;
        fn ImmGetDescriptionW(hkl: Hkl, description: *mut u16, buffer_len: Uint) -> Uint;
    }

    pub unsafe fn set_console_cancel_handler() {
        let _ = SetConsoleCtrlHandler(Some(console_ctrl_handler), 1);
    }

    unsafe extern "system" fn console_ctrl_handler(_ctrl_type: Dword) -> Bool {
        CANCELLED.store(true, Ordering::SeqCst);
        1
    }

    pub fn probe_current_state(
        ime_context_failure_logged: &mut bool,
        output_lock: &Arc<Mutex<()>>,
    ) -> ProbeSnapshot {
        unsafe {
            let foreground_window = GetForegroundWindow();
            if foreground_window == 0 {
                return create_unknown_snapshot(
                    "foreground-window-missing",
                    0.0,
                    false,
                    None,
                    None,
                    None,
                    None,
                    None,
                );
            }

            let mut process_id = 0;
            let mut thread_id = GetWindowThreadProcessId(foreground_window, &mut process_id);
            if thread_id == 0 {
                return create_unknown_snapshot(
                    "thread-id-missing",
                    0.0,
                    false,
                    None,
                    None,
                    None,
                    None,
                    Some(format_handle(foreground_window)),
                );
            }

            let mut gui_thread_info = GuiThreadInfo {
                cb_size: mem::size_of::<GuiThreadInfo>() as Dword,
                flags: 0,
                hwnd_active: 0,
                hwnd_focus: 0,
                hwnd_capture: 0,
                hwnd_menu_owner: 0,
                hwnd_move_size: 0,
                hwnd_caret: 0,
                rc_caret: Rect {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                },
            };

            let has_gui_thread_info = GetGUIThreadInfo(thread_id, &mut gui_thread_info) != 0;
            let focus_handle = if has_gui_thread_info && gui_thread_info.hwnd_focus != 0 {
                gui_thread_info.hwnd_focus
            } else if has_gui_thread_info && gui_thread_info.hwnd_active != 0 {
                gui_thread_info.hwnd_active
            } else {
                foreground_window
            };

            let focus_thread_id = GetWindowThreadProcessId(focus_handle, &mut process_id);
            if focus_thread_id != 0 {
                thread_id = focus_thread_id;
            }

            let keyboard_layout = GetKeyboardLayout(thread_id);
            if keyboard_layout == 0 {
                return create_unknown_snapshot(
                    "keyboard-layout-missing",
                    0.0,
                    false,
                    None,
                    None,
                    None,
                    Some(thread_id),
                    Some(format_handle(focus_handle)),
                );
            }

            let layout_hex = format!("{:04X}", keyboard_layout as usize & 0xFFFF);
            let Some(is_chinese_layout) = resolve_is_chinese_layout(keyboard_layout) else {
                return create_unknown_snapshot(
                    "keyboard-layout-unrecognized",
                    0.0,
                    false,
                    None,
                    None,
                    Some(layout_hex),
                    Some(thread_id),
                    Some(format_handle(focus_handle)),
                );
            };

            let ime_name = get_ime_description(keyboard_layout);
            let input_context = ImmGetContext(focus_handle);
            if input_context == 0 {
                if !*ime_context_failure_logged {
                    *ime_context_failure_logged = true;
                    write_log(
                        "warn",
                        "ImmGetContext 返回空句柄，正在尝试默认 IME 窗口回退方案。",
                        Some(details_object(&[("threadId", thread_id.to_string())])),
                        output_lock,
                    );
                }

                if let Some((fallback_is_open, fallback_ime_window)) =
                    get_open_status_from_default_ime_window(focus_handle, foreground_window)
                {
                    return build_snapshot_from_open_status(
                        is_chinese_layout,
                        fallback_is_open,
                        ime_name,
                        layout_hex,
                        thread_id,
                        focus_handle,
                        &format!("default-ime-window-{fallback_ime_window}-after-null-context"),
                        0.85,
                    );
                }

                return create_unknown_snapshot(
                    "ime-context-missing",
                    0.0,
                    false,
                    ime_name,
                    None,
                    Some(layout_hex),
                    Some(thread_id),
                    Some(format_handle(focus_handle)),
                );
            }

            let is_open = ImmGetOpenStatus(input_context) != 0;
            let _ = ImmReleaseContext(focus_handle, input_context);

            if is_chinese_layout {
                return ProbeSnapshot {
                    state: if is_open { "cn" } else { "en" },
                    ime_name,
                    is_open: Some(is_open),
                    layout_hex: Some(layout_hex),
                    thread_id: Some(thread_id),
                    hwnd: Some(format_handle(focus_handle)),
                    reason: if is_open {
                        "confirmed-open-chinese-layout".to_string()
                    } else {
                        "confirmed-closed-chinese-layout".to_string()
                    },
                    confidence: 1.0,
                    raw_state_available: true,
                };
            }

            if !is_open {
                return ProbeSnapshot {
                    state: "en",
                    ime_name,
                    is_open: Some(is_open),
                    layout_hex: Some(layout_hex),
                    thread_id: Some(thread_id),
                    hwnd: Some(format_handle(focus_handle)),
                    reason: "confirmed-closed-non-chinese-layout".to_string(),
                    confidence: 1.0,
                    raw_state_available: true,
                };
            }

            create_unknown_snapshot(
                "open-non-chinese-layout-conflict",
                0.25,
                true,
                ime_name,
                Some(is_open),
                Some(layout_hex),
                Some(thread_id),
                Some(format_handle(focus_handle)),
            )
        }
    }

    fn build_snapshot_from_open_status(
        is_chinese_layout: bool,
        is_open: bool,
        ime_name: Option<String>,
        layout_hex: String,
        thread_id: u32,
        focus_handle: Hwnd,
        reason_prefix: &str,
        confidence: f64,
    ) -> ProbeSnapshot {
        if is_chinese_layout {
            return ProbeSnapshot {
                state: if is_open { "cn" } else { "en" },
                ime_name,
                is_open: Some(is_open),
                layout_hex: Some(layout_hex),
                thread_id: Some(thread_id),
                hwnd: Some(format_handle(focus_handle)),
                reason: if is_open {
                    format!("{reason_prefix}-open-chinese-layout")
                } else {
                    format!("{reason_prefix}-closed-chinese-layout")
                },
                confidence,
                raw_state_available: true,
            };
        }

        if !is_open {
            return ProbeSnapshot {
                state: "en",
                ime_name,
                is_open: Some(is_open),
                layout_hex: Some(layout_hex),
                thread_id: Some(thread_id),
                hwnd: Some(format_handle(focus_handle)),
                reason: format!("{reason_prefix}-closed-non-chinese-layout"),
                confidence,
                raw_state_available: true,
            };
        }

        create_unknown_snapshot(
            &format!("{reason_prefix}-open-non-chinese-layout-conflict"),
            0.25,
            true,
            ime_name,
            Some(is_open),
            Some(layout_hex),
            Some(thread_id),
            Some(format_handle(focus_handle)),
        )
    }

    unsafe fn get_open_status_from_default_ime_window(
        focus_handle: Hwnd,
        foreground_window: Hwnd,
    ) -> Option<(bool, String)> {
        for owner_handle in [focus_handle, foreground_window] {
            if owner_handle == 0 {
                continue;
            }

            let default_ime_window = ImmGetDefaultIMEWnd(owner_handle);
            if default_ime_window == 0 {
                continue;
            }

            let mut open_status_result: Lresult = 0;
            let send_result = SendMessageTimeoutW(
                default_ime_window,
                WM_IME_CONTROL,
                IMC_GETOPENSTATUS,
                0,
                SMTO_ABORTIFHUNG | SMTO_BLOCK,
                100,
                &mut open_status_result,
            );

            if send_result == 0 {
                continue;
            }

            return Some((open_status_result != 0, format_handle(default_ime_window)));
        }

        None
    }

    unsafe fn get_ime_description(keyboard_layout: Hkl) -> Option<String> {
        let mut buffer = [0u16; 256];
        let length = ImmGetDescriptionW(
            keyboard_layout,
            buffer.as_mut_ptr(),
            buffer.len() as Uint,
        ) as usize;
        if length == 0 {
            return None;
        }

        let capped_length = length.min(buffer.len());
        let description = String::from_utf16_lossy(&buffer[..capped_length])
            .trim_matches(char::from(0))
            .trim()
            .to_string();
        if description.is_empty() {
            None
        } else {
            Some(description)
        }
    }

    fn resolve_is_chinese_layout(keyboard_layout: Hkl) -> Option<bool> {
        let low_word = (keyboard_layout as usize & 0xFFFF) as u16;
        let primary_language_id = low_word & 0x03FF;
        if primary_language_id == 0 {
            return None;
        }

        Some(primary_language_id == 0x0004)
    }
