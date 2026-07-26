use crate::classify::Classification;
use crate::output::{details_object, write_log};
use crate::platform::format_handle;
use crate::protocol::{create_unknown_snapshot, ProbeSnapshot};
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
const IMC_GETCONVERSIONMODE: Wparam = 0x0001;
const SMTO_ABORTIFHUNG: Uint = 0x0002;
const SMTO_BLOCK: Uint = 0x0001;
const IME_CMODE_NATIVE: u32 = 0x0001;

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
    fn ImmGetConversionStatus(himc: Himc, conversion: *mut Dword, sentence: *mut Dword) -> Bool;
    fn ImmGetDescriptionW(hkl: Hkl, description: *mut u16, buffer_len: Uint) -> Uint;
}

pub unsafe fn set_console_cancel_handler() {
    let _ = unsafe { SetConsoleCtrlHandler(Some(console_ctrl_handler), 1) };
}

unsafe extern "system" fn console_ctrl_handler(_ctrl_type: Dword) -> Bool {
    CANCELLED.store(true, Ordering::SeqCst);
    1
}

/// RAII guard for an `ImmGetContext` handle. Releasing in `Drop` guarantees the
/// context cannot leak on any early-return path added later.
struct HimcGuard {
    hwnd: Hwnd,
    himc: Himc,
}

impl HimcGuard {
    fn acquire(hwnd: Hwnd) -> Option<Self> {
        let himc = unsafe { ImmGetContext(hwnd) };
        if himc == 0 {
            None
        } else {
            Some(Self { hwnd, himc })
        }
    }

    fn open_status(&self) -> bool {
        unsafe { ImmGetOpenStatus(self.himc) != 0 }
    }

    fn conversion_mode(&self) -> Option<u32> {
        let mut conversion: Dword = 0;
        let mut sentence: Dword = 0;
        let succeeded =
            unsafe { ImmGetConversionStatus(self.himc, &mut conversion, &mut sentence) != 0 };
        succeeded.then_some(conversion)
    }
}

impl Drop for HimcGuard {
    fn drop(&mut self) {
        let _ = unsafe { ImmReleaseContext(self.hwnd, self.himc) };
    }
}

/// Where the raw open/conversion status came from. Determines the reason
/// strings and the confidence attached to the decision.
enum OpenStatusSource {
    /// `ImmGetContext` on the focus window succeeded.
    Direct,
    /// `WM_IME_CONTROL` against the default IME window of the given handle.
    DefaultImeWindow(String),
}

struct DefaultImeWindowStatus {
    is_open: bool,
    conversion_mode: Option<u32>,
    window: String,
}

pub fn probe_current_state(
    ime_context_failure_logged: &mut bool,
    output_lock: &Arc<Mutex<()>>,
) -> ProbeSnapshot {
    let foreground_window = get_foreground_window();
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

    let mut thread_id = get_window_thread_id(foreground_window);
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

    let focus_handle = get_focus_handle(thread_id, foreground_window);
    let focus_thread_id = get_window_thread_id(focus_handle);
    if focus_thread_id != 0 {
        thread_id = focus_thread_id;
    }

    let keyboard_layout = get_keyboard_layout(thread_id);
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
    let Some(input_context) = HimcGuard::acquire(focus_handle) else {
        if !*ime_context_failure_logged {
            *ime_context_failure_logged = true;
            write_log(
                "warn",
                "ImmGetContext 返回空句柄，正在尝试默认 IME 窗口回退方案。",
                Some(details_object(&[("threadId", thread_id.to_string())])),
                output_lock,
            );
        }

        if let Some(fallback) =
            get_open_status_from_default_ime_window(focus_handle, foreground_window)
        {
            return build_snapshot_from_open_status(
                is_chinese_layout,
                fallback.is_open,
                fallback.conversion_mode,
                &OpenStatusSource::DefaultImeWindow(fallback.window),
                ime_name,
                layout_hex,
                thread_id,
                focus_handle,
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
    };

    let is_open = input_context.open_status();
    let conversion_mode = input_context.conversion_mode();
    drop(input_context);

    build_snapshot_from_open_status(
        is_chinese_layout,
        is_open,
        conversion_mode,
        &OpenStatusSource::Direct,
        ime_name,
        layout_hex,
        thread_id,
        focus_handle,
    )
}

#[allow(clippy::too_many_arguments)]
fn build_snapshot_from_open_status(
    is_chinese_layout: bool,
    is_open: bool,
    conversion_mode: Option<u32>,
    source: &OpenStatusSource,
    ime_name: Option<String>,
    layout_hex: String,
    thread_id: u32,
    focus_handle: Hwnd,
) -> ProbeSnapshot {
    let conversion_native = conversion_mode.map(is_native_conversion_mode);
    let classification = classify_open_status(is_chinese_layout, is_open, conversion_native, source);

    if classification.state == "unknown" {
        let mut snapshot = create_unknown_snapshot(
            &classification.reason,
            classification.confidence,
            true,
            ime_name,
            Some(is_open),
            Some(layout_hex),
            Some(thread_id),
            Some(format_handle(focus_handle)),
        );
        snapshot.conversion_native = conversion_native;
        return snapshot;
    }

    ProbeSnapshot {
        state: classification.state,
        ime_name,
        is_open: Some(is_open),
        conversion_native,
        layout_hex: Some(layout_hex),
        thread_id: Some(thread_id),
        hwnd: Some(format_handle(focus_handle)),
        reason: classification.reason,
        confidence: classification.confidence,
        raw_state_available: true,
    }
}

/// 纯决策核心：把「布局 + open status + conversion mode」映射为状态。
///
/// 搜狗/微信/QQ 等输入法的内部 Shift 中英切换只改 conversion mode 的
/// `IME_CMODE_NATIVE` 位而不改 open status，所以中文布局 + open=true 时必须再看
/// conversion 位；读不到 conversion 时诚实降级为低置信度的 cn。
fn classify_open_status(
    is_chinese_layout: bool,
    is_open: bool,
    conversion_native: Option<bool>,
    source: &OpenStatusSource,
) -> Classification {
    let base_confidence = match source {
        OpenStatusSource::Direct => 1.0,
        OpenStatusSource::DefaultImeWindow(_) => 0.85,
    };

    if is_chinese_layout {
        if !is_open {
            return Classification {
                state: "en",
                reason: open_status_reason(source, "closed-chinese-layout"),
                confidence: base_confidence,
            };
        }

        return match conversion_native {
            Some(true) => Classification {
                state: "cn",
                reason: open_status_reason(source, "open-chinese-layout"),
                confidence: base_confidence,
            },
            Some(false) => Classification {
                state: "en",
                reason: open_status_reason(source, "open-chinese-layout-ascii-conversion"),
                confidence: base_confidence,
            },
            None => Classification {
                state: "cn",
                reason: open_status_reason(source, "open-chinese-layout-conversion-unavailable"),
                confidence: base_confidence.min(0.6),
            },
        };
    }

    if !is_open {
        return Classification {
            state: "en",
            reason: open_status_reason(source, "closed-non-chinese-layout"),
            confidence: base_confidence,
        };
    }

    Classification {
        state: "unknown",
        reason: match source {
            OpenStatusSource::Direct => "open-non-chinese-layout-conflict".to_string(),
            OpenStatusSource::DefaultImeWindow(window) => format!(
                "default-ime-window-{window}-after-null-context-open-non-chinese-layout-conflict"
            ),
        },
        confidence: 0.25,
    }
}

fn open_status_reason(source: &OpenStatusSource, suffix: &str) -> String {
    match source {
        OpenStatusSource::Direct => format!("confirmed-{suffix}"),
        OpenStatusSource::DefaultImeWindow(window) => {
            format!("default-ime-window-{window}-after-null-context-{suffix}")
        }
    }
}

fn is_native_conversion_mode(conversion_mode: u32) -> bool {
    conversion_mode & IME_CMODE_NATIVE != 0
}

fn get_foreground_window() -> Hwnd {
    unsafe { GetForegroundWindow() }
}

fn get_window_thread_id(hwnd: Hwnd) -> Dword {
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) }
}

fn get_focus_handle(thread_id: Dword, foreground_window: Hwnd) -> Hwnd {
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

    let has_gui_thread_info = unsafe { GetGUIThreadInfo(thread_id, &mut gui_thread_info) != 0 };
    if has_gui_thread_info && gui_thread_info.hwnd_focus != 0 {
        gui_thread_info.hwnd_focus
    } else if has_gui_thread_info && gui_thread_info.hwnd_active != 0 {
        gui_thread_info.hwnd_active
    } else {
        foreground_window
    }
}

fn get_keyboard_layout(thread_id: Dword) -> Hkl {
    unsafe { GetKeyboardLayout(thread_id) }
}

fn get_open_status_from_default_ime_window(
    focus_handle: Hwnd,
    foreground_window: Hwnd,
) -> Option<DefaultImeWindowStatus> {
    for owner_handle in [focus_handle, foreground_window] {
        if owner_handle == 0 {
            continue;
        }

        let default_ime_window = unsafe { ImmGetDefaultIMEWnd(owner_handle) };
        if default_ime_window == 0 {
            continue;
        }

        let Some(open_status_result) = send_ime_control(default_ime_window, IMC_GETOPENSTATUS)
        else {
            continue;
        };

        let conversion_mode = send_ime_control(default_ime_window, IMC_GETCONVERSIONMODE)
            .map(|result| result as u32);

        return Some(DefaultImeWindowStatus {
            is_open: open_status_result != 0,
            conversion_mode,
            window: format_handle(default_ime_window),
        });
    }

    None
}

fn send_ime_control(default_ime_window: Hwnd, command: Wparam) -> Option<Lresult> {
    let mut message_result: Lresult = 0;
    let send_result = unsafe {
        SendMessageTimeoutW(
            default_ime_window,
            WM_IME_CONTROL,
            command,
            0,
            SMTO_ABORTIFHUNG | SMTO_BLOCK,
            100,
            &mut message_result,
        )
    };

    if send_result == 0 {
        None
    } else {
        Some(message_result)
    }
}

fn get_ime_description(keyboard_layout: Hkl) -> Option<String> {
    let mut buffer = [0u16; 256];
    let length = unsafe {
        ImmGetDescriptionW(keyboard_layout, buffer.as_mut_ptr(), buffer.len() as Uint)
    } as usize;
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

#[cfg(test)]
mod tests {
    use super::{
        build_snapshot_from_open_status, classify_open_status, is_native_conversion_mode,
        OpenStatusSource, IME_CMODE_NATIVE,
    };

    fn fallback_source() -> OpenStatusSource {
        OpenStatusSource::DefaultImeWindow("0x1A2B".to_string())
    }

    #[test]
    fn chinese_layout_open_with_ascii_conversion_is_english() {
        // 搜狗/微信/QQ 按 Shift 切英文：open 仍为 true，NATIVE 位被清掉。
        let direct = classify_open_status(true, true, Some(false), &OpenStatusSource::Direct);
        assert_eq!(direct.state, "en");
        assert_eq!(direct.reason, "confirmed-open-chinese-layout-ascii-conversion");
        assert_eq!(direct.confidence, 1.0);

        let fallback = classify_open_status(true, true, Some(false), &fallback_source());
        assert_eq!(fallback.state, "en");
        assert_eq!(
            fallback.reason,
            "default-ime-window-0x1A2B-after-null-context-open-chinese-layout-ascii-conversion"
        );
        assert_eq!(fallback.confidence, 0.85);
    }

    #[test]
    fn chinese_layout_open_with_native_conversion_is_chinese() {
        let direct = classify_open_status(true, true, Some(true), &OpenStatusSource::Direct);
        assert_eq!(direct.state, "cn");
        assert_eq!(direct.reason, "confirmed-open-chinese-layout");
        assert_eq!(direct.confidence, 1.0);

        let fallback = classify_open_status(true, true, Some(true), &fallback_source());
        assert_eq!(fallback.state, "cn");
        assert_eq!(
            fallback.reason,
            "default-ime-window-0x1A2B-after-null-context-open-chinese-layout"
        );
        assert_eq!(fallback.confidence, 0.85);
    }

    #[test]
    fn chinese_layout_open_without_conversion_degrades_confidence() {
        let direct = classify_open_status(true, true, None, &OpenStatusSource::Direct);
        assert_eq!(direct.state, "cn");
        assert_eq!(
            direct.reason,
            "confirmed-open-chinese-layout-conversion-unavailable"
        );
        assert_eq!(direct.confidence, 0.6);

        let fallback = classify_open_status(true, true, None, &fallback_source());
        assert_eq!(fallback.state, "cn");
        assert_eq!(
            fallback.reason,
            "default-ime-window-0x1A2B-after-null-context-open-chinese-layout-conversion-unavailable"
        );
        assert_eq!(fallback.confidence, 0.6);
    }

    #[test]
    fn chinese_layout_closed_is_english_regardless_of_conversion() {
        for conversion_native in [Some(true), Some(false), None] {
            let direct =
                classify_open_status(true, false, conversion_native, &OpenStatusSource::Direct);
            assert_eq!(direct.state, "en");
            assert_eq!(direct.reason, "confirmed-closed-chinese-layout");
            assert_eq!(direct.confidence, 1.0);
        }

        let fallback = classify_open_status(true, false, None, &fallback_source());
        assert_eq!(
            fallback.reason,
            "default-ime-window-0x1A2B-after-null-context-closed-chinese-layout"
        );
        assert_eq!(fallback.confidence, 0.85);
    }

    #[test]
    fn non_chinese_layout_keeps_existing_semantics() {
        for conversion_native in [Some(true), Some(false), None] {
            let closed =
                classify_open_status(false, false, conversion_native, &OpenStatusSource::Direct);
            assert_eq!(closed.state, "en");
            assert_eq!(closed.reason, "confirmed-closed-non-chinese-layout");
            assert_eq!(closed.confidence, 1.0);

            let conflict =
                classify_open_status(false, true, conversion_native, &OpenStatusSource::Direct);
            assert_eq!(conflict.state, "unknown");
            assert_eq!(conflict.reason, "open-non-chinese-layout-conflict");
            assert_eq!(conflict.confidence, 0.25);
        }

        let fallback_conflict = classify_open_status(false, true, None, &fallback_source());
        assert_eq!(fallback_conflict.state, "unknown");
        assert_eq!(
            fallback_conflict.reason,
            "default-ime-window-0x1A2B-after-null-context-open-non-chinese-layout-conflict"
        );
        assert_eq!(fallback_conflict.confidence, 0.25);
    }

    #[test]
    fn maps_conversion_mode_bits_to_native_flag() {
        assert!(is_native_conversion_mode(IME_CMODE_NATIVE));
        assert!(is_native_conversion_mode(IME_CMODE_NATIVE | 0x0400));
        assert!(!is_native_conversion_mode(0));
        assert!(!is_native_conversion_mode(0x0400));
    }

    #[test]
    fn snapshot_carries_conversion_native_diagnostics() {
        let english = build_snapshot_from_open_status(
            true,
            true,
            Some(0),
            &OpenStatusSource::Direct,
            Some("Sogou Pinyin".to_string()),
            "0804".to_string(),
            42,
            0x1234,
        );
        assert_eq!(english.state, "en");
        assert_eq!(english.conversion_native, Some(false));
        assert_eq!(english.is_open, Some(true));
        assert!(english.raw_state_available);

        let degraded = build_snapshot_from_open_status(
            true,
            true,
            None,
            &OpenStatusSource::Direct,
            None,
            "0804".to_string(),
            42,
            0x1234,
        );
        assert_eq!(degraded.state, "cn");
        assert_eq!(degraded.conversion_native, None);
        assert_eq!(degraded.confidence, 0.6);

        let conflict = build_snapshot_from_open_status(
            false,
            true,
            Some(IME_CMODE_NATIVE),
            &OpenStatusSource::Direct,
            None,
            "0409".to_string(),
            42,
            0x1234,
        );
        assert_eq!(conflict.state, "unknown");
        assert_eq!(conflict.conversion_native, Some(true));
        assert_eq!(conflict.confidence, 0.25);
    }
}
