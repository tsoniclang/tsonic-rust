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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentOptions {
    pub keep_alive: bool,
    pub keep_alive_msecs: u64,
    pub max_sockets: usize,
    pub max_free_sockets: usize,
    pub max_total_sockets: usize,
    pub timeout: Option<u64>,
    pub scheduling: String,
}

impl Default for AgentOptions {
    fn default() -> Self {
        Self {
            keep_alive: false,
            keep_alive_msecs: 1_000,
            max_sockets: usize::MAX,
            max_free_sockets: 256,
            max_total_sockets: usize::MAX,
            timeout: None,
            scheduling: "lifo".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agent {
    pub options: AgentOptions,
    destroyed: bool,
}

impl Agent {
    pub fn new(options: Option<AgentOptions>) -> Self {
        Self {
            options: options.unwrap_or_default(),
            destroyed: false,
        }
    }

    pub fn get_name(&self, options: Option<&RequestOptions>) -> String {
        options
            .map(|options| format!("{}:{}:{}", options.host, options.port, options.method))
            .unwrap_or_else(|| "localhost:80:GET".to_string())
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn keep_socket_alive(&self) -> bool {
        self.options.keep_alive
    }

    pub fn reuse_socket(&self) -> bool {
        !self.destroyed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestOptions {
    pub host: String,
    pub port: u16,
    pub path: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub protocol: String,
    pub timeout: Option<u64>,
    pub agent: Option<Agent>,
    pub auth: Option<String>,
    pub set_host: bool,
}

impl RequestOptions {
    pub fn get(host: impl Into<String>, port: u16, path: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port,
            path: path.into(),
            method: "GET".to_string(),
            headers: BTreeMap::new(),
            protocol: "http:".to_string(),
            timeout: None,
            agent: None,
            auth: None,
            set_host: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status_code: u16,
    pub status_message: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn text(&self) -> NodeResult<String> {
        String::from_utf8(self.body.clone())
            .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingMessage {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub raw_headers: Vec<String>,
    pub trailers: BTreeMap<String, String>,
    pub raw_trailers: Vec<String>,
    pub http_version: String,
    pub http_version_major: u8,
    pub http_version_minor: u8,
    pub aborted: bool,
    pub complete: bool,
    pub status_code: Option<u16>,
    pub status_message: Option<String>,
    pub body: Readable,
    timeout: Option<u64>,
    destroyed: bool,
}

impl IncomingMessage {
    pub fn new(method: impl Into<String>, url: impl Into<String>, body: Vec<u8>) -> Self {
        Self {
            method: method.into(),
            url: url.into(),
            headers: BTreeMap::new(),
            raw_headers: Vec::new(),
            trailers: BTreeMap::new(),
            raw_trailers: Vec::new(),
            http_version: "1.1".to_string(),
            http_version_major: 1,
            http_version_minor: 1,
            aborted: false,
            complete: true,
            status_code: None,
            status_message: None,
            body: Readable::from_chunks(vec![Buffer::from_bytes(body)]),
            timeout: None,
            destroyed: false,
        }
    }

    pub fn set_header(&mut self, name: &str, value: &str) {
        if validate_header_value(name, value).is_err() {
            return;
        }
        self.headers
            .insert(name.to_ascii_lowercase(), value.to_string());
        self.raw_headers.push(name.to_string());
        self.raw_headers.push(value.to_string());
    }

    pub fn get_header(&self, name: &str) -> Option<String> {
        self.headers.get(&name.to_ascii_lowercase()).cloned()
    }

    pub fn headers_distinct(&self) -> BTreeMap<String, Vec<String>> {
        let mut result = BTreeMap::new();
        for pair in self.raw_headers.chunks(2) {
            if let [name, value] = pair {
                result
                    .entry(name.to_ascii_lowercase())
                    .or_insert_with(Vec::new)
                    .push(value.clone());
            }
        }
        result
    }

    pub fn set_timeout(&mut self, msecs: u64, callback: Option<impl FnOnce()>) -> &mut Self {
        self.timeout = Some(msecs);
        if let Some(callback) = callback {
            callback();
        }
        self
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn destroy(&mut self) -> &mut Self {
        self.destroyed = true;
        self.aborted = true;
        self.complete = false;
        self
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerResponse {
    pub status_code: u16,
    pub status_message: String,
    pub headers: BTreeMap<String, String>,
    pub trailers: BTreeMap<String, String>,
    pub headers_sent: bool,
    pub send_date: bool,
    pub should_keep_alive: bool,
    pub strict_content_length: bool,
    body: Writable,
    timeout: Option<u64>,
    finished: bool,
}

impl Default for ServerResponse {
    fn default() -> Self {
        Self {
            status_code: 200,
            status_message: "OK".to_string(),
            headers: BTreeMap::new(),
            trailers: BTreeMap::new(),
            headers_sent: false,
            send_date: true,
            should_keep_alive: true,
            strict_content_length: false,
            body: Writable::new(),
            timeout: None,
            finished: false,
        }
    }
}

impl ServerResponse {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_header(&mut self, name: &str, value: &str) {
        if validate_header_value(name, value).is_err() {
            return;
        }
        self.headers
            .insert(name.to_ascii_lowercase(), value.to_string());
    }

    pub fn append_header(&mut self, name: &str, value: &str) {
        let key = name.to_ascii_lowercase();
        self.headers
            .entry(key)
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(value);
            })
            .or_insert_with(|| value.to_string());
    }

    pub fn set_headers(&mut self, headers: &BTreeMap<String, String>) {
        for (name, value) in headers {
            self.set_header(name, value);
        }
    }

    pub fn get_header(&self, name: &str) -> Option<String> {
        self.headers.get(&name.to_ascii_lowercase()).cloned()
    }

    pub fn has_header(&self, name: &str) -> bool {
        self.headers.contains_key(&name.to_ascii_lowercase())
    }

    pub fn remove_header(&mut self, name: &str) {
        self.headers.remove(&name.to_ascii_lowercase());
    }

    pub fn get_header_names(&self) -> Vec<String> {
        self.headers.keys().cloned().collect()
    }

    pub fn get_headers(&self) -> BTreeMap<String, String> {
        self.headers.clone()
    }

    pub fn write_head(&mut self, status_code: u16, headers: &[(&str, &str)]) {
        self.status_code = status_code;
        self.status_message = canonical_status_message(status_code).to_string();
        self.headers_sent = true;
        for (name, value) in headers {
            self.set_header(name, value);
        }
    }

    pub fn write_continue(&self, callback: Option<impl FnOnce()>) {
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn write_processing(&self, callback: Option<impl FnOnce()>) {
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn write_early_hints(
        &mut self,
        hints: &BTreeMap<String, String>,
        callback: Option<impl FnOnce()>,
    ) {
        for (name, value) in hints {
            self.set_header(name, value);
        }
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn add_trailers(&mut self, trailers: &BTreeMap<String, String>) {
        for (name, value) in trailers {
            self.trailers
                .insert(name.to_ascii_lowercase(), value.to_string());
        }
    }

    pub fn flush_headers(&mut self) {
        self.headers_sent = true;
    }

    pub fn set_timeout(&mut self, msecs: u64, callback: Option<impl FnOnce()>) -> &mut Self {
        self.timeout = Some(msecs);
        if let Some(callback) = callback {
            callback();
        }
        self
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        self.body.write(chunk)
    }

    pub fn end(&mut self, chunk: Option<Buffer>) {
        if let Some(chunk) = chunk {
            self.write(chunk);
        }
        self.body.end();
        self.finished = true;
    }

    pub fn body(&self) -> &[Buffer] {
        self.body.chunks()
    }

    pub fn to_response(&self) -> Response {
        Response {
            status_code: self.status_code,
            status_message: self.status_message.clone(),
            headers: self.headers.clone(),
            body: Buffer::concat(self.body.chunks()).as_bytes().to_vec(),
        }
    }

    pub fn finished(&self) -> bool {
        self.finished
    }
}

#[derive(Debug)]
pub struct ClientRequest {
    pub options: RequestOptions,
    pub method: String,
    pub host: String,
    pub path: String,
    pub protocol: String,
    pub aborted: bool,
    pub reused_socket: bool,
    pub max_headers_count: usize,
    timeout: Option<u64>,
    no_delay: bool,
    keep_alive: Option<u64>,
}

impl ClientRequest {
    pub fn new(options: RequestOptions) -> Self {
        Self {
            method: options.method.clone(),
            host: options.host.clone(),
            path: options.path.clone(),
            protocol: options.protocol.clone(),
            options,
            aborted: false,
            reused_socket: false,
            max_headers_count: 2_000,
            timeout: None,
            no_delay: false,
            keep_alive: None,
        }
    }

    pub fn set_header(&mut self, name: &str, value: &str) {
        if validate_header_value(name, value).is_ok() {
            self.options
                .headers
                .insert(name.to_ascii_lowercase(), value.to_string());
        }
    }

    pub fn get_header(&self, name: &str) -> Option<String> {
        self.options
            .headers
            .get(&name.to_ascii_lowercase())
            .cloned()
    }

    pub fn remove_header(&mut self, name: &str) {
        self.options.headers.remove(&name.to_ascii_lowercase());
    }

    pub fn get_headers(&self) -> BTreeMap<String, String> {
        self.options.headers.clone()
    }

    pub fn set_timeout(&mut self, timeout: u64, callback: Option<impl FnOnce()>) -> &mut Self {
        self.timeout = Some(timeout);
        if let Some(callback) = callback {
            callback();
        }
        self
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn set_no_delay(&mut self, no_delay: bool) {
        self.no_delay = no_delay;
    }

    pub fn no_delay(&self) -> bool {
        self.no_delay
    }

    pub fn set_socket_keep_alive(&mut self, enable: bool, initial_delay: Option<u64>) {
        self.keep_alive = enable.then_some(initial_delay.unwrap_or(0));
    }

    pub fn keep_alive_delay(&self) -> Option<u64> {
        self.keep_alive
    }

    pub fn abort(&mut self) {
        self.aborted = true;
    }

    pub fn on_socket(&mut self) {
        self.reused_socket = true;
    }
}

type RequestHandler = dyn Fn(IncomingMessage, &mut ServerResponse) + Send + Sync;

pub struct Server {
    handler: Box<RequestHandler>,
}

impl Server {
    pub fn new(
        handler: impl Fn(IncomingMessage, &mut ServerResponse) + Send + Sync + 'static,
    ) -> Self {
        Self {
            handler: Box::new(handler),
        }
    }

    pub fn handle(&self, request: IncomingMessage) -> Response {
        let mut response = ServerResponse::new();
        (self.handler)(request, &mut response);
        response.to_response()
    }

    pub fn close(&self) {}
}

pub fn create_server(
    handler: impl Fn(IncomingMessage, &mut ServerResponse) + Send + Sync + 'static,
) -> Server {
    Server::new(handler)
}

pub fn request(options: &RequestOptions, body: &[u8]) -> NodeResult<Response> {
    let mut socket = net::connect(&options.host, options.port)?;
    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n",
        options.method, options.path, options.host
    );
    for (name, value) in &options.headers {
        request.push_str(name);
        request.push_str(": ");
        request.push_str(value);
        request.push_str("\r\n");
    }
    if !body.is_empty() {
        request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    request.push_str("\r\n");
    socket.write_all(request.as_bytes())?;
    if !body.is_empty() {
        socket.write_all(body)?;
    }
    parse_response(&socket.read_to_end()?)
}

fn canonical_status_message(status_code: u16) -> &'static str {
    status_codes().get(&status_code).copied().unwrap_or("")
}

pub fn get(host: &str, port: u16, path: &str) -> NodeResult<Response> {
    request(&RequestOptions::get(host, port, path), &[])
}

pub fn parse_response(bytes: &[u8]) -> NodeResult<Response> {
    let text = String::from_utf8_lossy(bytes);
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return Err(NodeError::new(
            "HPE_INVALID_MESSAGE",
            "missing HTTP header terminator",
        ));
    };
    let mut lines = head.lines();
    let Some(status_line) = lines.next() else {
        return Err(NodeError::new("HPE_INVALID_MESSAGE", "missing status line"));
    };
    let mut status_parts = status_line.splitn(3, ' ');
    let _version = status_parts.next();
    let status_code = status_parts
        .next()
        .ok_or_else(|| NodeError::new("HPE_INVALID_STATUS", "missing status code"))?
        .parse::<u16>()
        .map_err(|error| NodeError::new("HPE_INVALID_STATUS", error.to_string()))?;
    let status_message = status_parts.next().unwrap_or("").to_string();
    let mut headers = BTreeMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    Ok(Response {
        status_code,
        status_message,
        headers,
        body: body.as_bytes().to_vec(),
    })
}
