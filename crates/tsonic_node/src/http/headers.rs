use std::collections::BTreeMap;

use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};
use crate::net;
use crate::stream::{Readable, Writable};

pub const MAX_HEADER_SIZE: usize = 16 * 1024;

pub fn methods() -> Vec<&'static str> {
    vec![
        "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE", "CONNECT",
    ]
}

pub fn status_codes() -> BTreeMap<u16, &'static str> {
    [
        (100, "Continue"),
        (101, "Switching Protocols"),
        (102, "Processing"),
        (103, "Early Hints"),
        (200, "OK"),
        (201, "Created"),
        (202, "Accepted"),
        (204, "No Content"),
        (301, "Moved Permanently"),
        (302, "Found"),
        (304, "Not Modified"),
        (400, "Bad Request"),
        (401, "Unauthorized"),
        (403, "Forbidden"),
        (404, "Not Found"),
        (409, "Conflict"),
        (418, "I'm a Teapot"),
        (429, "Too Many Requests"),
        (500, "Internal Server Error"),
        (502, "Bad Gateway"),
        (503, "Service Unavailable"),
        (504, "Gateway Timeout"),
    ]
    .into_iter()
    .collect()
}

pub fn validate_header_name(name: &str) -> NodeResult<()> {
    if name.is_empty()
        || !name.bytes().all(|byte| {
            matches!(
                byte,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
                    | b'0'..=b'9'
                    | b'a'..=b'z'
                    | b'A'..=b'Z'
            )
        })
    {
        return Err(NodeError::new(
            "ERR_INVALID_HTTP_TOKEN",
            "header name contains invalid characters",
        ));
    }
    Ok(())
}

pub fn validate_header_value(name: &str, value: &str) -> NodeResult<()> {
    validate_header_name(name)?;
    if value
        .bytes()
        .any(|byte| matches!(byte, 0..=8 | 10..=31 | 127))
    {
        return Err(NodeError::new(
            "ERR_INVALID_CHAR",
            "header value contains invalid characters",
        ));
    }
    Ok(())
}

pub type IncomingHttpHeaders = BTreeMap<String, String>;
pub type OutgoingHttpHeaders = BTreeMap<String, String>;
type HttpListenerMap = BTreeMap<String, Vec<String>>;

fn http_add_listener(listeners: &mut HttpListenerMap, event: &str, prepend: bool) {
    let entry = listeners.entry(event.to_string()).or_default();
    if prepend {
        entry.insert(0, event.to_string());
    } else {
        entry.push(event.to_string());
    }
}

fn http_remove_listener(listeners: &mut HttpListenerMap, event: &str) {
    if let Some(values) = listeners.get_mut(event) {
        values.pop();
        if values.is_empty() {
            listeners.remove(event);
        }
    }
}

fn http_remove_all_listeners(listeners: &mut HttpListenerMap, event: Option<&str>) {
    if let Some(event) = event {
        listeners.remove(event);
    } else {
        listeners.clear();
    }
}

fn http_listeners(listeners: &HttpListenerMap, event: &str) -> Vec<String> {
    listeners.get(event).cloned().unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InformationEvent {
    pub status_code: u16,
    pub status_message: String,
    pub http_version: String,
    pub http_version_major: u8,
    pub http_version_minor: u8,
    pub headers: IncomingHttpHeaders,
    pub raw_headers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProxyEnv {
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub no_proxy: Option<String>,
    pub http_proxy_upper: Option<String>,
    pub https_proxy_upper: Option<String>,
    pub no_proxy_upper: Option<String>,
}
