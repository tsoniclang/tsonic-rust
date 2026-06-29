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

    pub fn encode_into(&self, input: &str, destination: &mut [u8]) -> TextEncoderEncodeIntoResult {
        let bytes = input.as_bytes();
        let written = bytes.len().min(destination.len());
        destination[..written].copy_from_slice(&bytes[..written]);
        TextEncoderEncodeIntoResult {
            read: input[..written].chars().count(),
            written,
        }
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

    pub fn new_with_options(encoding: Option<&str>, fatal: bool, ignore_bom: bool) -> Self {
        Self {
            encoding: encoding.unwrap_or("utf-8").to_ascii_lowercase(),
            fatal,
            ignore_bom,
        }
    }

    pub fn new_from_options(encoding: Option<&str>, options: TextDecoderOptions) -> Self {
        Self::new_with_options(encoding, options.fatal, options.ignore_bom)
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

    pub fn decode_with_options(&self, input: &[u8], _options: TextDecodeOptions) -> String {
        self.decode(input)
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

    pub fn is_big_int_object(_value: &JsValue) -> bool {
        false
    }

    pub fn is_boolean_object(value: &JsValue) -> bool {
        matches!(value, JsValue::Bool(_))
    }

    pub fn is_number_object(value: &JsValue) -> bool {
        matches!(value, JsValue::Number(_))
    }

    pub fn is_string_object(value: &JsValue) -> bool {
        matches!(value, JsValue::String(_))
    }

    pub fn is_symbol_object(_value: &JsValue) -> bool {
        false
    }

    pub fn is_boxed_primitive(value: &JsValue) -> bool {
        is_boolean_object(value) || is_number_object(value) || is_string_object(value)
    }

    pub fn is_map_iterator(_value: &JsValue) -> bool {
        false
    }

    pub fn is_set_iterator(_value: &JsValue) -> bool {
        false
    }

    pub fn is_weak_map(_value: &JsValue) -> bool {
        false
    }

    pub fn is_weak_set(_value: &JsValue) -> bool {
        false
    }

    pub fn is_generator_object(_value: &JsValue) -> bool {
        false
    }

    pub fn is_generator_function(_value: &JsValue) -> bool {
        false
    }

    pub fn is_async_function(_value: &JsValue) -> bool {
        false
    }

    pub fn is_module_namespace_object(_value: &JsValue) -> bool {
        false
    }

    pub fn is_external(_value: &JsValue) -> bool {
        false
    }

    pub fn is_crypto_key(_value: &JsValue) -> bool {
        false
    }

    pub fn is_key_object(_value: &JsValue) -> bool {
        false
    }
}

