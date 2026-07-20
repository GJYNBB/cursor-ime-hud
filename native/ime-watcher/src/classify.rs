#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Classification {
    pub(crate) state: &'static str,
    pub(crate) reason: String,
    pub(crate) confidence: f64,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn classify_macos_input_source(
    input_source_id: Option<&str>,
    localized_name: Option<&str>,
    input_mode_id: Option<&str>,
    languages: &[String],
) -> Classification {
    let text = classification_text(&[
        input_source_id.unwrap_or(""),
        localized_name.unwrap_or(""),
        input_mode_id.unwrap_or(""),
        &languages.join(" "),
    ]);

    if is_chinese_source(&text) {
        return Classification {
            state: "cn",
            reason: "tis-current-input-source-chinese-inferred".to_string(),
            confidence: 0.7,
        };
    }

    if is_latin_source(&text) {
        return Classification {
            state: "en",
            reason: "tis-current-input-source-latin".to_string(),
            confidence: 0.85,
        };
    }

    Classification {
        state: "unknown",
        reason: "tis-input-source-unrecognized".to_string(),
        confidence: 0.25,
    }
}

pub(crate) fn classify_linux_engine(provider: &str, raw: &str, confidence: f64) -> Classification {
    let text = raw.to_lowercase();
    if is_chinese_source(&text) {
        return Classification {
            state: "cn",
            reason: format!("{provider}-chinese"),
            confidence,
        };
    }
    if is_latin_source(&text) {
        return Classification {
            state: "en",
            reason: format!("{provider}-latin"),
            confidence,
        };
    }
    Classification {
        state: "unknown",
        reason: format!("{provider}-unrecognized"),
        confidence: 0.25,
    }
}

pub(crate) fn is_chinese_source(text: &str) -> bool {
    contains_any(
        text,
        &[
            "pinyin", "libpinyin", "sunpinyin", "shuangpin", "wubi", "zhuyin", "cangjie",
            "stroke", "rime", "squirrel", "sogou", "qqinput", "baidu", "chewing", "scim",
            "simplified", "traditional", "hans", "hant", "zh-hans", "zh-hant", "table:zh",
            "zh:", "zh_", "zh-", "chinese", "fcitx-keyboard-cn", "中文", "拼音", "五笔",
            "仓颉", "注音",
        ],
    )
}

pub(crate) fn is_latin_source(text: &str) -> bool {
    contains_any(
        text,
        &[
            "com.apple.keylayout.abc",
            "com.apple.keylayout.us",
            "com.apple.keylayout.british",
            "keyboard-us",
            "xkb:us",
            "xkb:gb",
            "layout: us",
            "layout: gb",
            "u.s.",
            "british",
            "roman",
            " latin",
            "latin ",
            "english",
            " en ",
            "en:",
            "en_",
            "en-",
        ],
    )
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn classification_text(parts: &[&str]) -> String {
    format!(" {} ", parts.join(" ").to_lowercase())
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::{classify_linux_engine, classify_macos_input_source};

    #[test]
    fn classifies_macos_chinese_sources() {
        let languages = vec!["zh-Hans".to_string()];
        let result = classify_macos_input_source(
            Some("com.apple.inputmethod.SCIM.ITABC"),
            Some("Pinyin - Simplified"),
            Some("com.apple.inputmethod.SCIM.ITABC"),
            &languages,
        );
        assert_eq!(result.state, "cn");
    }

    #[test]
    fn classifies_macos_latin_sources() {
        let result = classify_macos_input_source(
            Some("com.apple.keylayout.ABC"),
            Some("ABC"),
            None,
            &[],
        );
        assert_eq!(result.state, "en");
    }

    #[test]
    fn classifies_linux_engines() {
        assert_eq!(classify_linux_engine("ibus-engine", "libpinyin", 0.75).state, "cn");
        assert_eq!(classify_linux_engine("xkb-layout", "layout: us", 0.45).state, "en");
        assert_eq!(classify_linux_engine("ibus-engine", "custom", 0.75).state, "unknown");
    }
}
