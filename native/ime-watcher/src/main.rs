mod classify;
mod command;
mod output;
mod platform;
mod protocol;
mod timestamp;

use command::{read_commands, Command};
use output::{details_object, json_string, write_hello, write_log, write_state};
use platform::{probe_current_state, setup_console_cancel_handler};
use protocol::ProbeSnapshot;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

pub(crate) static CANCELLED: AtomicBool = AtomicBool::new(false);

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
                "首次探测返回 unknown；该结果可能是有效的 Electron/IME 状态，将继续监测。",
                Some(details_object(&[("Reason", json_string(&snapshot.reason))])),
                &output_lock,
            );
        }
    }

    while !CANCELLED.load(Ordering::SeqCst) {
        match rx.recv_timeout(watch_interval()) {
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
        "ImeWatcher 收到取消请求。",
        None,
        &output_lock,
    );
}

fn watch_interval() -> Duration {
    #[cfg(target_os = "linux")]
    {
        Duration::from_millis(1_000)
    }
    #[cfg(not(target_os = "linux"))]
    {
        Duration::from_millis(250)
    }
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
