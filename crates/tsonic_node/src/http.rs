use std::collections::BTreeMap;

use crate::error::{NodeError, NodeResult};
use crate::net;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestOptions {
    pub host: String,
    pub port: u16,
    pub path: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
}

impl RequestOptions {
    pub fn get(host: impl Into<String>, port: u16, path: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port,
            path: path.into(),
            method: "GET".to_string(),
            headers: BTreeMap::new(),
        }
    }
}

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
