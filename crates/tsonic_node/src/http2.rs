use std::collections::BTreeMap;

use crate::error::{NodeError, NodeResult};
use crate::http::Response;
use crate::https::response_to_node;
use std::sync::atomic::{AtomicU64, Ordering};

pub const HTTP2_HEADER_METHOD: &str = ":method";
pub const HTTP2_HEADER_PATH: &str = ":path";
pub const HTTP2_HEADER_STATUS: &str = ":status";
pub const HTTP2_HEADER_AUTHORITY: &str = ":authority";
pub const HTTP2_HEADER_CONTENT_TYPE: &str = "content-type";
pub const HTTP2_HEADER_CONTENT_LENGTH: &str = "content-length";
pub const HTTP2_METHOD_GET: &str = "GET";
pub const HTTP2_METHOD_POST: &str = "POST";
pub const HTTP_STATUS_OK: u16 = 200;
pub const HTTP_STATUS_NOT_FOUND: u16 = 404;
pub const NGHTTP2_NO_ERROR: u32 = 0;
pub const NGHTTP2_CANCEL: u32 = 8;
pub const NGHTTP2_PROTOCOL_ERROR: u32 = 1;
pub const NGHTTP2_REFUSED_STREAM: u32 = 7;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientSessionOptions {
    pub authority: String,
    pub headers: BTreeMap<String, String>,
    pub prior_knowledge: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Session {
    id: u64,
    authority: String,
    closed: bool,
    destroyed: bool,
    goaway_code: Option<u32>,
    local_settings: Http2Settings,
    remote_settings: Http2Settings,
    timeout: Option<u64>,
    pending_streams: usize,
}

impl Http2Session {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn authority(&self) -> &str {
        &self.authority
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn state(&self) -> Http2SessionState {
        Http2SessionState {
            effective_local_window_size: self.local_settings.initial_window_size,
            effective_recv_data_length: 0,
            next_stream_id: (self.pending_streams as u32).saturating_add(1),
            local_window_size: self.local_settings.initial_window_size,
            last_proc_stream_id: 0,
            remote_window_size: self.remote_settings.initial_window_size,
            outbound_queue_size: self.pending_streams,
            deflate_dynamic_table_size: self.local_settings.header_table_size,
            inflate_dynamic_table_size: self.remote_settings.header_table_size,
        }
    }

    pub fn local_settings(&self) -> &Http2Settings {
        &self.local_settings
    }

    pub fn remote_settings(&self) -> &Http2Settings {
        &self.remote_settings
    }

    pub fn settings(&mut self, settings: Http2Settings) {
        self.local_settings = settings;
    }

    pub fn set_timeout(&mut self, timeout_millis: u64, callback: Option<impl FnOnce()>) {
        self.timeout = Some(timeout_millis);
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn ping(&self, payload: &[u8]) -> NodeResult<Vec<u8>> {
        if payload.len() > 8 {
            return Err(NodeError::new(
                "ERR_HTTP2_PING_LENGTH",
                "ping payload too large",
            ));
        }
        let mut result = vec![0; 8];
        result[..payload.len()].copy_from_slice(payload);
        Ok(result)
    }

    pub fn goaway(&mut self, code: u32) {
        self.goaway_code = Some(code);
        self.closed = true;
    }

    pub fn goaway_code(&self) -> Option<u32> {
        self.goaway_code
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
        self.closed = true;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Stream {
    id: u64,
    headers: BTreeMap<String, String>,
    data: Vec<u8>,
    closed: bool,
    destroyed: bool,
    sent_headers: Vec<BTreeMap<String, String>>,
    sent_trailers: BTreeMap<String, String>,
    rst_code: u32,
    timeout: Option<u64>,
}

impl Http2Stream {
    pub fn new(headers: BTreeMap<String, String>) -> Self {
        Self {
            id: NEXT_HTTP2_ID.fetch_add(1, Ordering::SeqCst),
            headers,
            data: Vec::new(),
            closed: false,
            destroyed: false,
            sent_headers: Vec::new(),
            sent_trailers: BTreeMap::new(),
            rst_code: NGHTTP2_NO_ERROR,
            timeout: None,
        }
    }

    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn headers(&self) -> &BTreeMap<String, String> {
        &self.headers
    }

    pub fn get_headers(&self) -> &BTreeMap<String, String> {
        &self.headers
    }

    pub fn get_header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }

    pub fn get_header_names(&self) -> Vec<String> {
        self.headers.keys().cloned().collect()
    }

    pub fn headers_sent(&self) -> bool {
        !self.sent_headers.is_empty()
    }

    pub fn sent_headers(&self) -> &[BTreeMap<String, String>] {
        &self.sent_headers
    }

    pub fn trailers(&self) -> &BTreeMap<String, String> {
        &self.sent_trailers
    }

    pub fn write(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }

    pub fn respond(&mut self, headers: &BTreeMap<String, String>) {
        self.sent_headers.push(headers.clone());
    }

    pub fn respond_with_file(&mut self, path: &str, headers: &BTreeMap<String, String>) {
        let mut sent = headers.clone();
        sent.insert("x-tsonic-file".to_string(), path.to_string());
        self.sent_headers.push(sent);
    }

    pub fn additional_headers(&mut self, headers: &BTreeMap<String, String>) {
        self.sent_headers.push(headers.clone());
    }

    pub fn send_trailers(&mut self, trailers: &BTreeMap<String, String>) {
        self.sent_trailers.extend(trailers.clone());
    }

    pub fn set_timeout(&mut self, timeout_millis: u64, callback: Option<impl FnOnce()>) {
        self.timeout = Some(timeout_millis);
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn rst_code(&self) -> u32 {
        self.rst_code
    }

    pub fn close_with_code(&mut self, code: u32) {
        self.rst_code = code;
        self.closed = true;
    }

    pub fn end(&mut self) {
        self.closed = true;
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
        self.closed = true;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerOptions {
    pub allow_http1: bool,
    pub settings: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Settings {
    pub header_table_size: u32,
    pub enable_push: bool,
    pub initial_window_size: u32,
    pub max_frame_size: u32,
    pub max_concurrent_streams: Option<u32>,
    pub max_header_list_size: Option<u32>,
}

impl Default for Http2Settings {
    fn default() -> Self {
        Self {
            header_table_size: 4096,
            enable_push: true,
            initial_window_size: 65_535,
            max_frame_size: 16_384,
            max_concurrent_streams: None,
            max_header_list_size: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2SessionState {
    pub effective_local_window_size: u32,
    pub effective_recv_data_length: u32,
    pub next_stream_id: u32,
    pub local_window_size: u32,
    pub last_proc_stream_id: u32,
    pub remote_window_size: u32,
    pub outbound_queue_size: usize,
    pub deflate_dynamic_table_size: u32,
    pub inflate_dynamic_table_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Server {
    secure: bool,
    options: ServerOptions,
    closed: bool,
    timeout: Option<u64>,
}

impl Http2Server {
    pub fn options(&self) -> &ServerOptions {
        &self.options
    }

    pub fn secure(&self) -> bool {
        self.secure
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn set_timeout(&mut self, timeout_millis: u64, callback: Option<impl FnOnce()>) {
        self.timeout = Some(timeout_millis);
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn close(&mut self) {
        self.closed = true;
    }
}

impl ClientSessionOptions {
    pub fn connect(authority: impl Into<String>) -> Self {
        Self {
            authority: authority.into(),
            headers: BTreeMap::new(),
            prior_knowledge: false,
        }
    }
}

pub fn request(options: &ClientSessionOptions, path: &str, body: &[u8]) -> NodeResult<Response> {
    if !(options.authority.starts_with("https://") || options.authority.starts_with("http://")) {
        return Err(NodeError::new(
            "ERR_INVALID_URL",
            "http2 authority must be an absolute URL",
        ));
    }
    let client = reqwest::blocking::Client::builder()
        .use_rustls_tls()
        .http2_prior_knowledge()
        .build()
        .map_err(map_reqwest_error)?;
    let url = format!(
        "{}{}",
        options.authority.trim_end_matches('/'),
        if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{path}")
        }
    );
    let mut request = client.get(url);
    for (name, value) in &options.headers {
        request = request.header(name, value);
    }
    response_to_node(
        request
            .body(body.to_vec())
            .send()
            .map_err(map_reqwest_error)?,
    )
}

pub fn connect(authority: &str) -> NodeResult<ClientSessionOptions> {
    if !(authority.starts_with("https://") || authority.starts_with("http://")) {
        return Err(NodeError::new(
            "ERR_INVALID_URL",
            "http2 authority must be an absolute URL",
        ));
    }
    Ok(ClientSessionOptions::connect(authority))
}

pub fn connect_session(authority: &str) -> NodeResult<Http2Session> {
    connect(authority)?;
    Ok(Http2Session {
        id: NEXT_HTTP2_ID.fetch_add(1, Ordering::SeqCst),
        authority: authority.to_string(),
        closed: false,
        destroyed: false,
        goaway_code: None,
        local_settings: Http2Settings::default(),
        remote_settings: Http2Settings::default(),
        timeout: None,
        pending_streams: 0,
    })
}

pub fn create_server(options: ServerOptions) -> Http2Server {
    Http2Server {
        secure: false,
        options,
        closed: false,
        timeout: None,
    }
}

pub fn create_secure_server(options: ServerOptions) -> Http2Server {
    Http2Server {
        secure: true,
        options,
        closed: false,
        timeout: None,
    }
}

fn map_reqwest_error(error: reqwest::Error) -> NodeError {
    NodeError::new("ERR_HTTP2_SESSION_ERROR", error.to_string())
}

static NEXT_HTTP2_ID: AtomicU64 = AtomicU64::new(1);
