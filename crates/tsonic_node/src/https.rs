use std::collections::BTreeMap;

use crate::error::{NodeError, NodeResult};
use crate::http::{IncomingMessage, Response, ServerResponse};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestOptions {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerOptions {
    pub key: Option<String>,
    pub cert: Option<String>,
    pub ca: Vec<String>,
    pub alpn_protocols: Vec<String>,
}

type HttpsRequestHandler = dyn Fn(IncomingMessage, &mut ServerResponse) + Send + Sync;

pub struct Server {
    options: ServerOptions,
    handler: Box<HttpsRequestHandler>,
}

impl Server {
    pub fn new(
        options: ServerOptions,
        handler: impl Fn(IncomingMessage, &mut ServerResponse) + Send + Sync + 'static,
    ) -> Self {
        Self {
            options,
            handler: Box::new(handler),
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

    pub fn close(&self) {}
}

impl RequestOptions {
    pub fn get(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: "GET".to_string(),
            headers: BTreeMap::new(),
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
