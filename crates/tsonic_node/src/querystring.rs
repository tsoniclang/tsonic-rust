use crate::url::{percent_decode, percent_encode, UrlSearchParams};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy)]
pub struct ParseOptions {
    pub decode_uri_component: fn(&str) -> String,
    pub max_keys: usize,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            decode_uri_component: percent_decode,
            max_keys: 1000,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct StringifyOptions {
    pub encode_uri_component: fn(&str) -> String,
}

impl Default for StringifyOptions {
    fn default() -> Self {
        Self {
            encode_uri_component: percent_encode,
        }
    }
}

pub fn parse(value: &str) -> UrlSearchParams {
    parse_with_options(value, "&", "=", ParseOptions::default())
}

pub fn parse_with_options(
    value: &str,
    separator: &str,
    equals: &str,
    options: ParseOptions,
) -> UrlSearchParams {
    let mut params = UrlSearchParams::default();
    if value.is_empty() || options.max_keys == 0 {
        return params;
    }
    let separator = if separator.is_empty() { "&" } else { separator };
    let equals = if equals.is_empty() { "=" } else { equals };
    for part in value.split(separator).take(options.max_keys) {
        let (key, raw_value) = part.split_once(equals).unwrap_or((part, ""));
        params.append(
            &(options.decode_uri_component)(key),
            &(options.decode_uri_component)(raw_value),
        );
    }
    params
}

pub fn parse_with_separators(value: &str, separator: &str, equals: &str) -> UrlSearchParams {
    parse_with_options(value, separator, equals, ParseOptions::default())
}

pub fn stringify(params: &UrlSearchParams) -> String {
    params.to_string()
}

pub fn stringify_records(records: &BTreeMap<String, String>) -> String {
    stringify_records_with_options(records, "&", "=", StringifyOptions::default())
}

pub fn stringify_records_with_options(
    records: &BTreeMap<String, String>,
    separator: &str,
    equals: &str,
    options: StringifyOptions,
) -> String {
    let separator = if separator.is_empty() { "&" } else { separator };
    let equals = if equals.is_empty() { "=" } else { equals };
    records
        .iter()
        .map(|(key, value)| {
            format!(
                "{}{}{}",
                (options.encode_uri_component)(key),
                equals,
                (options.encode_uri_component)(value)
            )
        })
        .collect::<Vec<_>>()
        .join(separator)
}

pub fn escape(value: &str) -> String {
    percent_encode(value)
}

pub fn unescape(value: &str) -> String {
    percent_decode(value)
}

pub fn unescape_buffer(value: &str) -> Vec<u8> {
    percent_decode(value).into_bytes()
}
