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
    body: Writable,
    finished: bool,
    destroyed: bool,
    listeners: HttpListenerMap,
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
            body: Writable::new(),
            finished: false,
            destroyed: false,
            listeners: BTreeMap::new(),
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

    pub fn finished(&self) -> bool {
        self.finished
    }

    pub fn body(&self) -> &[Buffer] {
        self.body.chunks()
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
        self.abort();
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn get_raw_header_names(&self) -> Vec<String> {
        self.options.headers.keys().cloned().collect()
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

type RequestHandler = dyn Fn(IncomingMessage, &mut ServerResponse) + Send + Sync;

pub struct Server {
    pub options: ServerOptions,
    pub timeout: u64,
    pub request_timeout: u64,
    pub headers_timeout: u64,
    pub keep_alive_timeout: u64,
    pub keep_alive_timeout_buffer: u64,
    pub max_headers_count: Option<usize>,
    pub max_requests_per_socket: Option<usize>,
    handler: Box<RequestHandler>,
    listeners: HttpListenerMap,
}

impl Server {
    pub fn new(
        handler: impl Fn(IncomingMessage, &mut ServerResponse) + Send + Sync + 'static,
    ) -> Self {
        Self::with_options(ServerOptions::default(), handler)
    }

    pub fn with_options(
        options: ServerOptions,
        handler: impl Fn(IncomingMessage, &mut ServerResponse) + Send + Sync + 'static,
    ) -> Self {
        Self {
            timeout: 0,
            request_timeout: options.request_timeout,
            headers_timeout: options.headers_timeout,
            keep_alive_timeout: options.keep_alive_timeout,
            keep_alive_timeout_buffer: options.keep_alive_timeout_buffer,
            max_headers_count: Some(2_000),
            max_requests_per_socket: None,
            options,
            handler: Box::new(handler),
            listeners: BTreeMap::new(),
        }
    }

    pub fn handle(&self, request: IncomingMessage) -> Response {
        let mut response = ServerResponse::new();
        (self.handler)(request, &mut response);
        response.to_response()
    }

    pub fn close(&self) {}

    pub fn close_idle_connections(&self) {}

    pub fn close_all_connections(&self) {}

    pub fn set_timeout(&mut self, msecs: u64, callback: Option<impl FnOnce()>) -> &mut Self {
        self.timeout = msecs;
        if let Some(callback) = callback {
            callback();
        }
        self
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
