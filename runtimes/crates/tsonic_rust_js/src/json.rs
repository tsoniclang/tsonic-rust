//! Closed JSON parser/stringifier for supported carrier values.

use crate::errors::{syntax_error, type_error, JsResult};
use crate::object::JsObject;
use crate::value::JsValue;

pub fn parse(text: &str) -> JsResult<JsValue> {
    let mut parser = Parser::new(text);
    let value = parser.parse_value()?;
    parser.skip_ws();
    if parser.is_done() {
        Ok(value)
    } else {
        Err(syntax_error("JSON.parse found trailing input"))
    }
}

pub fn stringify(value: &JsValue) -> JsResult<String> {
    stringify_with_indent(value, "")
}

pub fn stringify_pretty(value: &JsValue) -> JsResult<String> {
    stringify(value)
}

/// Mirrors `JSON.stringify(value, null, space)` for a pre-resolved indent
/// string (JS resolves a numeric `space` to `" ".repeat(n)` clamped to at
/// most 10 and a string `space` to its first 10 chars before this point).
/// An empty `indent` produces the compact `JSON.stringify(value)` output.
pub fn stringify_with_indent(value: &JsValue, indent: &str) -> JsResult<String> {
    let Some(text) = stringify_value(value, indent, 0)? else {
        return Ok(String::new());
    };
    Ok(text)
}

fn stringify_value(value: &JsValue, indent: &str, depth: usize) -> JsResult<Option<String>> {
    match value {
        JsValue::Undefined => Ok(None),
        JsValue::Null => Ok(Some("null".to_string())),
        JsValue::Bool(value) => Ok(Some(value.to_string())),
        JsValue::Number(value) => Ok(Some(json_number(*value))),
        JsValue::String(value) => Ok(Some(quote_json_string(value))),
        JsValue::Array(values) => {
            let values = values.borrow();
            let mut parts = Vec::with_capacity(values.len());
            for value in values.values() {
                parts.push(match value {
                    Some(value) => stringify_value(value, indent, depth + 1)?
                        .unwrap_or_else(|| "null".to_string()),
                    None => "null".to_string(),
                });
            }
            Ok(Some(wrap_parts('[', ']', &parts, indent, depth)))
        }
        JsValue::Object(object) => {
            let mut parts = Vec::new();
            let separator = if indent.is_empty() { ":" } else { ": " };
            for (key, value) in object.borrow().entries() {
                if let Some(value) = stringify_value(&value, indent, depth + 1)? {
                    parts.push(format!("{}{separator}{value}", quote_json_string(&key)));
                }
            }
            Ok(Some(wrap_parts('{', '}', &parts, indent, depth)))
        }
    }
}

/// Joins already-serialized members with the compact/pretty layout of
/// `JSON.stringify`: compact `[a,b]` without an indent, otherwise one member
/// per line indented by `indent.repeat(depth + 1)` with the closing bracket
/// back at `indent.repeat(depth)`. Empty containers stay `[]`/`{}`.
fn wrap_parts(open: char, close: char, parts: &[String], indent: &str, depth: usize) -> String {
    if parts.is_empty() {
        return format!("{open}{close}");
    }
    if indent.is_empty() {
        return format!("{open}{}{close}", parts.join(","));
    }
    let outer = indent.repeat(depth);
    let inner = indent.repeat(depth + 1);
    let joined = parts.join(&format!(",\n{inner}"));
    format!("{open}\n{inner}{joined}\n{outer}{close}")
}

/// Quotes a string per `QuoteJSONString`: `\" \\ \b \f \n \r \t`, other
/// control chars as `\u00xx`; everything else (including non-ASCII) verbatim.
fn quote_json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if (ch as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", ch as u32));
            }
            ch => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn json_number(value: f64) -> String {
    if !value.is_finite() {
        return "null".to_string();
    }
    if value.fract() == 0.0 {
        return format!("{value:.0}");
    }
    value.to_string()
}

struct Parser<'a> {
    input: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            input: input.as_bytes(),
            pos: 0,
        }
    }

    fn parse_value(&mut self) -> JsResult<JsValue> {
        self.skip_ws();
        match self.peek() {
            Some(b'n') => self.parse_literal(b"null", JsValue::Null),
            Some(b't') => self.parse_literal(b"true", JsValue::Bool(true)),
            Some(b'f') => self.parse_literal(b"false", JsValue::Bool(false)),
            Some(b'"') => self.parse_string().map(JsValue::String),
            Some(b'[') => self.parse_array(),
            Some(b'{') => self.parse_object(),
            Some(b'-' | b'0'..=b'9') => self.parse_number().map(JsValue::Number),
            _ => Err(syntax_error("JSON.parse expected a value")),
        }
    }

    fn parse_literal(&mut self, literal: &[u8], value: JsValue) -> JsResult<JsValue> {
        if self.input.get(self.pos..self.pos + literal.len()) == Some(literal) {
            self.pos += literal.len();
            Ok(value)
        } else {
            Err(syntax_error("JSON.parse invalid literal"))
        }
    }

    fn parse_string(&mut self) -> JsResult<String> {
        self.expect(b'"')?;
        let mut out = Vec::new();
        while let Some(byte) = self.next() {
            match byte {
                b'"' => {
                    return String::from_utf8(out)
                        .map_err(|_| syntax_error("JSON string contains invalid UTF-8"));
                }
                b'\\' => {
                    let mut buffer = [0_u8; 4];
                    out.extend_from_slice(self.parse_escape()?.encode_utf8(&mut buffer).as_bytes());
                }
                0x00..=0x1f => return Err(syntax_error("JSON string contains control character")),
                _ => out.push(byte),
            }
        }
        Err(syntax_error("unterminated JSON string"))
    }

    fn parse_escape(&mut self) -> JsResult<char> {
        match self.next() {
            Some(b'"') => Ok('"'),
            Some(b'\\') => Ok('\\'),
            Some(b'/') => Ok('/'),
            Some(b'b') => Ok('\u{0008}'),
            Some(b'f') => Ok('\u{000c}'),
            Some(b'n') => Ok('\n'),
            Some(b'r') => Ok('\r'),
            Some(b't') => Ok('\t'),
            Some(b'u') => {
                let mut value = 0_u32;
                for _ in 0..4 {
                    let byte = self
                        .next()
                        .ok_or_else(|| syntax_error("unterminated unicode escape"))?;
                    value = value * 16 + u32::from(hex(byte)?);
                }
                char::from_u32(value).ok_or_else(|| syntax_error("invalid unicode escape"))
            }
            _ => Err(syntax_error("invalid JSON string escape")),
        }
    }

    fn parse_number(&mut self) -> JsResult<f64> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        self.consume_digits();
        if self.peek() == Some(b'.') {
            self.pos += 1;
            self.consume_digits();
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            self.consume_digits();
        }
        std::str::from_utf8(&self.input[start..self.pos])
            .ok()
            .and_then(|text| text.parse::<f64>().ok())
            .ok_or_else(|| syntax_error("invalid JSON number"))
    }

    fn parse_array(&mut self) -> JsResult<JsValue> {
        self.expect(b'[')?;
        let mut values = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsValue::from(values));
        }
        loop {
            values.push(self.parse_value()?);
            self.skip_ws();
            match self.next() {
                Some(b',') => {}
                Some(b']') => return Ok(JsValue::from(values)),
                _ => return Err(syntax_error("JSON array expected comma or close bracket")),
            }
        }
    }

    fn parse_object(&mut self) -> JsResult<JsValue> {
        self.expect(b'{')?;
        let mut object = JsObject::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsValue::object(object));
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.skip_ws();
            self.expect(b':')?;
            object.set(key, self.parse_value()?);
            self.skip_ws();
            match self.next() {
                Some(b',') => {}
                Some(b'}') => return Ok(JsValue::object(object)),
                _ => return Err(syntax_error("JSON object expected comma or close brace")),
            }
        }
    }

    fn consume_digits(&mut self) {
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
    }

    fn expect(&mut self, expected: u8) -> JsResult<()> {
        match self.next() {
            Some(actual) if actual == expected => Ok(()),
            _ => Err(syntax_error("JSON.parse unexpected token")),
        }
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.pos += 1;
        }
    }

    fn next(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.pos += 1;
        Some(byte)
    }

    fn peek(&self) -> Option<u8> {
        self.input.get(self.pos).copied()
    }

    fn is_done(&self) -> bool {
        self.pos == self.input.len()
    }
}

fn hex(byte: u8) -> JsResult<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(type_error("invalid unicode escape")),
    }
}
