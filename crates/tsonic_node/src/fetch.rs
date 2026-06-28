use tsonic_js::web::{AbortSignal, Body, Headers, Request, Response};

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone)]
pub struct FetchInit {
    pub method: String,
    pub headers: Headers,
    pub body: Body,
    pub signal: Option<AbortSignal>,
}

impl Default for FetchInit {
    fn default() -> Self {
        Self {
            method: "GET".to_string(),
            headers: Headers::new(),
            body: Body::Empty,
            signal: None,
        }
    }
}

pub fn fetch(url: &str, init: Option<FetchInit>) -> NodeResult<Response> {
    let init = init.unwrap_or_default();
    if let Some(signal) = &init.signal {
        if signal.aborted() {
            return Err(NodeError::new(
                "ABORT_ERR",
                format!("operation aborted: {}", signal.reason()),
            ));
        }
    }
    let request = Request::with_init(
        url,
        init.method,
        init.headers,
        init.body,
        init.signal.clone(),
    );
    fetch_request(&request)
}

pub fn fetch_request(request: &Request) -> NodeResult<Response> {
    if let Some(signal) = request.signal() {
        if signal.aborted() {
            return Err(NodeError::new(
                "ABORT_ERR",
                format!("operation aborted: {}", signal.reason()),
            ));
        }
    }
    let method = request
        .method()
        .parse::<reqwest::Method>()
        .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))?;
    let client = reqwest::blocking::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(map_reqwest_error)?;
    let mut builder = client.request(method, request.url());
    for (key, value) in request.headers().entries() {
        builder = builder.header(key, value);
    }
    let response = builder
        .body(request.body().bytes())
        .send()
        .map_err(map_reqwest_error)?;
    response_to_web(response)
}

fn response_to_web(response: reqwest::blocking::Response) -> NodeResult<Response> {
    let status = response.status();
    let mut headers = Headers::new();
    for (key, value) in response.headers() {
        headers.append(key.as_str(), value.to_str().unwrap_or(""));
    }
    let bytes = response.bytes().map_err(map_reqwest_error)?.to_vec();
    Ok(Response::with_init(
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        headers,
        Body::Bytes(bytes),
    ))
}

fn map_reqwest_error(error: reqwest::Error) -> NodeError {
    NodeError::new("ERR_NETWORK", error.to_string())
}
