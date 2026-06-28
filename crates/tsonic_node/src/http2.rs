use std::collections::BTreeMap;

use crate::error::{NodeError, NodeResult};
use crate::http::Response;
use crate::https::response_to_node;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientSessionOptions {
    pub authority: String,
    pub headers: BTreeMap<String, String>,
    pub prior_knowledge: bool,
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

fn map_reqwest_error(error: reqwest::Error) -> NodeError {
    NodeError::new("ERR_HTTP2_SESSION_ERROR", error.to_string())
}
