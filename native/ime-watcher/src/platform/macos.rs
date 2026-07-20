use crate::classify::classify_macos_input_source;
use crate::protocol::{create_unknown_snapshot, ProbeSnapshot};
use std::ffi::c_void;
use std::os::raw::{c_char, c_long};

type CFIndex = c_long;
type Boolean = u8;
type CFStringEncoding = u32;
type CFStringRef = *const c_void;
type CFArrayRef = *const c_void;
type TISInputSourceRef = *const c_void;

const K_CF_STRING_ENCODING_UTF8: CFStringEncoding = 0x0800_0100;

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    static kTISPropertyInputSourceID: CFStringRef;
    static kTISPropertyLocalizedName: CFStringRef;
    static kTISPropertyInputModeID: CFStringRef;
    static kTISPropertyInputSourceLanguages: CFStringRef;
    fn TISCopyCurrentKeyboardInputSource() -> TISInputSourceRef;
    fn TISGetInputSourceProperty(input_source: TISInputSourceRef, property_key: CFStringRef) -> *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFStringGetLength(the_string: CFStringRef) -> CFIndex;
    fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: CFStringEncoding) -> CFIndex;
    fn CFStringGetCString(
        the_string: CFStringRef,
        buffer: *mut c_char,
        buffer_size: CFIndex,
        encoding: CFStringEncoding,
    ) -> Boolean;
    fn CFArrayGetCount(the_array: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(the_array: CFArrayRef, index: CFIndex) -> *const c_void;
}

pub(crate) fn probe_current_state() -> ProbeSnapshot {
    unsafe {
        let source = TISCopyCurrentKeyboardInputSource();
        if source.is_null() {
            return create_unknown_snapshot(
                "tis-current-input-source-missing",
                0.0,
                false,
                None,
                None,
                None,
                None,
                None,
            );
        }

        let input_source_id = property_string(source, kTISPropertyInputSourceID);
        let localized_name = property_string(source, kTISPropertyLocalizedName);
        let input_mode_id = property_string(source, kTISPropertyInputModeID);
        let languages = property_string_array(source, kTISPropertyInputSourceLanguages);
        CFRelease(source);

        let ime_name = localized_name
            .clone()
            .or_else(|| input_mode_id.clone())
            .or_else(|| input_source_id.clone());
        let classification = classify_macos_input_source(
            input_source_id.as_deref(),
            localized_name.as_deref(),
            input_mode_id.as_deref(),
            &languages,
        );

        if classification.state == "unknown" {
            return create_unknown_snapshot(
                &classification.reason,
                classification.confidence,
                false,
                ime_name,
                None,
                None,
                None,
                None,
            );
        }

        ProbeSnapshot {
            state: classification.state,
            ime_name,
            is_open: None,
            layout_hex: None,
            thread_id: None,
            hwnd: None,
            reason: format!(
                "{}; id={}; mode={}; languages={}",
                classification.reason,
                input_source_id.as_deref().unwrap_or("n/a"),
                input_mode_id.as_deref().unwrap_or("n/a"),
                languages.join("|")
            ),
            confidence: classification.confidence,
            raw_state_available: false,
        }
    }
}

unsafe fn property_string(source: TISInputSourceRef, key: CFStringRef) -> Option<String> {
    let value = TISGetInputSourceProperty(source, key) as CFStringRef;
    cf_string_to_string(value)
}

unsafe fn property_string_array(source: TISInputSourceRef, key: CFStringRef) -> Vec<String> {
    let array = TISGetInputSourceProperty(source, key) as CFArrayRef;
    if array.is_null() {
        return Vec::new();
    }

    let count = CFArrayGetCount(array);
    let mut values = Vec::new();
    for index in 0..count {
        let value = CFArrayGetValueAtIndex(array, index) as CFStringRef;
        if let Some(text) = cf_string_to_string(value) {
            values.push(text);
        }
    }
    values
}

unsafe fn cf_string_to_string(value: CFStringRef) -> Option<String> {
    if value.is_null() {
        return None;
    }

    let length = CFStringGetLength(value);
    let max_size = CFStringGetMaximumSizeForEncoding(length, K_CF_STRING_ENCODING_UTF8) + 1;
    if max_size <= 0 {
        return None;
    }

    let mut buffer = vec![0u8; max_size as usize];
    let ok = CFStringGetCString(
        value,
        buffer.as_mut_ptr() as *mut c_char,
        max_size,
        K_CF_STRING_ENCODING_UTF8,
    );
    if ok == 0 {
        return None;
    }

    let nul = buffer.iter().position(|byte| *byte == 0).unwrap_or(buffer.len());
    Some(String::from_utf8_lossy(&buffer[..nul]).trim().to_string()).filter(|text| !text.is_empty())
}
