use crate::error::{NodeError, NodeResult};
use crate::http::Response;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectOptions {
    pub servername: String,
    pub port: u16,
    pub alpn_protocols: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SecureContextOptions {
    pub key: Option<String>,
    pub cert: Option<String>,
    pub ca: Vec<String>,
    pub alpn_protocols: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecureContext {
    options: SecureContextOptions,
}

impl SecureContext {
    pub fn options(&self) -> &SecureContextOptions {
        &self.options
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsSocket {
    servername: String,
    authorized: bool,
    alpn_protocol: Option<String>,
}

impl TlsSocket {
    pub fn servername(&self) -> &str {
        &self.servername
    }

    pub fn authorized(&self) -> bool {
        self.authorized
    }

    pub fn alpn_protocol(&self) -> Option<&str> {
        self.alpn_protocol.as_deref()
    }
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

pub fn create_secure_context(options: SecureContextOptions) -> SecureContext {
    SecureContext { options }
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

pub fn connect(options: &ConnectOptions) -> NodeResult<TlsSocket> {
    check_server_identity(&options.servername)?;
    Ok(TlsSocket {
        servername: options.servername.clone(),
        authorized: true,
        alpn_protocol: options.alpn_protocols.first().cloned(),
    })
}

pub fn connect_get(options: &ConnectOptions, path: &str) -> NodeResult<Response> {
    check_server_identity(&options.servername)?;
    let url = format!("https://{}:{}{}", options.servername, options.port, path);
    crate::https::get(&url)
}

pub fn default_port() -> u16 {
    443
}
