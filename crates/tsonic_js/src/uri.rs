use crate::errors::{uri_error, JsResult};

pub fn encode_uri_component(value: &str) -> String {
    percent_encode(value, ComponentMode::Component)
}

pub fn encode_uri(value: &str) -> String {
    percent_encode(value, ComponentMode::Uri)
}

pub fn decode_uri_component(value: &str) -> JsResult<String> {
    percent_decode(value)
}

pub fn decode_uri(value: &str) -> JsResult<String> {
    percent_decode(value)
}

#[derive(Clone, Copy)]
enum ComponentMode {
    Uri,
    Component,
}

fn percent_encode(value: &str, mode: ComponentMode) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        let ch = *byte as char;
        let unescaped = ch.is_ascii_alphanumeric()
            || matches!(ch, '-' | '_' | '.' | '!' | '~' | '*' | '\'' | '(' | ')')
            || matches!(
                (mode, ch),
                (
                    ComponentMode::Uri,
                    ';' | ',' | '/' | '?' | ':' | '@' | '&' | '=' | '+' | '$' | '#'
                )
            );
        if unescaped {
            out.push(ch);
        } else {
            out.push('%');
            out.push(hex(byte >> 4));
            out.push(hex(byte & 0x0f));
        }
    }
    out
}

fn percent_decode(value: &str) -> JsResult<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            out.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(uri_error("malformed URI sequence"));
        }
        let hi = hex_value(bytes[index + 1])?;
        let lo = hex_value(bytes[index + 2])?;
        out.push((hi << 4) | lo);
        index += 3;
    }
    String::from_utf8(out).map_err(|_| uri_error("malformed URI sequence"))
}

fn hex(value: u8) -> char {
    b"0123456789ABCDEF"[value as usize] as char
}

fn hex_value(value: u8) -> JsResult<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(uri_error("malformed URI sequence")),
    }
}
