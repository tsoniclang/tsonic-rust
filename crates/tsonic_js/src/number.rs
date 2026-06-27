//! Number helpers used by generated code for JS-compatible semantics.

use std::str::FromStr;

use tsonic_runtime::{JsError, JsErrorKind};

pub const EPSILON: f64 = f64::EPSILON;
pub const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
pub const MIN_SAFE_INTEGER: f64 = -9_007_199_254_740_991.0;
pub const POSITIVE_INFINITY: f64 = f64::INFINITY;
pub const NEGATIVE_INFINITY: f64 = f64::NEG_INFINITY;
pub const NAN: f64 = f64::NAN;

pub fn parse_int(text: &str, radix: Option<i32>) -> f64 {
    let mut source = text.trim_start();
    if source.is_empty() {
        return f64::NAN;
    }

    let mut sign = 1.0;
    match source.as_bytes().first() {
        Some(b'+') => {
            source = &source[1..];
        }
        Some(b'-') => {
            sign = -1.0;
            source = &source[1..];
        }
        _ => {}
    }

    let mut base = radix.unwrap_or(10);
    if !(2..=36).contains(&base) {
        return f64::NAN;
    }

    if base == 10 && source.starts_with("0x") || base == 10 && source.starts_with("0X") {
        // parseInt in JS keeps parsing decimal leading zeros by default, but also supports 0x with
        // inferred radix only when radix is omitted.
        if radix.is_none() {
            base = 16;
            source = &source[2..];
        }
    } else if base == 16 {
        if source.starts_with("0x") || source.starts_with("0X") {
            source = &source[2..];
        }
    }

    let base_usize = base as u32;
    let mut value: i128 = 0;
    let mut consumed = 0usize;
    for ch in source.chars() {
        let digit = match ch.to_digit(base as u32) {
            Some(v) => v,
            None => break,
        };

        if let Some(next) = value.checked_mul(base_usize as i128).and_then(|v| v.checked_add(digit as i128))
        {
            value = next;
            consumed += 1;
        } else {
            return if sign < 0.0 { f64::NEG_INFINITY } else { f64::INFINITY };
        }
    }

    if consumed == 0 {
        return f64::NAN;
    }

    sign * (value as f64)
}

pub fn parse_float(text: &str) -> f64 {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return f64::NAN;
    }

    let lower = trimmed.to_lowercase();
    if lower.starts_with("infinity") || lower.starts_with("+infinity") || lower.starts_with("-infinity") {
        return trimmed.parse::<f64>().unwrap_or(f64::NAN);
    }

    let mut end = 0usize;
    let mut chars = trimmed.chars().peekable();
    let mut has_dot = false;
    let mut seen_digit = false;
    let mut has_exp = false;
    let mut has_exp_sign = false;
    let mut has_exp_digits = false;

    if let Some(first) = chars.peek().copied() {
        if first == '+' || first == '-' {
            chars.next();
            end += first.len_utf8();
        }
    }

    while let Some(ch) = chars.next() {
        let accept = match ch {
            '0'..='9' => {
                seen_digit = true;
                if has_exp {
                    has_exp_digits = true;
                }
                true
            }
            '.' if !has_dot && !has_exp => {
                has_dot = true;
                seen_digit || true
            }
            'e' | 'E' if !has_exp && (seen_digit || has_dot) => {
                has_exp = true;
                true
            }
            '+' | '-' if has_exp && !has_exp_sign && !has_exp_digits => {
                has_exp_sign = true;
                true
            }
            _ => false,
        };
        if accept {
            end += ch.len_utf8();
            if has_exp && (ch == 'e' || ch == 'E') {
                has_exp_sign = false;
                has_exp_digits = false;
            }
            continue;
        }
        break;
    }

    if !seen_digit {
        return f64::NAN;
    }

    let token = trimmed[..end].trim();
    if token == "+" || token == "-" || token == "." || token == "+." || token == "-." {
        return f64::NAN;
    }
    f64::from_str(token).unwrap_or(f64::NAN)
}

pub fn is_nan(value: f64) -> bool {
    value.is_nan()
}

pub fn is_finite(value: f64) -> bool {
    value.is_finite()
}

pub fn is_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

pub fn is_safe_integer(value: f64) -> bool {
    is_integer(value) && value >= MIN_SAFE_INTEGER && value <= MAX_SAFE_INTEGER
}

pub fn to_fixed(value: f64, digits: usize) -> Result<String, JsError> {
    if digits > 100 {
        return Err(JsError::new(
            JsErrorKind::RangeError,
            "toFixed digits must be between 0 and 100",
        ));
    }

    Ok(format!("{value:.precision$}", precision = digits))
}

pub fn to_string_radix(value: f64, radix: Option<i32>) -> Result<String, JsError> {
    let base = radix.unwrap_or(10);
    if !(2..=36).contains(&base) {
        return Err(JsError::new(
            JsErrorKind::RangeError,
            "toString radix must be between 2 and 36",
        ));
    }
    if value.is_nan() {
        return Ok("NaN".to_string());
    }
    if value.is_infinite() {
        return Ok(if value.is_sign_negative() {
            "-Infinity".to_string()
        } else {
            "Infinity".to_string()
        });
    }
    if value == 0.0 {
        return Ok("0".to_string());
    }

    let mut unsigned = value.abs() as u64;
    if value.fract() != 0.0 {
        unsigned = value.floor().abs() as u64;
    }
    let mut digits = Vec::new();
    let base_u32 = base as u64;
    let chars: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    while unsigned > 0 {
        let idx = (unsigned % base_u32) as usize;
        digits.push(chars[idx] as char);
        unsigned /= base_u32;
    }
    digits.reverse();
    let mut text = digits.iter().collect::<String>();
    if value < 0.0 {
        text.insert(0, '-');
    }
    Ok(text)
}
