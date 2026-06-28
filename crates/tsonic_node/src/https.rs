use std::collections::BTreeMap;

use crate::error::{NodeError, NodeResult};
use crate::http::Response;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestOptions {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
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
