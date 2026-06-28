use std::collections::BTreeMap;

use crate::buffer::Buffer;
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
pub const NGHTTP2_DEFAULT_WEIGHT: u32 = 16;
pub const NGHTTP2_STREAM_STATE_IDLE: u32 = 1;
pub const NGHTTP2_STREAM_STATE_OPEN: u32 = 2;
pub const NGHTTP2_STREAM_STATE_RESERVED_LOCAL: u32 = 3;
pub const NGHTTP2_STREAM_STATE_RESERVED_REMOTE: u32 = 4;
pub const NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL: u32 = 5;
pub const NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE: u32 = 6;
pub const NGHTTP2_STREAM_STATE_CLOSED: u32 = 7;
pub const NGHTTP2_SESSION_SERVER: u32 = 0;
pub const NGHTTP2_SESSION_CLIENT: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientSessionOptions {
    pub authority: String,
    pub headers: BTreeMap<String, String>,
    pub prior_knowledge: bool,
    pub protocol: Option<String>,
    pub max_reserved_remote_streams: Option<usize>,
    pub session: SessionOptions,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionOptions {
    pub max_deflate_dynamic_table_size: Option<usize>,
    pub max_header_list_pairs: Option<usize>,
    pub max_outstanding_pings: Option<usize>,
    pub max_send_header_block_length: Option<usize>,
    pub max_session_memory: Option<usize>,
    pub max_settings: Option<usize>,
    pub padding_strategy: Option<u32>,
    pub peer_max_concurrent_streams: Option<u32>,
    pub remote_custom_settings: Vec<u32>,
    pub settings: Option<Http2Settings>,
    pub strict_field_whitespace_validation: bool,
    pub unknown_protocol_timeout: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClientSessionRequestOptions {
    pub end_stream: bool,
    pub exclusive: bool,
    pub parent: Option<u32>,
    pub signal_aborted: bool,
    pub wait_for_trailers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AlternativeServiceOptions {
    pub origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerStreamResponseOptions {
    pub end_stream: bool,
    pub wait_for_trailers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerStreamFileResponseOptions {
    pub offset: Option<u64>,
    pub length: Option<u64>,
    pub wait_for_trailers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerStreamFileResponseOptionsWithError {
    pub options: ServerStreamFileResponseOptions,
    pub on_error: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StatOptions {
    pub offset: u64,
    pub length: u64,
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
    connecting: bool,
    encrypted: bool,
    alpn_protocol: Option<String>,
    origin_set: Vec<String>,
    pending_settings_ack: bool,
    refed: bool,
    session_type: u32,
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

    pub fn connecting(&self) -> bool {
        self.connecting
    }

    pub fn encrypted(&self) -> bool {
        self.encrypted
    }

    pub fn alpn_protocol(&self) -> Option<&str> {
        self.alpn_protocol.as_deref()
    }

    pub fn origin_set(&self) -> &[String] {
        &self.origin_set
    }

    pub fn pending_settings_ack(&self) -> bool {
        self.pending_settings_ack
    }

    pub fn session_type(&self) -> u32 {
        self.session_type
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
        self.pending_settings_ack = true;
    }

    pub fn acknowledge_settings(&mut self) {
        self.pending_settings_ack = false;
    }

    pub fn set_local_window_size(&mut self, window_size: u32) {
        self.local_settings.initial_window_size = window_size;
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

    pub fn close_with_callback(&mut self, callback: Option<impl FnOnce()>) {
        self.close();
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
        self.closed = true;
    }

    pub fn destroy_with_code(&mut self, code: u32) {
        self.goaway_code = Some(code);
        self.destroy();
    }

    pub fn ref_(&mut self) {
        self.refed = true;
    }

    pub fn unref(&mut self) {
        self.refed = false;
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Stream {
    id: u64,
    headers: BTreeMap<String, String>,
    data: Vec<u8>,
    aborted: bool,
    closed: bool,
    destroyed: bool,
    end_after_headers: bool,
    pending: bool,
    sent_headers: Vec<BTreeMap<String, String>>,
    sent_info_headers: Vec<BTreeMap<String, String>>,
    sent_trailers: BTreeMap<String, String>,
    rst_code: u32,
    timeout: Option<u64>,
    priority: Option<StreamPriorityOptions>,
}

impl Http2Stream {
    pub fn new(headers: BTreeMap<String, String>) -> Self {
        Self {
            id: NEXT_HTTP2_ID.fetch_add(1, Ordering::SeqCst),
            headers,
            data: Vec::new(),
            aborted: false,
            closed: false,
            destroyed: false,
            end_after_headers: false,
            pending: false,
            sent_headers: Vec::new(),
            sent_info_headers: Vec::new(),
            sent_trailers: BTreeMap::new(),
            rst_code: NGHTTP2_NO_ERROR,
            timeout: None,
            priority: None,
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

    pub fn aborted(&self) -> bool {
        self.aborted
    }

    pub fn buffer_size(&self) -> usize {
        self.data.len()
    }

    pub fn end_after_headers(&self) -> bool {
        self.end_after_headers
    }

    pub fn pending(&self) -> bool {
        self.pending
    }

    pub fn state(&self) -> StreamState {
        StreamState {
            state: Some(if self.closed {
                NGHTTP2_STREAM_STATE_CLOSED
            } else {
                NGHTTP2_STREAM_STATE_OPEN
            }),
            weight: self.priority.as_ref().map(|priority| priority.weight),
            sum_dependency_weight: None,
            local_close: Some(u32::from(self.closed)),
            remote_close: Some(0),
            local_window_size: Some(self.data.len() as u32),
        }
    }

    pub fn sent_headers(&self) -> &[BTreeMap<String, String>] {
        &self.sent_headers
    }

    pub fn sent_info_headers(&self) -> &[BTreeMap<String, String>] {
        &self.sent_info_headers
    }

    pub fn sent_trailers(&self) -> Option<&BTreeMap<String, String>> {
        if self.sent_trailers.is_empty() {
            None
        } else {
            Some(&self.sent_trailers)
        }
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

    pub fn respond_with_options(
        &mut self,
        headers: &BTreeMap<String, String>,
        options: ServerStreamResponseOptions,
    ) {
        self.end_after_headers = options.end_stream;
        self.respond(headers);
    }

    pub fn respond_with_file(&mut self, path: &str, headers: &BTreeMap<String, String>) {
        let mut sent = headers.clone();
        sent.insert("x-tsonic-file".to_string(), path.to_string());
        self.sent_headers.push(sent);
    }

    pub fn respond_with_file_options(
        &mut self,
        path: &str,
        headers: &BTreeMap<String, String>,
        options: ServerStreamFileResponseOptions,
    ) {
        let mut sent = headers.clone();
        sent.insert("x-tsonic-file".to_string(), path.to_string());
        if let Some(offset) = options.offset {
            sent.insert("x-tsonic-offset".to_string(), offset.to_string());
        }
        if let Some(length) = options.length {
            sent.insert("x-tsonic-length".to_string(), length.to_string());
        }
        self.end_after_headers = options.wait_for_trailers;
        self.sent_headers.push(sent);
    }

    pub fn additional_headers(&mut self, headers: &BTreeMap<String, String>) {
        self.sent_info_headers.push(headers.clone());
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

    pub fn priority(&mut self, options: StreamPriorityOptions) {
        self.priority = Some(options);
    }

    pub fn priority_options(&self) -> Option<&StreamPriorityOptions> {
        self.priority.as_ref()
    }

    pub fn close_with_code(&mut self, code: u32) {
        self.rst_code = code;
        self.closed = true;
    }

    pub fn close(&mut self, code: Option<u32>, callback: Option<impl FnOnce()>) {
        self.close_with_code(code.unwrap_or(NGHTTP2_NO_ERROR));
        if let Some(callback) = callback {
            callback();
        }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamPriorityOptions {
    pub exclusive: bool,
    pub parent: Option<u32>,
    pub weight: u32,
    pub silent: bool,
}

impl Default for StreamPriorityOptions {
    fn default() -> Self {
        Self {
            exclusive: false,
            parent: None,
            weight: NGHTTP2_DEFAULT_WEIGHT,
            silent: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StreamState {
    pub state: Option<u32>,
    pub weight: Option<u32>,
    pub sum_dependency_weight: Option<u32>,
    pub local_close: Option<u32>,
    pub remote_close: Option<u32>,
    pub local_window_size: Option<u32>,
}

pub type ClientHttp2Stream = Http2Stream;
pub type ServerHttp2Stream = Http2Stream;
pub type ClientHttp2Session = Http2Session;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2ServerRequest {
    pub stream: ServerHttp2Stream,
    pub headers: BTreeMap<String, String>,
    pub raw_headers: Vec<String>,
    pub trailers: BTreeMap<String, String>,
    pub raw_trailers: Vec<String>,
    pub method: String,
    pub url: String,
    pub authority: String,
    pub scheme: String,
    pub http_version: String,
    pub http_version_major: u8,
    pub http_version_minor: u8,
    pub aborted: bool,
    pub complete: bool,
    body: Vec<Buffer>,
    timeout: Option<u64>,
}

impl Http2ServerRequest {
    pub fn new(stream: ServerHttp2Stream) -> Self {
        let headers = stream.headers().clone();
        let method = headers
            .get(HTTP2_HEADER_METHOD)
            .cloned()
            .unwrap_or_else(|| HTTP2_METHOD_GET.to_string());
        let url = headers
            .get(HTTP2_HEADER_PATH)
            .cloned()
            .unwrap_or_else(|| "/".to_string());
        let authority = headers
            .get(HTTP2_HEADER_AUTHORITY)
            .cloned()
            .unwrap_or_default();
        Self {
            stream,
            headers,
            raw_headers: Vec::new(),
            trailers: BTreeMap::new(),
            raw_trailers: Vec::new(),
            method,
            url,
            authority,
            scheme: "https".to_string(),
            http_version: "2.0".to_string(),
            http_version_major: 2,
            http_version_minor: 0,
            aborted: false,
            complete: true,
            body: Vec::new(),
            timeout: None,
        }
    }

    pub fn push_body(&mut self, chunk: Buffer) {
        self.body.push(chunk);
    }

    pub fn read(&mut self, _size: Option<usize>) -> Option<Buffer> {
        if self.body.is_empty() {
            None
        } else {
            Some(self.body.remove(0))
        }
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2ServerResponse {
    stream: ServerHttp2Stream,
    headers: BTreeMap<String, String>,
    trailers: BTreeMap<String, String>,
    body: Vec<Buffer>,
    status_code: u16,
    status_message: String,
    send_date: bool,
    finished: bool,
    timeout: Option<u64>,
}

impl Http2ServerResponse {
    pub fn new(stream: ServerHttp2Stream) -> Self {
        Self {
            stream,
            headers: BTreeMap::new(),
            trailers: BTreeMap::new(),
            body: Vec::new(),
            status_code: HTTP_STATUS_OK,
            status_message: String::new(),
            send_date: true,
            finished: false,
            timeout: None,
        }
    }

    pub fn stream(&self) -> &ServerHttp2Stream {
        &self.stream
    }

    pub fn status_code(&self) -> u16 {
        self.status_code
    }

    pub fn set_status_code(&mut self, value: u16) {
        self.status_code = value;
    }

    pub fn status_message(&self) -> &str {
        &self.status_message
    }

    pub fn set_status_message(&mut self, value: &str) {
        self.status_message = value.to_string();
    }

    pub fn send_date(&self) -> bool {
        self.send_date
    }

    pub fn set_send_date(&mut self, value: bool) {
        self.send_date = value;
    }

    pub fn finished(&self) -> bool {
        self.finished
    }

    pub fn headers_sent(&self) -> bool {
        self.stream.headers_sent()
    }

    pub fn set_header(&mut self, name: &str, value: impl ToString) {
        self.headers
            .insert(name.to_ascii_lowercase(), value.to_string());
    }

    pub fn append_header(&mut self, name: &str, value: impl ToString) {
        let name = name.to_ascii_lowercase();
        self.headers
            .entry(name)
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&value.to_string());
            })
            .or_insert_with(|| value.to_string());
    }

    pub fn get_header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }

    pub fn get_header_names(&self) -> Vec<String> {
        self.headers.keys().cloned().collect()
    }

    pub fn get_headers(&self) -> &BTreeMap<String, String> {
        &self.headers
    }

    pub fn has_header(&self, name: &str) -> bool {
        self.headers.contains_key(&name.to_ascii_lowercase())
    }

    pub fn remove_header(&mut self, name: &str) {
        self.headers.remove(&name.to_ascii_lowercase());
    }

    pub fn write_head(
        &mut self,
        status_code: u16,
        headers: &BTreeMap<String, String>,
    ) -> &mut Self {
        self.status_code = status_code;
        self.headers.extend(headers.clone());
        self.stream.respond(&self.headers);
        self
    }

    pub fn write_continue(&mut self) {
        self.stream.additional_headers(&BTreeMap::from([(
            HTTP2_HEADER_STATUS.to_string(),
            "100".to_string(),
        )]));
    }

    pub fn write_early_hints(&mut self, hints: &BTreeMap<String, String>) {
        self.stream.additional_headers(hints);
    }

    pub fn write(&mut self, chunk: impl AsRef<[u8]>) -> bool {
        self.body.push(Buffer::from_bytes(chunk.as_ref().to_vec()));
        true
    }

    pub fn end(&mut self, chunk: Option<impl AsRef<[u8]>>) -> &mut Self {
        if let Some(chunk) = chunk {
            self.write(chunk);
        }
        self.finished = true;
        self.stream.end();
        self
    }

    pub fn add_trailers(&mut self, trailers: &BTreeMap<String, String>) {
        self.trailers.extend(trailers.clone());
        self.stream.send_trailers(trailers);
    }

    pub fn body(&self) -> &[Buffer] {
        &self.body
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
}

impl ClientSessionOptions {
    pub fn connect(authority: impl Into<String>) -> Self {
        Self {
            authority: authority.into(),
            headers: BTreeMap::new(),
            prior_knowledge: false,
            protocol: None,
            max_reserved_remote_streams: None,
            session: SessionOptions::default(),
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
    let encrypted = authority.starts_with("https://");
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
        connecting: false,
        encrypted,
        alpn_protocol: if encrypted {
            Some("h2".to_string())
        } else {
            None
        },
        origin_set: vec![authority.to_string()],
        pending_settings_ack: false,
        refed: true,
        session_type: NGHTTP2_SESSION_CLIENT,
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
