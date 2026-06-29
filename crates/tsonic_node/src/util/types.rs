use std::collections::BTreeMap;

use tsonic_js::date::JsDate;
use tsonic_js::json;
use tsonic_js::regexp::JsRegExp;
use tsonic_js::typed_array::TypedArrayLen;
use tsonic_js::value::JsValue;
use tsonic_js::web::{AbortController, AbortSignal};
use tsonic_js::{ArrayBuffer, Uint8Array};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MIMEParams {
    pairs: Vec<(String, String)>,
}

impl MIMEParams {
    pub fn new() -> Self {
        Self { pairs: Vec::new() }
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.pairs
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn has(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    pub fn set(&mut self, name: &str, value: &str) {
        if let Some((_, existing)) = self
            .pairs
            .iter_mut()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
        {
            *existing = value.to_string();
        } else {
            self.pairs
                .push((name.to_ascii_lowercase(), value.to_string()));
        }
    }

    pub fn delete(&mut self, name: &str) {
        self.pairs
            .retain(|(key, _)| !key.eq_ignore_ascii_case(name));
    }

    pub fn entries(&self) -> impl Iterator<Item = (&str, &str)> {
        self.pairs
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.pairs.iter().map(|(key, _)| key.as_str())
    }

    pub fn values(&self) -> impl Iterator<Item = &str> {
        self.pairs.iter().map(|(_, value)| value.as_str())
    }

    pub fn to_string_value(&self) -> String {
        format!("{self}")
    }
}

impl std::fmt::Display for MIMEParams {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = self
            .pairs
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join(";");
        write!(formatter, "{text}")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MIMEType {
    r#type: String,
    subtype: String,
    params: MIMEParams,
}

impl MIMEType {
    pub fn new(input: &str) -> Result<Self, String> {
        let mut pieces = input.split(';');
        let essence = pieces
            .next()
            .ok_or_else(|| "missing MIME essence".to_string())?
            .trim();
        let (r#type, subtype) = essence
            .split_once('/')
            .ok_or_else(|| "missing MIME subtype".to_string())?;
        if r#type.trim().is_empty() || subtype.trim().is_empty() {
            return Err("invalid MIME essence".to_string());
        }
        let mut params = MIMEParams::new();
        for piece in pieces {
            if let Some((name, value)) = piece.trim().split_once('=') {
                params.set(name.trim(), value.trim().trim_matches('"'));
            }
        }
        Ok(Self {
            r#type: r#type.trim().to_ascii_lowercase(),
            subtype: subtype.trim().to_ascii_lowercase(),
            params,
        })
    }

    pub fn essence(&self) -> String {
        format!("{}/{}", self.r#type, self.subtype)
    }

    pub fn r#type(&self) -> &str {
        &self.r#type
    }

    pub fn subtype(&self) -> &str {
        &self.subtype
    }

    pub fn params(&self) -> &MIMEParams {
        &self.params
    }

    pub fn params_mut(&mut self) -> &mut MIMEParams {
        &mut self.params
    }

    pub fn to_string_value(&self) -> String {
        format!("{self}")
    }
}

impl std::fmt::Display for MIMEType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let params = self.params.to_string();
        if params.is_empty() {
            write!(formatter, "{}", self.essence())
        } else {
            write!(formatter, "{};{}", self.essence(), params)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseArgsOptionType {
    Boolean,
    String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseArgsOptionDescriptor {
    pub option_type: ParseArgsOptionType,
    pub short: Option<char>,
    pub multiple: bool,
    pub default: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParseArgsConfig {
    pub args: Vec<String>,
    pub options: Vec<(String, ParseArgsOptionDescriptor)>,
    pub allow_positionals: bool,
    pub allow_negative: bool,
    pub strict: bool,
    pub tokens: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParseArgsResult {
    pub values: Vec<(String, Vec<String>)>,
    pub positionals: Vec<String>,
    pub tokens: Vec<ParseArgsToken>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseArgsToken {
    pub kind: String,
    pub index: usize,
    pub name: Option<String>,
    pub raw_name: String,
    pub value: Option<String>,
    pub inline_value: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DebugLogger {
    section: String,
    enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectOptions {
    pub show_hidden: bool,
    pub depth: Option<usize>,
    pub colors: bool,
    pub compact: bool,
    pub sorted: bool,
    pub break_length: usize,
    pub max_string_length: Option<usize>,
    pub max_array_length: Option<usize>,
    pub custom_inspect: bool,
    pub show_proxy: bool,
    pub getters: Option<String>,
    pub numeric_separator: bool,
}

impl Default for InspectOptions {
    fn default() -> Self {
        Self {
            show_hidden: false,
            depth: Some(2),
            colors: false,
            compact: true,
            sorted: false,
            break_length: 80,
            max_string_length: Some(10_000),
            max_array_length: Some(100),
            custom_inspect: true,
            show_proxy: false,
            getters: None,
            numeric_separator: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StyleTextOptions {
    pub stream: Option<String>,
    pub validate_stream: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct GetCallSitesOptions {
    pub source_map: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DeprecateOptions {
    pub modify_prototype: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IsDeepStrictEqualOptions {
    pub skip_prototype: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TextDecoderOptions {
    pub fatal: bool,
    pub ignore_bom: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TextDecodeOptions {
    pub stream: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InspectContext;

impl InspectContext {
    pub fn stylize(&self, text: &str, style_type: &str) -> String {
        style_text(style_type, text)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSiteObject {
    pub function_name: String,
    pub script_name: String,
    pub script_id: String,
    pub line_number: u32,
    pub column_number: u32,
}

impl From<&CallSite> for CallSiteObject {
    fn from(value: &CallSite) -> Self {
        Self {
            function_name: value.get_function_name().unwrap_or("").to_string(),
            script_name: value.get_file_name().unwrap_or("").to_string(),
            script_id: value.get_file_name().unwrap_or("").to_string(),
            line_number: value.get_line_number().unwrap_or_default(),
            column_number: value.get_column_number().unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomPromisifyLegacy<T> {
    pub __promisify__: T,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomPromisifySymbol<T> {
    pub custom: T,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectStyleEntry {
    pub kind: &'static str,
    pub style: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectColorEntry {
    pub style: &'static str,
    pub open: u8,
    pub close: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemErrorEntry {
    pub code: i32,
    pub name: &'static str,
    pub message: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextEncoderEncodeIntoResult {
    pub read: usize,
    pub written: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffEntry {
    pub operation: i8,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSite {
    function_name: Option<String>,
    script_name: Option<String>,
    line_number: Option<u32>,
    column_number: Option<u32>,
    eval: bool,
    native: bool,
    constructor: bool,
    async_call: bool,
}

impl CallSite {
    pub fn new(function_name: Option<String>, script_name: Option<String>) -> Self {
        Self {
            function_name,
            script_name,
            line_number: None,
            column_number: None,
            eval: false,
            native: false,
            constructor: false,
            async_call: false,
        }
    }

    pub fn with_position(mut self, line_number: u32, column_number: u32) -> Self {
        self.line_number = Some(line_number);
        self.column_number = Some(column_number);
        self
    }

    pub fn get_function_name(&self) -> Option<&str> {
        self.function_name.as_deref()
    }

    pub fn get_file_name(&self) -> Option<&str> {
        self.script_name.as_deref()
    }

    pub fn get_script_name_or_source_url(&self) -> Option<&str> {
        self.script_name.as_deref()
    }

    pub fn get_line_number(&self) -> Option<u32> {
        self.line_number
    }

    pub fn get_column_number(&self) -> Option<u32> {
        self.column_number
    }

    pub fn is_eval(&self) -> bool {
        self.eval
    }

    pub fn is_native(&self) -> bool {
        self.native
    }

    pub fn is_constructor(&self) -> bool {
        self.constructor
    }

    pub fn is_async(&self) -> bool {
        self.async_call
    }
}

