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
    pub socket: Option<net::SocketAddress>,
    pub trailers_distinct: BTreeMap<String, Vec<String>>,
    timeout: Option<u64>,
    destroyed: bool,
    listeners: HttpListenerMap,
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
            socket: None,
            trailers_distinct: BTreeMap::new(),
            timeout: None,
            destroyed: false,
            listeners: BTreeMap::new(),
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

    pub fn read(&mut self) -> Option<Buffer> {
        self.body.read()
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

    pub fn socket(&self) -> Option<&net::SocketAddress> {
        self.socket.as_ref()
    }

    pub fn connection(&self) -> Option<&net::SocketAddress> {
        self.socket()
    }

    pub fn add_listener(&mut self, event: &str) -> &mut Self {
        http_add_listener(&mut self.listeners, event, false);
        self
    }

    pub fn on(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn once(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_listener(&mut self, event: &str) -> &mut Self {
        http_add_listener(&mut self.listeners, event, true);
        self
    }

    pub fn prepend_once_listener(&mut self, event: &str) -> &mut Self {
        self.prepend_listener(event)
    }

    pub fn remove_listener(&mut self, event: &str) -> &mut Self {
        http_remove_listener(&mut self.listeners, event);
        self
    }

    pub fn off(&mut self, event: &str) -> &mut Self {
        self.remove_listener(event)
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        http_remove_all_listeners(&mut self.listeners, event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        http_listeners(&self.listeners, event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<String> {
        self.listeners(event)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.listeners.get(event).map_or(0, Vec::len)
    }

    pub fn emit(&self, event: &str) -> bool {
        self.listener_count(event) > 0
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
    pub chunked_encoding: bool,
    pub use_chunked_encoding_by_default: bool,
    pub req: Option<String>,
    body: Writable,
    timeout: Option<u64>,
    finished: bool,
    listeners: HttpListenerMap,
    assigned_socket: Option<net::SocketAddress>,
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
            chunked_encoding: false,
            use_chunked_encoding_by_default: true,
            req: None,
            body: Writable::new(),
            timeout: None,
            finished: false,
            listeners: BTreeMap::new(),
            assigned_socket: None,
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

    pub fn set_status_code(&mut self, status_code: u16) {
        self.status_code = status_code;
        self.status_message = canonical_status_message(status_code).to_string();
    }

    pub fn set_status_message(&mut self, status_message: &str) {
        self.status_message = status_message.to_string();
    }

    pub fn writable_ended(&self) -> bool {
        self.finished
    }

    pub fn assign_socket(&mut self, socket: net::SocketAddress) {
        self.assigned_socket = Some(socket);
    }

    pub fn detach_socket(&mut self) -> Option<net::SocketAddress> {
        self.assigned_socket.take()
    }

    pub fn socket(&self) -> Option<&net::SocketAddress> {
        self.assigned_socket.as_ref()
    }

    pub fn connection(&self) -> Option<&net::SocketAddress> {
        self.socket()
    }

    pub fn add_listener(&mut self, event: &str) -> &mut Self {
        http_add_listener(&mut self.listeners, event, false);
        self
    }

    pub fn on(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn once(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_listener(&mut self, event: &str) -> &mut Self {
        http_add_listener(&mut self.listeners, event, true);
        self
    }

    pub fn prepend_once_listener(&mut self, event: &str) -> &mut Self {
        self.prepend_listener(event)
    }

    pub fn remove_listener(&mut self, event: &str) -> &mut Self {
        http_remove_listener(&mut self.listeners, event);
        self
    }

    pub fn off(&mut self, event: &str) -> &mut Self {
        self.remove_listener(event)
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        http_remove_all_listeners(&mut self.listeners, event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        http_listeners(&self.listeners, event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<String> {
        self.listeners(event)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.listeners.get(event).map_or(0, Vec::len)
    }

    pub fn emit(&self, event: &str) -> bool {
        self.listener_count(event) > 0
    }
}

pub type OutgoingMessage = ServerResponse;
