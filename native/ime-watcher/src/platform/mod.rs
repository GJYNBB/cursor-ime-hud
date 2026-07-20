use crate::protocol::ProbeSnapshot;
use std::sync::{Arc, Mutex};

#[cfg(windows)]
pub(crate) mod windows;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(target_os = "linux")]
pub(crate) mod linux;

#[cfg(windows)]
pub(crate) fn probe_current_state(
    ime_context_failure_logged: &mut bool,
    output_lock: &Arc<Mutex<()>>,
) -> ProbeSnapshot {
    windows::probe_current_state(ime_context_failure_logged, output_lock)
}

#[cfg(target_os = "macos")]
pub(crate) fn probe_current_state(
    _ime_context_failure_logged: &mut bool,
    _output_lock: &Arc<Mutex<()>>,
) -> ProbeSnapshot {
    macos::probe_current_state()
}

#[cfg(target_os = "linux")]
pub(crate) fn probe_current_state(
    _ime_context_failure_logged: &mut bool,
    _output_lock: &Arc<Mutex<()>>,
) -> ProbeSnapshot {
    linux::probe_current_state()
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub(crate) fn probe_current_state(
    _ime_context_failure_logged: &mut bool,
    _output_lock: &Arc<Mutex<()>>,
) -> ProbeSnapshot {
    crate::protocol::create_unknown_snapshot("unsupported-platform", 0.0, false, None, None, None, None, None)
}

#[cfg(windows)]
pub(crate) fn setup_console_cancel_handler() {
    unsafe {
        windows::set_console_cancel_handler();
    }
}

#[cfg(not(windows))]
pub(crate) fn setup_console_cancel_handler() {}

#[cfg(windows)]
pub(crate) fn format_handle(handle: isize) -> String {
    format!("0x{:X}", handle as usize)
}
