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

    pub fn push_allowed(&self) -> bool {
        !self.closed && !self.destroyed
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
