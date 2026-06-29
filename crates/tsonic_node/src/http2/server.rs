#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerOptions {
    pub allow_http1: bool,
    pub settings: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Settings {
    pub header_table_size: u32,
    pub enable_connect_protocol: Option<bool>,
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
            enable_connect_protocol: None,
            enable_push: true,
            initial_window_size: 65_535,
            max_frame_size: 16_384,
            max_concurrent_streams: None,
            max_header_list_size: None,
        }
    }
}

pub type Settings = Http2Settings;

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

pub type SessionState = Http2SessionState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Server {
    secure: bool,
    options: ServerOptions,
    closed: bool,
    timeout: Option<u64>,
}

pub type Http2ServerCommon = Http2Server;

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

    pub fn update_settings(&mut self, settings: Settings) {
        self.options
            .settings
            .insert("headerTableSize".to_string(), settings.header_table_size);
        self.options
            .settings
            .insert("enablePush".to_string(), u32::from(settings.enable_push));
        if let Some(enable_connect_protocol) = settings.enable_connect_protocol {
            self.options.settings.insert(
                "enableConnectProtocol".to_string(),
                u32::from(enable_connect_protocol),
            );
        }
        self.options.settings.insert(
            "initialWindowSize".to_string(),
            settings.initial_window_size,
        );
        self.options
            .settings
            .insert("maxFrameSize".to_string(), settings.max_frame_size);
        if let Some(max_concurrent_streams) = settings.max_concurrent_streams {
            self.options
                .settings
                .insert("maxConcurrentStreams".to_string(), max_concurrent_streams);
        }
        if let Some(max_header_list_size) = settings.max_header_list_size {
            self.options
                .settings
                .insert("maxHeaderListSize".to_string(), max_header_list_size);
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
