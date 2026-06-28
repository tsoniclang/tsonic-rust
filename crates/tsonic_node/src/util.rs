use tsonic_js::date::JsDate;
use tsonic_js::json;
use tsonic_js::regexp::JsRegExp;
use tsonic_js::typed_array::TypedArrayLen;
use tsonic_js::value::JsValue;
use tsonic_js::{ArrayBuffer, Uint8Array};

pub fn format(format: &str, args: &[JsValue]) -> String {
    let mut out = String::new();
    let mut chars = format.chars().peekable();
    let mut arg_index = 0;
    while let Some(ch) = chars.next() {
        if ch != '%' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('%') => out.push('%'),
            Some('s') => out.push_str(&next_arg(args, &mut arg_index).inspect()),
            Some('d') => out.push_str(&format_number(next_arg(args, &mut arg_index))),
            Some('j') => {
                let value = next_arg(args, &mut arg_index);
                out.push_str(&json::stringify(value).unwrap_or_else(|_| "[Circular]".to_string()));
            }
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    for value in &args[arg_index..] {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&value.inspect());
    }
    out
}

pub fn format_with_options(_options: &JsValue, format: &str, args: &[JsValue]) -> String {
    self::format(format, args)
}

pub fn inspect(value: &JsValue) -> String {
    value.inspect()
}

pub fn inspect_with_options(value: &JsValue, _options: &JsValue) -> String {
    inspect(value)
}

pub fn is_deep_strict_equal(left: &JsValue, right: &JsValue) -> bool {
    left == right
}

pub fn strip_vt_control_characters(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x1b {
            index += 1;
            if index < bytes.len() && bytes[index] == b'[' {
                index += 1;
                while index < bytes.len() && !bytes[index].is_ascii_alphabetic() {
                    index += 1;
                }
                if index < bytes.len() {
                    index += 1;
                }
            }
            continue;
        }
        output.push(bytes[index] as char);
        index += 1;
    }
    output
}

pub fn to_usv_string(value: &str) -> String {
    value.chars().collect()
}

pub fn deprecate<T>(function: T, _message: &str) -> T {
    function
}

pub fn inherits(child_name: &str, parent_name: &str) -> (String, String) {
    (child_name.to_string(), parent_name.to_string())
}

pub fn promisify<T>(function: T) -> T {
    function
}

pub fn callbackify<T>(function: T) -> T {
    function
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TextEncoder;

impl TextEncoder {
    pub fn new() -> Self {
        Self
    }

    pub fn encoding(&self) -> &'static str {
        "utf-8"
    }

    pub fn encode(&self, input: &str) -> Vec<u8> {
        input.as_bytes().to_vec()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextDecoder {
    encoding: String,
    fatal: bool,
    ignore_bom: bool,
}

impl TextDecoder {
    pub fn new(encoding: Option<&str>) -> Self {
        Self {
            encoding: encoding.unwrap_or("utf-8").to_ascii_lowercase(),
            fatal: false,
            ignore_bom: false,
        }
    }

    pub fn encoding(&self) -> &str {
        &self.encoding
    }

    pub fn fatal(&self) -> bool {
        self.fatal
    }

    pub fn ignore_bom(&self) -> bool {
        self.ignore_bom
    }

    pub fn decode(&self, input: &[u8]) -> String {
        String::from_utf8_lossy(input).into_owned()
    }
}

pub mod types {
    use super::{ArrayBuffer, JsDate, JsRegExp, TypedArrayLen, Uint8Array};
    use tsonic_js::value::JsValue;

    pub fn is_boolean(value: &JsValue) -> bool {
        matches!(value, JsValue::Bool(_))
    }

    pub fn is_null(value: &JsValue) -> bool {
        matches!(value, JsValue::Null)
    }

    pub fn is_null_or_undefined(value: &JsValue) -> bool {
        matches!(value, JsValue::Null | JsValue::Undefined)
    }

    pub fn is_undefined(value: &JsValue) -> bool {
        matches!(value, JsValue::Undefined)
    }

    pub fn is_number(value: &JsValue) -> bool {
        matches!(value, JsValue::Number(_))
    }

    pub fn is_string(value: &JsValue) -> bool {
        matches!(value, JsValue::String(_))
    }

    pub fn is_object(value: &JsValue) -> bool {
        matches!(value, JsValue::Object(_))
    }

    pub fn is_array(value: &JsValue) -> bool {
        matches!(value, JsValue::Array(_))
    }

    pub fn is_array_buffer(_value: &ArrayBuffer) -> bool {
        true
    }

    pub fn is_any_array_buffer(value: &JsValue) -> bool {
        matches!(value, JsValue::Array(_))
    }

    pub fn is_array_buffer_view<T: TypedArrayLen>(_value: &T) -> bool {
        true
    }

    pub fn is_typed_array<T: TypedArrayLen>(_value: &T) -> bool {
        true
    }

    pub fn is_uint8_array(_value: &Uint8Array) -> bool {
        true
    }

    pub fn is_reg_exp(_value: &JsRegExp) -> bool {
        true
    }

    pub fn is_date(_value: &JsDate) -> bool {
        true
    }

    pub fn is_map(value: &JsValue) -> bool {
        matches!(value, JsValue::Object(_))
    }

    pub fn is_set(value: &JsValue) -> bool {
        matches!(value, JsValue::Array(_))
    }

    pub fn is_promise(_value: &JsValue) -> bool {
        false
    }

    pub fn is_native_error(_value: &JsValue) -> bool {
        false
    }

    pub fn is_proxy(_value: &JsValue) -> bool {
        false
    }
}

fn next_arg<'a>(args: &'a [JsValue], index: &mut usize) -> &'a JsValue {
    let value = args.get(*index).unwrap_or(&JsValue::Undefined);
    *index += 1;
    value
}

fn format_number(value: &JsValue) -> String {
    match value {
        JsValue::Number(value) => value.to_string(),
        _ => "NaN".to_string(),
    }
}
