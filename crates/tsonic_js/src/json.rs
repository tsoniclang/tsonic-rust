//! Closed JSON parser/stringifier for Stage 1 values.

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
    let Some(text) = stringify_value(value)? else {
        return Ok(String::new());
    };
    Ok(text)
}

pub fn stringify_pretty(value: &JsValue) -> JsResult<String> {
    stringify(value)
}

fn stringify_value(value: &JsValue) -> JsResult<Option<String>> {
    match value {
        JsValue::Undefined => Ok(None),
        JsValue::Null => Ok(Some("null".to_string())),
        JsValue::Bool(value) => Ok(Some(value.to_string())),
        JsValue::Number(value) => Ok(Some(json_number(*value))),
        JsValue::String(value) => Ok(Some(format!("{:?}", value))),
        JsValue::Array(values) => {
            let mut parts = Vec::with_capacity(values.len());
            for value in values.values() {
                parts.push(match value {
                    Some(value) => stringify_value(value)?.unwrap_or_else(|| "null".to_string()),
                    None => "null".to_string(),
                });
            }
            Ok(Some(format!("[{}]", parts.join(","))))
        }
        JsValue::Object(object) => {
            let mut parts = Vec::new();
            for (key, value) in object.entries() {
                if let Some(value) = stringify_value(&value)? {
                    parts.push(format!("{:?}:{}", key, value));
                }
            }
            Ok(Some(format!("{{{}}}", parts.join(","))))
        }
    }
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
        let mut out = String::new();
        while let Some(byte) = self.next() {
            match byte {
                b'"' => return Ok(out),
                b'\\' => out.push(self.parse_escape()?),
                0x00..=0x1f => return Err(syntax_error("JSON string contains control character")),
                _ => out.push(byte as char),
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
            return Ok(JsValue::Object(object));
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
                Some(b'}') => return Ok(JsValue::Object(object)),
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
