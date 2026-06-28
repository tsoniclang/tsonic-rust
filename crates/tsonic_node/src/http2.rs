use std::collections::BTreeMap;

use crate::error::{NodeError, NodeResult};
use crate::http::Response;
use crate::https::response_to_node;
use std::sync::atomic::{AtomicU64, Ordering};

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

    pub fn close(&mut self) {
        self.closed = true;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Stream {
    id: u64,
    headers: BTreeMap<String, String>,
    data: Vec<u8>,
    closed: bool,
}

impl Http2Stream {
    pub fn new(headers: BTreeMap<String, String>) -> Self {
        Self {
            id: NEXT_HTTP2_ID.fetch_add(1, Ordering::SeqCst),
            headers,
            data: Vec::new(),
            closed: false,
        }
    }

    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn headers(&self) -> &BTreeMap<String, String> {
        &self.headers
    }

    pub fn write(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }

    pub fn end(&mut self) {
        self.closed = true;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerOptions {
    pub allow_http1: bool,
    pub settings: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Http2Server {
    secure: bool,
    options: ServerOptions,
}

impl Http2Server {
    pub fn options(&self) -> &ServerOptions {
        &self.options
    }

    pub fn secure(&self) -> bool {
        self.secure
    }

    pub fn close(&self) {}
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
    })
}

pub fn create_server(options: ServerOptions) -> Http2Server {
    Http2Server {
        secure: false,
        options,
    }
}

pub fn create_secure_server(options: ServerOptions) -> Http2Server {
    Http2Server {
        secure: true,
        options,
    }
}

fn map_reqwest_error(error: reqwest::Error) -> NodeError {
    NodeError::new("ERR_HTTP2_SESSION_ERROR", error.to_string())
}

static NEXT_HTTP2_ID: AtomicU64 = AtomicU64::new(1);
