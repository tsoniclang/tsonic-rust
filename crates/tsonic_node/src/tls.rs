use crate::error::{NodeError, NodeResult};
use crate::http::Response;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectOptions {
    pub servername: String,
    pub port: u16,
    pub alpn_protocols: Vec<String>,
}

impl ConnectOptions {
    pub fn new(servername: impl Into<String>, port: u16) -> Self {
        Self {
            servername: servername.into(),
            port,
            alpn_protocols: Vec::new(),
        }
    }
}

pub fn check_server_identity(servername: &str) -> NodeResult<()> {
    if servername.trim().is_empty() || servername.contains('/') {
        return Err(NodeError::new(
            "ERR_TLS_CERT_ALTNAME_INVALID",
            "invalid TLS server name",
        ));
    }
    Ok(())
}

pub fn connect_get(options: &ConnectOptions, path: &str) -> NodeResult<Response> {
    check_server_identity(&options.servername)?;
    let url = format!("https://{}:{}{}", options.servername, options.port, path);
    crate::https::get(&url)
}

pub fn default_port() -> u16 {
    443
}
