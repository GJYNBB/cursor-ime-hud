use crate::output::{details_object, json_string, write_log};
use std::io::{self, BufRead};
use std::sync::{mpsc, Arc, Mutex};

pub(crate) enum Command {
    Refresh,
    Shutdown,
}

pub(crate) fn read_commands(tx: mpsc::Sender<Command>, output_lock: Arc<Mutex<()>>) {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                write_log(
                    "warn",
                    "读取标准输入中的命令失败。",
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
                    "解析命令 JSON 失败。",
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
        "ImeWatcher 的标准输入已关闭，正在退出。",
        None,
        &output_lock,
    );
    let _ = tx.send(Command::Shutdown);
}

pub(crate) fn is_refresh_command(line: &str) -> Result<bool, String> {
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

#[cfg(test)]
mod tests {
    use super::is_refresh_command;

    #[test]
    fn parses_refresh_command() {
        assert_eq!(is_refresh_command(r#"{"command":"refresh"}"#), Ok(true));
        assert_eq!(is_refresh_command(r#"{"command":"noop"}"#), Ok(false));
        assert_eq!(is_refresh_command(r#"{"nested":{"command":"refresh"}}"#), Ok(false));
    }

    #[test]
    fn rejects_invalid_json_command() {
        assert!(is_refresh_command("not json").is_err());
    }
}
