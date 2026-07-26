use crate::protocol::{ProbeSnapshot, PROTOCOL_VERSION};
use crate::timestamp::utc_timestamp;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};

pub(crate) fn write_hello(output_lock: &Arc<Mutex<()>>) {
    write_json_line(&format_hello_line(), false, output_lock);
}

fn format_hello_line() -> String {
    format!(
        r#"{{"type":"hello","version":{},"capabilities":["state","log"]}}"#,
        PROTOCOL_VERSION
    )
}

pub(crate) fn write_state(snapshot: &ProbeSnapshot, output_lock: &Arc<Mutex<()>>) {
    write_json_line(&format_state_line(snapshot), false, output_lock);
}

fn format_state_line(snapshot: &ProbeSnapshot) -> String {
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
    if let Some(value) = snapshot.conversion_native {
        fields.push(json_field("conversionNative", value.to_string()));
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

    format!("{{{}}}", fields.join(","))
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
    use super::{format_hello_line, format_state_line, json_string};
    use crate::command::test_support::{parse_json_value, JsonValue};
    use crate::protocol::ProbeSnapshot;
    use std::fs;
    use std::path::Path;

    #[test]
    fn escapes_json_strings() {
        assert_eq!(json_string("a\"b\\c\n\t"), r#""a\"b\\c\n\t""#);
        assert_eq!(json_string("\u{0001}"), "\"\\u0001\"");
    }

    // The shared vectors pin what TS/Kotlin parsers accept; parsing the lines
    // this emitter actually produces closes the loop from the Rust side.
    fn load_shared_vectors() -> Vec<JsonValue> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/helper-protocol-vectors.json");
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
        let document = parse_json_value(&contents).expect("vectors file is valid JSON");
        assert_eq!(
            document.get("schemaVersion"),
            Some(&JsonValue::Number(1.0)),
            "unexpected vectors schemaVersion"
        );
        match document.get("cases") {
            Some(JsonValue::Array(cases)) => cases.clone(),
            other => panic!("vectors file has no cases array: {other:?}"),
        }
    }

    fn string_member(value: &JsonValue, key: &str) -> Option<String> {
        match value.get(key) {
            Some(JsonValue::String(text)) => Some(text.clone()),
            _ => None,
        }
    }

    fn bool_member(value: &JsonValue, key: &str) -> Option<bool> {
        match value.get(key) {
            Some(JsonValue::Bool(flag)) => Some(*flag),
            _ => None,
        }
    }

    fn number_member(value: &JsonValue, key: &str) -> Option<f64> {
        match value.get(key) {
            Some(JsonValue::Number(number)) => Some(*number),
            _ => None,
        }
    }

    // Mirrors the TS/Kotlin optional-field convention: a wrongly typed optional
    // field is treated as absent, so the emitter must simply not produce it.
    fn snapshot_from_record(record: &JsonValue, id: &str) -> ProbeSnapshot {
        let state = match string_member(record, "state").as_deref() {
            Some("cn") => "cn",
            Some("en") => "en",
            Some("unknown") => "unknown",
            other => panic!("{id}: vector record has unsupported state {other:?}"),
        };

        ProbeSnapshot {
            state,
            ime_name: string_member(record, "imeName"),
            is_open: bool_member(record, "isOpen"),
            conversion_native: bool_member(record, "conversionNative"),
            layout_hex: string_member(record, "layoutHex"),
            thread_id: number_member(record, "threadId").map(|value| value as u32),
            hwnd: string_member(record, "hwnd"),
            reason: string_member(record, "reason").unwrap_or_default(),
            confidence: number_member(record, "confidence").unwrap_or(0.0),
            raw_state_available: bool_member(record, "rawStateAvailable").unwrap_or(false),
        }
    }

    #[test]
    fn hello_line_matches_shared_hello_valid_vector() {
        let cases = load_shared_vectors();
        let case = cases
            .iter()
            .find(|case| string_member(case, "id").as_deref() == Some("hello-valid"))
            .expect("hello-valid vector present");
        let expected = case.get("expected").expect("hello-valid has expected output");

        let hello = parse_json_value(&format_hello_line()).expect("hello line is valid JSON");
        assert_eq!(
            hello.get("type"),
            Some(&JsonValue::String("hello".to_string()))
        );
        assert_eq!(hello.get("version"), expected.get("version"));
        assert_eq!(hello.get("capabilities"), expected.get("capabilities"));
    }

    #[test]
    fn state_lines_match_shared_state_vectors() {
        let cases = load_shared_vectors();
        let mut checked = 0;

        for case in &cases {
            if string_member(case, "kind").as_deref() != Some("state") {
                continue;
            }
            let Some(JsonValue::Object(expected_members)) = case.get("expected") else {
                continue;
            };
            let id = string_member(case, "id").expect("vector case has an id");
            let record = case.get("record").expect("vector case has a record");

            let line = format_state_line(&snapshot_from_record(record, &id));
            let emitted = parse_json_value(&line)
                .unwrap_or_else(|error| panic!("{id}: emitted line is not valid JSON: {error}"));

            assert_eq!(
                emitted.get("type"),
                Some(&JsonValue::String("state".to_string())),
                "{id}: type"
            );
            assert_eq!(
                emitted.get("source"),
                Some(&JsonValue::String("native-helper".to_string())),
                "{id}: source"
            );
            assert!(
                matches!(emitted.get("timestamp"), Some(JsonValue::String(text)) if !text.is_empty()),
                "{id}: timestamp"
            );

            for (key, expected_value) in expected_members {
                // The emitter stamps its own wall-clock timestamp.
                if key == "timestamp" {
                    continue;
                }
                match expected_value {
                    JsonValue::Null => assert_eq!(
                        emitted.get(key),
                        None,
                        "{id}: {key} must be omitted, not emitted as null"
                    ),
                    value => assert_eq!(emitted.get(key), Some(value), "{id}: {key}"),
                }
            }

            checked += 1;
        }

        assert!(checked >= 4, "expected at least 4 positive state vectors, got {checked}");
    }
}
