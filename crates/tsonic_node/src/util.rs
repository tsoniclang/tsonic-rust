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
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParseArgsResult {
    pub values: Vec<(String, Vec<String>)>,
    pub positionals: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DebugLogger {
    section: String,
    enabled: bool,
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

impl DebugLogger {
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn log(&self, message: &str) -> Option<String> {
        self.enabled
            .then(|| format!("{} {message}", self.section.to_ascii_uppercase()))
    }
}

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

pub fn aborted(signal: &AbortSignal) -> bool {
    signal.aborted()
}

pub fn transferable_abort_signal(signal: &AbortSignal) -> AbortSignal {
    signal.clone()
}

pub fn transferable_abort_controller() -> AbortController {
    AbortController::new()
}

pub fn get_call_sites() -> Vec<CallSite> {
    vec![CallSite::new(
        Some("getCallSites".to_string()),
        Some("tsonic:generated".to_string()),
    )
    .with_position(1, 1)]
}

pub fn debuglog(section: &str, enabled_sections: &[&str]) -> DebugLogger {
    DebugLogger {
        section: section.to_string(),
        enabled: enabled_sections
            .iter()
            .any(|enabled| enabled.eq_ignore_ascii_case(section)),
    }
}

pub fn style_text(style: &str, text: &str) -> String {
    let code = match style {
        "red" => Some(31),
        "green" => Some(32),
        "yellow" => Some(33),
        "blue" => Some(34),
        "magenta" => Some(35),
        "cyan" => Some(36),
        "gray" | "grey" => Some(90),
        "bold" => Some(1),
        "underline" => Some(4),
        _ => None,
    };
    if let Some(code) = code {
        format!("\u{1b}[{code}m{text}\u{1b}[0m")
    } else {
        text.to_string()
    }
}

pub fn get_system_error_name(code: i32) -> &'static str {
    match code {
        1 => "EPERM",
        2 => "ENOENT",
        13 => "EACCES",
        17 => "EEXIST",
        22 => "EINVAL",
        _ => "ERR_SYSTEM_ERROR",
    }
}

pub fn get_system_error_message(code: i32) -> &'static str {
    match code {
        1 => "operation not permitted",
        2 => "no such file or directory",
        13 => "permission denied",
        17 => "file already exists",
        22 => "invalid argument",
        _ => "system error",
    }
}

pub fn parse_args(config: ParseArgsConfig) -> ParseArgsResult {
    let mut result = ParseArgsResult::default();
    for (name, descriptor) in &config.options {
        if let Some(default) = &descriptor.default {
            result.values.push((name.clone(), vec![default.clone()]));
        }
    }
    let mut index = 0;
    while index < config.args.len() {
        let arg = &config.args[index];
        if arg == "--" {
            result
                .positionals
                .extend(config.args[index + 1..].iter().cloned());
            break;
        }
        if let Some(rest) = arg.strip_prefix("--") {
            let (name, inline_value) = rest
                .split_once('=')
                .map(|(name, value)| (name, Some(value.to_string())))
                .unwrap_or((rest, None));
            if let Some((_, descriptor)) = config.options.iter().find(|(key, _)| key == name) {
                let value = match descriptor.option_type {
                    ParseArgsOptionType::Boolean => "true".to_string(),
                    ParseArgsOptionType::String => inline_value.unwrap_or_else(|| {
                        index += 1;
                        config.args.get(index).cloned().unwrap_or_default()
                    }),
                };
                set_parsed_arg(&mut result, name, value, descriptor.multiple);
            } else if config.allow_positionals {
                result.positionals.push(arg.clone());
            }
        } else if let Some(shorts) = arg.strip_prefix('-') {
            if !shorts.is_empty()
                && (config.allow_negative || !shorts.chars().all(|ch| ch.is_ascii_digit()))
            {
                for short in shorts.chars() {
                    if let Some((name, descriptor)) = config
                        .options
                        .iter()
                        .find(|(_, descriptor)| descriptor.short == Some(short))
                    {
                        set_parsed_arg(&mut result, name, "true".to_string(), descriptor.multiple);
                    }
                }
            } else if config.allow_positionals {
                result.positionals.push(arg.clone());
            }
        } else if config.allow_positionals {
            result.positionals.push(arg.clone());
        }
        index += 1;
    }
    result
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

fn set_parsed_arg(result: &mut ParseArgsResult, name: &str, value: String, multiple: bool) {
    if multiple {
        if let Some((_, values)) = result.values.iter_mut().find(|(key, _)| key == name) {
            values.push(value);
        } else {
            result.values.push((name.to_string(), vec![value]));
        }
    } else if let Some((_, values)) = result.values.iter_mut().find(|(key, _)| key == name) {
        *values = vec![value];
    } else {
        result.values.push((name.to_string(), vec![value]));
    }
}

fn format_number(value: &JsValue) -> String {
    match value {
        JsValue::Number(value) => value.to_string(),
        _ => "NaN".to_string(),
    }
}
