use std::collections::BTreeMap;

use crate::error::{NodeError, NodeResult};
use crate::http::{IncomingMessage, Response, ServerResponse};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentOptions {
    pub keep_alive: bool,
    pub keep_alive_msecs: u64,
    pub max_sockets: usize,
    pub max_free_sockets: usize,
    pub max_cached_sessions: usize,
    pub timeout: Option<u64>,
    pub reject_unauthorized: bool,
    pub servername: Option<String>,
}

impl Default for AgentOptions {
    fn default() -> Self {
        Self {
            keep_alive: false,
            keep_alive_msecs: 1_000,
            max_sockets: usize::MAX,
            max_free_sockets: 256,
            max_cached_sessions: 100,
            timeout: None,
            reject_unauthorized: true,
            servername: None,
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
            .map(|options| {
                format!(
                    "{}:{}:{}",
                    options.url,
                    options.method,
                    self.options.servername.clone().unwrap_or_default()
                )
            })
            .unwrap_or_else(|| "https://localhost/:GET:".to_string())
    }

    pub fn keep_socket_alive(&self) -> bool {
        self.options.keep_alive
    }

    pub fn reuse_socket(&self) -> bool {
        !self.destroyed
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestOptions {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub timeout: Option<u64>,
    pub agent: Option<Agent>,
    pub auth: Option<String>,
    pub reject_unauthorized: bool,
    pub servername: Option<String>,
    pub check_server_identity: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerOptions {
    pub key: Option<String>,
    pub cert: Option<String>,
    pub ca: Vec<String>,
    pub alpn_protocols: Vec<String>,
    pub request_cert: bool,
    pub reject_unauthorized: bool,
    pub handshake_timeout: Option<u64>,
    pub session_timeout: Option<u64>,
    pub max_cached_sessions: usize,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            key: None,
            cert: None,
            ca: Vec::new(),
            alpn_protocols: Vec::new(),
            request_cert: false,
            reject_unauthorized: true,
            handshake_timeout: None,
            session_timeout: None,
            max_cached_sessions: 100,
        }
    }
}

type HttpsRequestHandler = dyn Fn(IncomingMessage, &mut ServerResponse) + Send + Sync;

pub struct Server {
    options: ServerOptions,
    handler: Box<HttpsRequestHandler>,
    closed: bool,
    idle_closed: bool,
    all_closed: bool,
    timeout: Option<u64>,
}

impl Server {
    pub fn new(
        options: ServerOptions,
        handler: impl Fn(IncomingMessage, &mut ServerResponse) + Send + Sync + 'static,
    ) -> Self {
        Self {
            options,
            handler: Box::new(handler),
            closed: false,
            idle_closed: false,
            all_closed: false,
            timeout: None,
        }
    }

    pub fn options(&self) -> &ServerOptions {
        &self.options
    }

    pub fn handle(&self, request: IncomingMessage) -> Response {
        let mut response = ServerResponse::new();
        (self.handler)(request, &mut response);
        response.to_response()
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

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn close_idle_connections(&mut self) {
        self.idle_closed = true;
    }

    pub fn close_all_connections(&mut self) {
        self.all_closed = true;
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn idle_connections_closed(&self) -> bool {
        self.idle_closed
    }

    pub fn all_connections_closed(&self) -> bool {
        self.all_closed
    }
}

impl RequestOptions {
    pub fn get(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: "GET".to_string(),
            headers: BTreeMap::new(),
            timeout: None,
            agent: None,
            auth: None,
            reject_unauthorized: true,
            servername: None,
            check_server_identity: true,
        }
    }
}

pub fn create_server(
    options: ServerOptions,
    handler: impl Fn(IncomingMessage, &mut ServerResponse) + Send + Sync + 'static,
) -> Server {
    Server::new(options, handler)
}

pub fn get(url: &str) -> NodeResult<Response> {
    request(&RequestOptions::get(url), &[])
}

pub fn request(options: &RequestOptions, body: &[u8]) -> NodeResult<Response> {
    if !options.url.starts_with("https://") {
        return Err(NodeError::new(
            "ERR_INVALID_PROTOCOL",
            "https request requires https:// URL",
        ));
    }
    let client = reqwest::blocking::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(map_reqwest_error)?;
    let method = options
        .method
        .parse::<reqwest::Method>()
        .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))?;
    let mut request = client.request(method, &options.url);
    for (name, value) in &options.headers {
        request = request.header(name, value);
    }
    let response = request
        .body(body.to_vec())
        .send()
        .map_err(map_reqwest_error)?;
    response_to_node(response)
}

pub(crate) fn response_to_node(response: reqwest::blocking::Response) -> NodeResult<Response> {
    let status_code = response.status().as_u16();
    let status_message = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_ascii_lowercase(),
                value.to_str().unwrap_or("").to_string(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let body = response.bytes().map_err(map_reqwest_error)?.to_vec();
    Ok(Response {
        status_code,
        status_message,
        headers,
        body,
    })
}

fn map_reqwest_error(error: reqwest::Error) -> NodeError {
    NodeError::new("ERR_NETWORK", error.to_string())
}
