use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

const PROTOCOL_VERSION: u32 = 1;
static CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq)]
struct ProbeSnapshot {
    state: &'static str,
    ime_name: Option<String>,
    is_open: Option<bool>,
    layout_hex: Option<String>,
    thread_id: Option<u32>,
    hwnd: Option<String>,
    reason: String,
    confidence: f64,
    raw_state_available: bool,
}

enum Command {
    Refresh,
    Shutdown,
}

fn main() {
    setup_console_cancel_handler();
    let output_lock = Arc::new(Mutex::new(()));

    write_hello(&output_lock);

    let once = std::env::args().any(|argument| argument.eq_ignore_ascii_case("--once"));
    let mut last_snapshot = None;
    let mut ime_context_failure_logged = false;

    if once {
        emit_snapshot(
            true,
            &mut last_snapshot,
            &mut ime_context_failure_logged,
            &output_lock,
        );
        return;
    }

    let (tx, rx) = mpsc::channel();
    let reader_lock = Arc::clone(&output_lock);
    thread::spawn(move || read_commands(tx, reader_lock));

    emit_snapshot(
        true,
        &mut last_snapshot,
        &mut ime_context_failure_logged,
        &output_lock,
    );

    if let Some(snapshot) = &last_snapshot {
        if snapshot.state == "unknown" {
            write_log(
                "warn",
                "Initial probe returned unknown. Continuing to watch because unknown can be a valid Electron/IME state.",
                Some(details_object(&[("Reason", json_string(&snapshot.reason))])),
                &output_lock,
            );
        }
    }

    while !CANCELLED.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(Command::Refresh) => emit_snapshot(
                true,
                &mut last_snapshot,
                &mut ime_context_failure_logged,
                &output_lock,
            ),
            Ok(Command::Shutdown) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => emit_snapshot(
                false,
                &mut last_snapshot,
                &mut ime_context_failure_logged,
                &output_lock,
            ),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    write_log(
        "info",
        "WinImeWatcher cancellation requested.",
        None,
        &output_lock,
    );
}

fn read_commands(tx: mpsc::Sender<Command>, output_lock: Arc<Mutex<()>>) {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                write_log(
                    "warn",
                    "Failed to read command line from stdin.",
                    Some(details_object(&[("error", json_string(&error.to_string()))])),
                    &output_lock,
                );
                break;
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match is_refresh_command(trimmed) {
            Ok(true) => {
                if tx.send(Command::Refresh).is_err() {
                    return;
                }
            }
            Ok(false) => {}
            Err(error) => {
                write_log(
                    "warn",
                    "Failed to parse command JSON.",
                    Some(details_object(&[
                        ("line", json_string(trimmed)),
                        ("error", json_string(&error)),
                    ])),
                    &output_lock,
                );
            }
        }
    }

    write_log(
        "info",
        "WinImeWatcher stdin closed. Shutting down.",
        None,
        &output_lock,
    );
    let _ = tx.send(Command::Shutdown);
}

fn emit_snapshot(
    force: bool,
    last_snapshot: &mut Option<ProbeSnapshot>,
    ime_context_failure_logged: &mut bool,
    output_lock: &Arc<Mutex<()>>,
) {
    let snapshot = probe_current_state(ime_context_failure_logged, output_lock);
    if !force && last_snapshot.as_ref() == Some(&snapshot) {
        return;
    }

    write_state(&snapshot, output_lock);
    *last_snapshot = Some(snapshot);
}

fn write_hello(output_lock: &Arc<Mutex<()>>) {
    write_json_line(
        r#"{"type":"hello","version":1,"capabilities":["state","log"]}"#,
        false,
        output_lock,
    );
}

fn write_state(snapshot: &ProbeSnapshot, output_lock: &Arc<Mutex<()>>) {
    let mut fields = vec![
        json_field("type", json_string("state")),
        json_field("state", json_string(snapshot.state)),
        json_field("timestamp", json_string(&utc_timestamp())),
        json_field("source", json_string("native-helper")),
    ];

    if let Some(value) = &snapshot.ime_name {
        fields.push(json_field("imeName", json_string(value)));
    }
    if let Some(value) = snapshot.is_open {
        fields.push(json_field("isOpen", value.to_string()));
    }
    if let Some(value) = &snapshot.layout_hex {
        fields.push(json_field("layoutHex", json_string(value)));
    }
    if let Some(value) = snapshot.thread_id {
        fields.push(json_field("threadId", value.to_string()));
    }
    if let Some(value) = &snapshot.hwnd {
        fields.push(json_field("hwnd", json_string(value)));
    }

    fields.push(json_field("reason", json_string(&snapshot.reason)));
    fields.push(json_field("confidence", format_float(snapshot.confidence)));
    fields.push(json_field(
        "rawStateAvailable",
        snapshot.raw_state_available.to_string(),
    ));

    write_json_line(&format!("{{{}}}", fields.join(",")), false, output_lock);
}

fn write_log(
    level: &str,
    message: &str,
    details: Option<String>,
    output_lock: &Arc<Mutex<()>>,
) {
    let mut fields = vec![
        json_field("type", json_string("log")),
        json_field("level", json_string(level)),
        json_field("timestamp", json_string(&utc_timestamp())),
        json_field("message", json_string(message)),
    ];

    if let Some(details) = details {
        fields.push(json_field("details", details));
    }

    fields.push(json_field("source", json_string("native-helper")));
    write_json_line(&format!("{{{}}}", fields.join(",")), true, output_lock);
}

fn write_json_line(line: &str, standard_error: bool, output_lock: &Arc<Mutex<()>>) {
    let _guard = output_lock.lock().expect("output lock poisoned");
    if standard_error {
        let mut stderr = io::stderr().lock();
        let _ = writeln!(stderr, "{line}");
        let _ = stderr.flush();
    } else {
        let mut stdout = io::stdout().lock();
        let _ = writeln!(stdout, "{line}");
        let _ = stdout.flush();
    }
}

fn json_field(key: &str, raw_value: String) -> String {
    format!("{}:{}", json_string(key), raw_value)
}

fn details_object(entries: &[(&str, String)]) -> String {
    let fields = entries
        .iter()
        .map(|(key, value)| json_field(key, value.clone()))
        .collect::<Vec<_>>();
    format!("{{{}}}", fields.join(","))
}

fn json_string(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0C}' => output.push_str("\\f"),
            c if c <= '\u{1F}' => output.push_str(&format!("\\u{:04X}", c as u32)),
            c => output.push(c),
        }
    }
    output.push('\"');
    output
}

fn format_float(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

fn is_refresh_command(line: &str) -> Result<bool, String> {
    let mut parser = JsonParser::new(line);
    parser.parse_object_for_refresh_command()
}

struct JsonParser<'a> {
    input: &'a str,
    position: usize,
}

impl<'a> JsonParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, position: 0 }
    }

    fn parse_object_for_refresh_command(&mut self) -> Result<bool, String> {
        self.skip_whitespace();
        self.expect_byte(b'{')?;
        self.skip_whitespace();

        if self.consume_byte(b'}') {
            self.skip_trailing_whitespace()?;
            return Ok(false);
        }

        loop {
            let key = self.parse_string()?;
            self.skip_whitespace();
            self.expect_byte(b':')?;
            self.skip_whitespace();

            if key.eq_ignore_ascii_case("command") {
                if self.peek_byte() == Some(b'\"') {
                    let value = self.parse_string()?;
                    if value.eq_ignore_ascii_case("refresh") {
                        self.skip_whitespace();
                        self.skip_object_tail()?;
                        self.skip_trailing_whitespace()?;
                        return Ok(true);
                    }
                } else {
                    self.skip_value()?;
                }
            } else {
                self.skip_value()?;
            }

            self.skip_whitespace();
            if self.consume_byte(b',') {
                self.skip_whitespace();
                continue;
            }
            if self.consume_byte(b'}') {
                self.skip_trailing_whitespace()?;
                return Ok(false);
            }
            return Err("expected ',' or '}' after object member".to_string());
        }
    }

    fn skip_object_tail(&mut self) -> Result<(), String> {
        self.skip_whitespace();
        while self.consume_byte(b',') {
            self.skip_whitespace();
            let _ = self.parse_string()?;
            self.skip_whitespace();
            self.expect_byte(b':')?;
            self.skip_whitespace();
            self.skip_value()?;
            self.skip_whitespace();
        }
        self.expect_byte(b'}')
    }

    fn skip_value(&mut self) -> Result<(), String> {
        self.skip_whitespace();
        match self.peek_byte() {
            Some(b'\"') => self.parse_string().map(|_| ()),
            Some(b'{') => self.skip_object_value(),
            Some(b'[') => self.skip_array_value(),
            Some(b't') => self.expect_literal("true"),
            Some(b'f') => self.expect_literal("false"),
            Some(b'n') => self.expect_literal("null"),
            Some(b'-' | b'0'..=b'9') => self.skip_number(),
            Some(_) => Err("unexpected JSON value".to_string()),
            None => Err("unexpected end of JSON value".to_string()),
        }
    }

    fn skip_object_value(&mut self) -> Result<(), String> {
        self.expect_byte(b'{')?;
        self.skip_whitespace();
        if self.consume_byte(b'}') {
            return Ok(());
        }

        loop {
            let _ = self.parse_string()?;
            self.skip_whitespace();
            self.expect_byte(b':')?;
            self.skip_whitespace();
            self.skip_value()?;
            self.skip_whitespace();
            if self.consume_byte(b',') {
                self.skip_whitespace();
                continue;
            }
            self.expect_byte(b'}')?;
            return Ok(());
        }
    }

    fn skip_array_value(&mut self) -> Result<(), String> {
        self.expect_byte(b'[')?;
        self.skip_whitespace();
        if self.consume_byte(b']') {
            return Ok(());
        }

        loop {
            self.skip_value()?;
            self.skip_whitespace();
            if self.consume_byte(b',') {
                self.skip_whitespace();
                continue;
            }
            self.expect_byte(b']')?;
            return Ok(());
        }
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.expect_byte(b'\"')?;
        let mut output = String::new();
        while let Some(byte) = self.next_byte() {
            match byte {
                b'\"' => return Ok(output),
                b'\\' => output.push(self.parse_escape()?),
                0x00..=0x1F => return Err("control character in JSON string".to_string()),
                _ => {
                    let start = self.position - 1;
                    let ch = self.input[start..]
                        .chars()
                        .next()
                        .ok_or_else(|| "invalid UTF-8 in JSON string".to_string())?;
                    self.position = start + ch.len_utf8();
                    output.push(ch);
                }
            }
        }
        Err("unterminated JSON string".to_string())
    }

    fn parse_escape(&mut self) -> Result<char, String> {
        match self.next_byte() {
            Some(b'\"') => Ok('\"'),
            Some(b'\\') => Ok('\\'),
            Some(b'/') => Ok('/'),
            Some(b'b') => Ok('\u{08}'),
            Some(b'f') => Ok('\u{0C}'),
            Some(b'n') => Ok('\n'),
            Some(b'r') => Ok('\r'),
            Some(b't') => Ok('\t'),
            Some(b'u') => {
                let code_point = self.parse_hex_quad()?;
                char::from_u32(code_point).ok_or_else(|| "invalid unicode escape".to_string())
            }
            Some(_) => Err("invalid JSON escape".to_string()),
            None => Err("unterminated JSON escape".to_string()),
        }
    }

    fn parse_hex_quad(&mut self) -> Result<u32, String> {
        let mut value = 0u32;
        for _ in 0..4 {
            let byte = self
                .next_byte()
                .ok_or_else(|| "unterminated unicode escape".to_string())?;
            value = value * 16
                + match byte {
                    b'0'..=b'9' => u32::from(byte - b'0'),
                    b'a'..=b'f' => u32::from(byte - b'a' + 10),
                    b'A'..=b'F' => u32::from(byte - b'A' + 10),
                    _ => return Err("invalid unicode escape".to_string()),
                };
        }
        Ok(value)
    }

    fn skip_number(&mut self) -> Result<(), String> {
        let start = self.position;
        while matches!(self.peek_byte(), Some(b'-' | b'+' | b'.' | b'0'..=b'9' | b'e' | b'E')) {
            self.position += 1;
        }
        if self.position == start {
            Err("expected JSON number".to_string())
        } else {
            Ok(())
        }
    }

    fn expect_literal(&mut self, literal: &str) -> Result<(), String> {
        if self.input[self.position..].starts_with(literal) {
            self.position += literal.len();
            Ok(())
        } else {
            Err(format!("expected JSON literal {literal}"))
        }
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek_byte(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.position += 1;
        }
    }

    fn skip_trailing_whitespace(&mut self) -> Result<(), String> {
        self.skip_whitespace();
        if self.position == self.input.len() {
            Ok(())
        } else {
            Err("unexpected trailing characters after JSON object".to_string())
        }
    }

    fn expect_byte(&mut self, expected: u8) -> Result<(), String> {
        if self.consume_byte(expected) {
            Ok(())
        } else {
            Err(format!("expected '{}'", expected as char))
        }
    }

    fn consume_byte(&mut self, expected: u8) -> bool {
        if self.peek_byte() == Some(expected) {
            self.position += 1;
            true
        } else {
            false
        }
    }

    fn peek_byte(&self) -> Option<u8> {
        self.input.as_bytes().get(self.position).copied()
    }

    fn next_byte(&mut self) -> Option<u8> {
        let byte = self.peek_byte()?;
        self.position += 1;
        Some(byte)
    }
}

#[cfg(windows)]
fn probe_current_state(
    ime_context_failure_logged: &mut bool,
    output_lock: &Arc<Mutex<()>>,
) -> ProbeSnapshot {
    windows_probe::probe_current_state(ime_context_failure_logged, output_lock)
}

#[cfg(not(windows))]
fn probe_current_state(
    _ime_context_failure_logged: &mut bool,
    _output_lock: &Arc<Mutex<()>>,
) -> ProbeSnapshot {
    create_unknown_snapshot("unsupported-platform", 0.0, false, None, None, None, None, None)
}

fn create_unknown_snapshot(
    reason: &str,
    confidence: f64,
    raw_state_available: bool,
    ime_name: Option<String>,
    is_open: Option<bool>,
    layout_hex: Option<String>,
    thread_id: Option<u32>,
    hwnd: Option<String>,
) -> ProbeSnapshot {
    ProbeSnapshot {
        state: "unknown",
        ime_name,
        is_open,
        layout_hex,
        thread_id,
        hwnd,
        reason: reason.to_string(),
        confidence,
        raw_state_available,
    }
}

#[cfg(windows)]
fn setup_console_cancel_handler() {
    unsafe {
        windows_probe::set_console_cancel_handler();
    }
}

#[cfg(not(windows))]
fn setup_console_cancel_handler() {}

#[cfg(windows)]
mod windows_probe {
    use super::{
        create_unknown_snapshot, details_object, format_handle, json_string, write_log, ProbeSnapshot,
        CANCELLED,
    };
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
                        "ImmGetContext returned a null handle. Trying default IME window fallback.",
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

}

fn format_handle(handle: isize) -> String {
    format!("0x{:X}", handle as usize)
}

#[cfg(windows)]
fn utc_timestamp() -> String {
    windows_time::utc_timestamp()
}

#[cfg(not(windows))]
fn utc_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_seconds = duration.as_secs() as i64;
    let days = total_seconds.div_euclid(86_400);
    let seconds_of_day = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{:03}Z",
        duration.subsec_millis()
    )
}

#[cfg(not(windows))]
fn civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

#[cfg(windows)]
mod windows_time {
    #[repr(C)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetSystemTime(system_time: *mut SystemTime);
    }

    pub fn utc_timestamp() -> String {
        unsafe {
            let mut system_time = SystemTime {
                year: 0,
                month: 0,
                day_of_week: 0,
                day: 0,
                hour: 0,
                minute: 0,
                second: 0,
                milliseconds: 0,
            };
            GetSystemTime(&mut system_time);
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
                system_time.year,
                system_time.month,
                system_time.day,
                system_time.hour,
                system_time.minute,
                system_time.second,
                system_time.milliseconds
            )
        }
    }
}
