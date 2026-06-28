use crate::url::{percent_decode, percent_encode, UrlSearchParams};

pub fn parse(value: &str) -> UrlSearchParams {
    UrlSearchParams::new(Some(value)).unwrap_or_default()
}

pub fn stringify(params: &UrlSearchParams) -> String {
    params.to_string()
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
