use crate::classify::classify_linux_engine;
use crate::protocol::{create_unknown_snapshot, ProbeSnapshot};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const COMMAND_TIMEOUT_MS: u64 = 350;
// A selected backend is queried on every normal watch tick, but discovery of
// higher-priority backends is deliberately less frequent.  Without this
// cache, every Linux tick can start up to five external commands even after a
// working backend has already been found.
const PROVIDER_RESCAN_INTERVAL: Duration = Duration::from_secs(10);
// When no backend is available, avoid spawning the full provider chain every
// second.  A short retry window still lets a backend started after the helper
// recover without requiring a helper restart.
const UNAVAILABLE_RESCAN_INTERVAL: Duration = Duration::from_secs(3);

const PROVIDERS: [Provider; 5] = [
    Provider::Fcitx5,
    Provider::Fcitx4,
    Provider::Ibus,
    Provider::Xkb,
    Provider::Localectl,
];

pub(crate) fn probe_current_state() -> ProbeSnapshot {
    static PROVIDER_CACHE: OnceLock<Mutex<ProviderCache>> = OnceLock::new();
    let cache = PROVIDER_CACHE.get_or_init(|| Mutex::new(ProviderCache::default()));

    // Recover from a poisoned lock rather than dropping back to a full scan.
    // The helper has one probing thread, so this lock is only held for the
    // short duration of a probe and should never contend in normal operation.
    let mut cache = match cache.lock() {
        Ok(cache) => cache,
        Err(poisoned) => poisoned.into_inner(),
    };
    cache.probe()
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Provider {
    Fcitx5,
    Fcitx4,
    Ibus,
    Xkb,
    Localectl,
}

#[derive(Default)]
struct ProviderCache {
    selected: Option<Provider>,
    next_rescan_at: Option<Instant>,
}

impl ProviderCache {
    fn probe(&mut self) -> ProbeSnapshot {
        self.probe_at(Instant::now(), |provider| provider.probe())
    }

    // Keep the clock and probe function injectable so the cache policy can be
    // tested without launching real desktop commands.
    fn probe_at<F>(&mut self, now: Instant, mut probe: F) -> ProbeSnapshot
    where
        F: FnMut(Provider) -> Option<ProbeSnapshot>,
    {
        let mut failed_cached_provider = None;
        let rescan_due = self
            .next_rescan_at
            .map(|deadline| now >= deadline)
            .unwrap_or(true);

        if !rescan_due {
            if let Some(provider) = self.selected {
                if let Some(snapshot) = probe(provider) {
                    return snapshot;
                }

                // The selected backend disappeared or became unusable.  Do
                // a discovery pass now, but do not invoke this failed command
                // twice in the same tick.
                failed_cached_provider = Some(provider);
            } else {
                // A recent discovery already found no usable backend.  Return
                // the stable unknown snapshot until the retry window expires.
                return backend_unavailable_snapshot();
            }
        }

        for provider in PROVIDERS {
            if Some(provider) == failed_cached_provider {
                continue;
            }

            if let Some(snapshot) = probe(provider) {
                self.selected = Some(provider);
                self.next_rescan_at = Some(now + PROVIDER_RESCAN_INTERVAL);
                return snapshot;
            }
        }

        self.selected = None;
        self.next_rescan_at = Some(now + UNAVAILABLE_RESCAN_INTERVAL);
        backend_unavailable_snapshot()
    }
}

fn backend_unavailable_snapshot() -> ProbeSnapshot {
    create_unknown_snapshot(
        "linux-ime-backend-unavailable",
        0.0,
        false,
        None,
        None,
        None,
        None,
        None,
    )
}

impl Provider {
    fn probe(self) -> Option<ProbeSnapshot> {
        match self {
            Provider::Fcitx5 => probe_fcitx("fcitx5-remote", "fcitx5"),
            Provider::Fcitx4 => probe_fcitx("fcitx-remote", "fcitx4"),
            Provider::Ibus => probe_ibus(),
            Provider::Xkb => probe_layout_command("setxkbmap", &["-query"], "xkb-layout", 0.45),
            Provider::Localectl => probe_layout_command("localectl", &["status"], "localectl-layout", 0.35),
        }
    }
}

// raw_state_available is true only when the backend exposes open/closed or
// active/inactive state. IBus, XKB, and localectl return raw strings, but those
// are engine/layout inference inputs, so they stay false.
fn probe_fcitx(command: &str, provider: &str) -> Option<ProbeSnapshot> {
    let active_state = run_command(command, &[])?;
    if is_unavailable_fcitx_state(&active_state) {
        return None;
    }

    let name = run_command(command, &["-n"])
        .or_else(|| run_command(command, &["-name"]))
        .or_else(|| run_command(command, &["-p"]));
    let raw = format!("state={} name={}", active_state, name.as_deref().unwrap_or("n/a"));

    if is_closed_fcitx_state(&active_state) {
        return Some(ProbeSnapshot {
            state: "en",
            ime_name: Some(raw.clone()),
            is_open: Some(false),
            layout_hex: None,
            thread_id: None,
            hwnd: None,
            reason: format!("{provider}-inactive; raw={raw}"),
            confidence: 0.85,
            raw_state_available: true,
        });
    }

    if is_active_fcitx_state(&active_state) {
        let classification = classify_linux_engine(&format!("{provider}-active-input-method"), &raw, 0.85);
        if classification.state != "unknown" {
            return Some(ProbeSnapshot {
                state: classification.state,
                ime_name: Some(raw.clone()),
                is_open: Some(true),
                layout_hex: None,
                thread_id: None,
                hwnd: None,
                reason: format!("{}; raw={raw}", classification.reason),
                confidence: classification.confidence,
                raw_state_available: true,
            });
        }

        return Some(create_unknown_snapshot(
            &format!("{}; raw={raw}", classification.reason),
            classification.confidence,
            true,
            Some(raw),
            Some(true),
            None,
            None,
            None,
        ));
    }

    Some(create_unknown_snapshot(
        &format!("{provider}-ambiguous; raw={raw}"),
        0.25,
        false,
        Some(raw),
        None,
        None,
        None,
        None,
    ))
}

fn probe_ibus() -> Option<ProbeSnapshot> {
    let engine = run_command("ibus", &["engine"])?;
    let classification = classify_linux_engine("ibus-engine", &engine, 0.75);
    if classification.state == "unknown" {
        return Some(create_unknown_snapshot(
            &format!("{}; raw={engine}", classification.reason),
            classification.confidence,
            false,
            Some(engine),
            None,
            None,
            None,
            None,
        ));
    }

    Some(ProbeSnapshot {
        state: classification.state,
        ime_name: Some(engine.clone()),
        is_open: None,
        layout_hex: None,
        thread_id: None,
        hwnd: None,
        reason: format!("{}; raw={engine}", classification.reason),
        confidence: classification.confidence,
        raw_state_available: false,
    })
}

fn probe_layout_command(command: &str, args: &[&str], provider: &str, confidence: f64) -> Option<ProbeSnapshot> {
    let output = run_command(command, args)?;
    let classification = classify_linux_engine(provider, &output, confidence);
    if classification.state == "unknown" {
        return Some(create_unknown_snapshot(
            &format!("{}; raw={}", classification.reason, output.replace('\n', " ")),
            0.1,
            false,
            Some(output),
            None,
            None,
            None,
            None,
        ));
    }

    Some(ProbeSnapshot {
        state: classification.state,
        ime_name: Some(output.clone()),
        is_open: None,
        layout_hex: None,
        thread_id: None,
        hwnd: None,
        reason: format!("{}; raw={}", classification.reason, output.replace('\n', " ")),
        confidence: classification.confidence,
        raw_state_available: false,
    })
}

fn run_command(command: &str, args: &[&str]) -> Option<String> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + Duration::from_millis(COMMAND_TIMEOUT_MS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }

                let mut stdout = String::new();
                child.stdout.take()?.read_to_string(&mut stdout).ok()?;
                let stdout = stdout.trim().to_string();
                return if stdout.is_empty() { None } else { Some(stdout) };
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => return None,
        }
    }
}

fn is_unavailable_fcitx_state(text: &str) -> bool {
    text.trim().eq_ignore_ascii_case("0")
}

fn is_closed_fcitx_state(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    matches!(normalized.as_str(), "1" | "inactive" | "closed" | "false")
}

fn is_active_fcitx_state(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    matches!(normalized.as_str(), "2" | "active" | "open" | "true")
}

#[cfg(test)]
mod tests {
    use super::{
        is_active_fcitx_state, is_closed_fcitx_state, is_unavailable_fcitx_state, Provider,
        ProviderCache, PROVIDERS, PROVIDER_RESCAN_INTERVAL, UNAVAILABLE_RESCAN_INTERVAL,
    };
    use crate::protocol::ProbeSnapshot;
    use std::time::{Duration, Instant};

    fn snapshot(state: &'static str) -> ProbeSnapshot {
        ProbeSnapshot {
            state,
            ime_name: None,
            is_open: None,
            layout_hex: None,
            thread_id: None,
            hwnd: None,
            reason: "test".to_string(),
            confidence: 1.0,
            raw_state_available: false,
        }
    }

    #[test]
    fn classifies_fcitx_remote_state_values() {
        assert!(is_unavailable_fcitx_state("0"));
        assert!(is_closed_fcitx_state("1"));
        assert!(is_closed_fcitx_state("inactive"));
        assert!(is_active_fcitx_state("2"));
        assert!(is_active_fcitx_state("active"));
    }

    #[test]
    fn caches_selected_provider_between_polls() {
        let now = Instant::now();
        let mut cache = ProviderCache::default();
        let mut calls = Vec::new();

        let first = cache.probe_at(now, |provider| {
            calls.push(provider);
            (provider == Provider::Ibus).then(|| snapshot("zh"))
        });
        assert_eq!(first.state, "zh");
        assert_eq!(
            calls,
            vec![Provider::Fcitx5, Provider::Fcitx4, Provider::Ibus]
        );

        calls.clear();
        let second = cache.probe_at(now + Duration::from_secs(1), |provider| {
            calls.push(provider);
            (provider == Provider::Ibus).then(|| snapshot("zh"))
        });
        assert_eq!(second.state, "zh");
        assert_eq!(calls, vec![Provider::Ibus]);
    }

    #[test]
    fn periodically_rescans_higher_priority_providers() {
        let now = Instant::now();
        let mut cache = ProviderCache::default();
        let mut calls = Vec::new();

        cache.probe_at(now, |provider| {
            calls.push(provider);
            (provider == Provider::Ibus).then(|| snapshot("zh"))
        });
        calls.clear();

        cache.probe_at(now + PROVIDER_RESCAN_INTERVAL, |provider| {
            calls.push(provider);
            (provider == Provider::Ibus).then(|| snapshot("zh"))
        });
        assert_eq!(
            calls,
            vec![Provider::Fcitx5, Provider::Fcitx4, Provider::Ibus]
        );
    }

    #[test]
    fn failed_cached_provider_is_not_invoked_twice_in_one_poll() {
        let now = Instant::now();
        let mut cache = ProviderCache::default();
        let mut calls = Vec::new();

        cache.probe_at(now, |provider| {
            calls.push(provider);
            (provider == Provider::Ibus).then(|| snapshot("zh"))
        });
        calls.clear();

        let result = cache.probe_at(now + Duration::from_secs(1), |provider| {
            calls.push(provider);
            (provider == Provider::Xkb).then(|| snapshot("en"))
        });
        assert_eq!(result.state, "en");
        assert_eq!(
            calls,
            vec![
                Provider::Ibus,
                Provider::Fcitx5,
                Provider::Fcitx4,
                Provider::Xkb
            ]
        );
    }

    #[test]
    fn backs_off_when_no_provider_is_available() {
        let now = Instant::now();
        let mut cache = ProviderCache::default();
        let mut calls = Vec::new();

        let first = cache.probe_at(now, |provider| {
            calls.push(provider);
            None
        });
        assert_eq!(first.state, "unknown");
        assert_eq!(calls, PROVIDERS.to_vec());

        calls.clear();
        let second = cache.probe_at(now + Duration::from_secs(1), |provider| {
            calls.push(provider);
            None
        });
        assert_eq!(second.state, "unknown");
        assert!(calls.is_empty());

        cache.probe_at(now + UNAVAILABLE_RESCAN_INTERVAL, |provider| {
            calls.push(provider);
            None
        });
        assert_eq!(calls, PROVIDERS.to_vec());
    }
}
