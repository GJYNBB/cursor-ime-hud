use crate::protocol::{ProbeSnapshot, PROTOCOL_VERSION};
use crate::timestamp::utc_timestamp;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};

pub(crate) fn write_hello(output_lock: &Arc<Mutex<()>>) {
    write_json_line(
        &format!(
            r#"{{"type":"hello","version":{},"capabilities":["state","log"]}}"#,
            PROTOCOL_VERSION
        ),
        false,
        output_lock,
    );
}

pub(crate) fn write_state(snapshot: &ProbeSnapshot, output_lock: &Arc<Mutex<()>>) {
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

pub(crate) fn write_log(
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

pub(crate) fn json_field(key: &str, raw_value: String) -> String {
    format!("{}:{}", json_string(key), raw_value)
}

pub(crate) fn details_object(entries: &[(&str, String)]) -> String {
    let fields = entries
        .iter()
        .map(|(key, value)| json_field(key, value.clone()))
        .collect::<Vec<_>>();
    format!("{{{}}}", fields.join(","))
}

pub(crate) fn json_string(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
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
    output.push('"');
    output
}

pub(crate) fn format_float(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::json_string;

    #[test]
    fn escapes_json_strings() {
        assert_eq!(json_string("a\"b\\c\n\t"), r#""a\"b\\c\n\t""#);
        assert_eq!(json_string("\u{0001}"), "\"\\u0001\"");
    }
}
