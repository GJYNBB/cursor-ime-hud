#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ProbeSnapshot {
    pub(crate) state: &'static str,
    pub(crate) ime_name: Option<String>,
    pub(crate) is_open: Option<bool>,
    pub(crate) layout_hex: Option<String>,
    pub(crate) thread_id: Option<u32>,
    pub(crate) hwnd: Option<String>,
    pub(crate) reason: String,
    pub(crate) confidence: f64,
    pub(crate) raw_state_available: bool,
}

pub(crate) const PROTOCOL_VERSION: u32 = 1;

pub(crate) fn create_unknown_snapshot(
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
