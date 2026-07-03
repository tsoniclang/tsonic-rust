//! UTF-16-aware JS string helpers over valid Rust `str`.

use tsonic_rust_runtime::{JsError, JsErrorKind};

/// JS-facing string value conversion contract used by dense array join and future array helpers.
pub trait JsToString {
    fn to_js_string(&self) -> String;
}

impl<T> JsToString for T
where
    T: ToString,
{
    fn to_js_string(&self) -> String {
        self.to_string()
    }
}

fn utf16_units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

fn from_units(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn normalize_index(index: isize, length: usize) -> Option<usize> {
    if length == 0 {
        return None;
    }
    let normalized = if index < 0 {
        index.saturating_add(length as isize)
    } else {
        index
    };
    if normalized < 0 || normalized >= length as isize {
        return None;
    }
    Some(normalized as usize)
}

pub fn js_len(value: &str) -> usize {
    utf16_units(value).len()
}

pub fn char_at(value: &str, index: isize) -> String {
    let units = utf16_units(value);
    match normalize_index(index, units.len()) {
        Some(pos) => from_units(&[units[pos]]),
        None => String::new(),
    }
}

pub fn at(value: &str, index: isize) -> Option<String> {
    let units = utf16_units(value);
    normalize_index(index, units.len()).map(|pos| from_units(&[units[pos]]))
}

pub fn char_code_at(value: &str, index: isize) -> Option<f64> {
    let units = utf16_units(value);
    normalize_index(index, units.len()).map(|pos| units[pos] as f64)
}

pub fn code_point_at(value: &str, index: isize) -> Option<u32> {
    let units = utf16_units(value);
    let pos = normalize_index(index, units.len())?;
    let first = units[pos];
    if (0xD800..=0xDBFF).contains(&first) && pos + 1 < units.len() {
        let second = units[pos + 1];
        if (0xDC00..=0xDFFF).contains(&second) {
            let pair = (u32::from(first - 0xD800) << 10) + u32::from(second - 0xDC00) + 0x10000;
            return Some(pair);
        }
    }
    Some(u32::from(first))
}

pub fn slice(value: &str, start: isize, end: Option<isize>) -> String {
    let units = utf16_units(value);
    if units.is_empty() {
        return String::new();
    }

    let to_isize = |v: isize, len: usize| -> isize {
        if v < 0 {
            (len as isize + v).clamp(0, len as isize)
        } else {
            v.min(len as isize)
        }
    };

    let from = to_isize(start, units.len());
    let to = to_isize(end.unwrap_or(units.len() as isize), units.len());
    // JS slice does not swap start and end. If normalized start > end, result is empty.
    if from > to {
        return String::new();
    }
    from_units(&units[from as usize..to as usize])
}

pub fn substring(value: &str, start: isize, end: Option<isize>) -> String {
    let units = utf16_units(value);
    let len = units.len() as isize;
    let mut start = start.max(0).min(len);
    let mut end = end.unwrap_or(len).max(0).min(len);
    if start > end {
        std::mem::swap(&mut start, &mut end);
    }
    from_units(&units[start as usize..end as usize])
}

pub fn substr(value: &str, start: isize, length: Option<usize>) -> String {
    let units = utf16_units(value);
    if units.is_empty() {
        return String::new();
    }
    let start = if start < 0 {
        (units.len() as isize + start).max(0) as usize
    } else {
        (start as usize).min(units.len())
    };
    let end = length
        .map(|length| start.saturating_add(length).min(units.len()))
        .unwrap_or(units.len());
    from_units(&units[start..end])
}

pub fn index_of(value: &str, search: &str, position: isize) -> isize {
    if search.is_empty() {
        let len = js_len(value) as isize;
        return position.max(0).min(len);
    }
    let haystack = utf16_units(value);
    let needle = utf16_units(search);
    if needle.is_empty() || haystack.is_empty() || needle.len() > haystack.len() {
        return -1;
    }

    let start = position.max(0).min(haystack.len() as isize) as usize;

    (start..=haystack.len().saturating_sub(needle.len()))
        .find(|&i| haystack[i..i + needle.len()] == needle[..])
        .map(|i| i as isize)
        .unwrap_or(-1)
}

pub fn last_index_of(value: &str, search: &str, position: Option<isize>) -> isize {
    let haystack = utf16_units(value);
    let needle = utf16_units(search);
    if needle.is_empty() {
        return if haystack.is_empty() {
            0
        } else {
            haystack.len() as isize
        };
    }
    if needle.len() > haystack.len() {
        return -1;
    }

    let max_index = haystack.len() as isize - needle.len() as isize;
    if max_index < 0 {
        return -1;
    }

    let pos = position.unwrap_or((haystack.len() as isize) - 1);
    let mut start = if pos < 0 { 0 } else { pos };
    if start > max_index {
        start = max_index;
    }

    let end = start as usize;
    for i in (0..=end).rev() {
        if haystack[i..i + needle.len()] == needle[..] {
            return i as isize;
        }
    }
    -1
}

pub fn starts_with(value: &str, search: &str, position: isize) -> bool {
    let units = utf16_units(value);
    let needle = utf16_units(search);
    if search.is_empty() {
        if position <= units.len() as isize {
            return true;
        }
        return false;
    }
    let start = if position < 0 {
        0
    } else if position as usize >= units.len() {
        return false;
    } else {
        position as usize
    };
    start + needle.len() <= units.len() && needle == units[start..start + needle.len()]
}

pub fn ends_with(value: &str, search: &str, end_position: Option<isize>) -> bool {
    let units = utf16_units(value);
    let needle = utf16_units(search);
    let end = end_position
        .map(|end| {
            if end < 0 {
                0
            } else if end as usize > units.len() {
                units.len()
            } else {
                end as usize
            }
        })
        .unwrap_or(units.len());
    if needle.len() > end {
        return false;
    }
    needle == units[end - needle.len()..end]
}

pub fn includes(value: &str, search: &str, position: isize) -> bool {
    index_of(value, search, position) >= 0
}

pub fn replace(value: &str, search: &str, replacement: &str) -> String {
    if search.is_empty() {
        let mut out = replacement.to_string();
        out.push_str(value);
        return out;
    }
    value.replacen(search, replacement, 1)
}

pub fn split(value: &str, separator: &str, limit: Option<usize>) -> Vec<String> {
    if separator.is_empty() {
        let mut parts = utf16_units(value)
            .into_iter()
            .map(|unit| from_units(&[unit]))
            .collect::<Vec<_>>();
        if let Some(limit) = limit {
            parts.truncate(limit);
        }
        return parts;
    }
    let mut parts = value
        .split(separator)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if let Some(limit) = limit {
        parts.truncate(limit);
    }
    parts
}

pub fn repeat(value: &str, count: isize) -> Result<String, JsError> {
    if count < 0 {
        return Err(JsError::new(
            JsErrorKind::RangeError,
            "repeat count must be non-negative",
        ));
    }
    if count == 0 {
        return Ok(String::new());
    }
    let count = count as usize;
    let mut out = String::new();
    for _ in 0..count {
        out.push_str(value);
    }
    Ok(out)
}

pub fn pad_start(value: &str, target_length: usize, pad: &str) -> String {
    if js_len(value) >= target_length {
        return value.to_string();
    }
    if pad.is_empty() {
        return value.to_string();
    }
    let units = utf16_units(value);
    let need = target_length - units.len();
    if need == 0 {
        return value.to_string();
    }

    let mut prefix = String::new();
    while utf16_units(&prefix).len() < need {
        prefix.push_str(pad);
    }
    let truncated = utf16_units(&prefix);
    let start = truncated.len().saturating_sub(need);
    let prefix = from_units(&truncated[start..]);

    format!("{prefix}{value}")
}

pub fn pad_end(value: &str, target_length: usize, pad: &str) -> String {
    if js_len(value) >= target_length {
        return value.to_string();
    }
    if pad.is_empty() {
        return value.to_string();
    }
    let units = utf16_units(value);
    let need = target_length - units.len();
    let mut suffix = String::new();
    while utf16_units(&suffix).len() < need {
        suffix.push_str(pad);
    }
    let truncated = utf16_units(&suffix);
    let end = need;
    format!("{}{}", value, from_units(&truncated[..end]))
}

pub fn trim(value: &str) -> String {
    value.trim().to_string()
}
pub fn trim_start(value: &str) -> String {
    value.trim_start().to_string()
}
pub fn trim_end(value: &str) -> String {
    value.trim_end().to_string()
}

pub fn to_lower_case(value: &str) -> String {
    value.to_lowercase()
}
pub fn to_upper_case(value: &str) -> String {
    value.to_uppercase()
}

pub fn from_char_code(code_units: &[u16]) -> String {
    from_units(code_units)
}

pub fn from_code_point(code_points: &[u32]) -> Result<String, JsError> {
    let mut out = String::new();
    for value in code_points {
        if (0xD800..=0xDFFF).contains(value) || *value > 0x10FFFF {
            return Err(JsError::new(
                JsErrorKind::RangeError,
                "fromCodePoint expects a value between 0 and 0x10FFFF excluding surrogate code points",
            ));
        }
        if let Some(ch) = std::char::from_u32(*value) {
            out.push(ch);
        } else {
            return Err(JsError::new(
                JsErrorKind::RangeError,
                "invalid Unicode code point",
            ));
        }
    }
    Ok(out)
}

pub fn raw(raw_parts: &[&str], substitutions: &[&str]) -> String {
    let mut out = String::new();
    for (index, part) in raw_parts.iter().enumerate() {
        out.push_str(part);
        if let Some(value) = substitutions.get(index) {
            out.push_str(value);
        }
    }
    out
}
