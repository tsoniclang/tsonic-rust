use crate::error::{NodeError, NodeResult};
use crate::http::Response;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectOptions {
    pub host: Option<String>,
    pub servername: String,
    pub port: u16,
    pub path: Option<String>,
    pub alpn_protocols: Vec<String>,
    pub reject_unauthorized: bool,
    pub request_ocsp: bool,
    pub session: Option<Vec<u8>>,
    pub min_version: Option<String>,
    pub max_version: Option<String>,
    pub timeout: Option<u64>,
    pub min_dh_size: Option<u32>,
    pub check_server_identity: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SecureContextOptions {
    pub key: Option<String>,
    pub cert: Option<String>,
    pub pfx: Option<String>,
    pub passphrase: Option<String>,
    pub ca: Vec<String>,
    pub alpn_protocols: Vec<String>,
    pub ciphers: Option<String>,
    pub sigalgs: Option<String>,
    pub min_version: Option<String>,
    pub max_version: Option<String>,
    pub honor_cipher_order: bool,
    pub dhparam: Option<String>,
    pub crl: Vec<String>,
    pub ecdh_curve: Option<String>,
    pub client_cert_engine: Option<String>,
    pub private_key_engine: Option<String>,
    pub private_key_identifier: Option<String>,
    pub session_id_context: Option<String>,
    pub session_timeout: Option<u64>,
    pub ticket_keys: Option<Vec<u8>>,
    pub secure_options: Option<i64>,
    pub secure_protocol: Option<String>,
    pub allow_partial_trust_chain: bool,
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
    authorization_error: Option<String>,
    alpn_protocol: Option<String>,
    session: Vec<u8>,
    reused_session: bool,
    cipher: CipherInfo,
    peer_certificate: Certificate,
    local_certificate: Certificate,
    ephemeral_key_info: EphemeralKeyInfo,
    trace_enabled: bool,
    protocol: String,
    encrypted: bool,
    tls_ticket: Vec<u8>,
    renegotiation_disabled: bool,
    max_send_fragment: Option<usize>,
    key_cert_context: Option<SecureContext>,
}

impl TlsSocket {
    pub fn servername(&self) -> &str {
        &self.servername
    }

    pub fn authorized(&self) -> bool {
        self.authorized
    }

    pub fn authorization_error(&self) -> Option<&str> {
        self.authorization_error.as_deref()
    }

    pub fn alpn_protocol(&self) -> Option<&str> {
        self.alpn_protocol.as_deref()
    }

    pub fn get_cipher(&self) -> &CipherInfo {
        &self.cipher
    }

    pub fn get_peer_certificate(&self) -> &Certificate {
        &self.peer_certificate
    }

    pub fn get_certificate(&self) -> &Certificate {
        &self.local_certificate
    }

    pub fn get_ephemeral_key_info(&self) -> &EphemeralKeyInfo {
        &self.ephemeral_key_info
    }

    pub fn get_session(&self) -> &[u8] {
        &self.session
    }

    pub fn is_session_reused(&self) -> bool {
        self.reused_session
    }

    pub fn get_finished(&self) -> Vec<u8> {
        deterministic_tls_bytes(&self.servername, "finished")
    }

    pub fn get_peer_finished(&self) -> Vec<u8> {
        deterministic_tls_bytes(&self.servername, "peer-finished")
    }

    pub fn get_shared_sigalgs(&self) -> Vec<String> {
        vec![
            "rsa_pss_rsae_sha256".to_string(),
            "ecdsa_secp256r1_sha256".to_string(),
        ]
    }

    pub fn set_ticket_keys(&mut self, keys: &[u8]) -> NodeResult<()> {
        if keys.len() != 48 {
            return Err(NodeError::new(
                "ERR_INVALID_ARG_VALUE",
                "ticket keys must be 48 bytes",
            ));
        }
        self.session = keys.to_vec();
        Ok(())
    }

    pub fn enable_trace(&mut self) {
        self.trace_enabled = true;
    }

    pub fn trace_enabled(&self) -> bool {
        self.trace_enabled
    }

    pub fn get_protocol(&self) -> Option<&str> {
        Some(&self.protocol)
    }

    pub fn encrypted(&self) -> bool {
        self.encrypted
    }

    pub fn export_keying_material(&self, length: usize, label: &str, context: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(length);
        let seed = format!("keying:{}:{}:{context:?}", self.servername, label);
        while output.len() < length {
            output.extend_from_slice(seed.as_bytes());
        }
        output.truncate(length);
        output
    }

    pub fn get_tls_ticket(&self) -> &[u8] {
        &self.tls_ticket
    }

    pub fn disable_renegotiation(&mut self) {
        self.renegotiation_disabled = true;
    }

    pub fn renegotiation_disabled(&self) -> bool {
        self.renegotiation_disabled
    }

    pub fn set_max_send_fragment(&mut self, size: usize) -> bool {
        if (512..=16_384).contains(&size) {
            self.max_send_fragment = Some(size);
            true
        } else {
            false
        }
    }

    pub fn max_send_fragment(&self) -> Option<usize> {
        self.max_send_fragment
    }

    pub fn set_key_cert(&mut self, context: SecureContext) {
        self.key_cert_context = Some(context);
    }

    pub fn key_cert_context(&self) -> Option<&SecureContext> {
        self.key_cert_context.as_ref()
    }
}

impl ConnectOptions {
    pub fn new(servername: impl Into<String>, port: u16) -> Self {
        Self {
            servername: servername.into(),
            host: None,
            port,
            path: None,
            alpn_protocols: Vec::new(),
            reject_unauthorized: true,
            request_ocsp: false,
            session: None,
            min_version: None,
            max_version: None,
            timeout: None,
            min_dh_size: None,
            check_server_identity: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CipherInfo {
    pub name: String,
    pub standard_name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Certificate {
    pub ca: bool,
    pub subject: String,
    pub issuer: String,
    pub subjectaltname: String,
    pub info_access: String,
    pub valid_from: String,
    pub valid_to: String,
    pub fingerprint: String,
    pub fingerprint256: String,
    pub fingerprint512: String,
    pub serial_number: String,
    pub raw: Vec<u8>,
    pub bits: Option<u32>,
    pub exponent: Option<String>,
    pub modulus: Option<String>,
    pub pubkey: Option<Vec<u8>>,
    pub asn1_curve: Option<String>,
    pub nist_curve: Option<String>,
    pub ext_key_usage: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EphemeralKeyInfo {
    pub r#type: String,
    pub name: String,
    pub size: u32,
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
    if options.check_server_identity {
        check_server_identity(&options.servername)?;
    }
    let session = options
        .session
        .clone()
        .unwrap_or_else(|| deterministic_tls_bytes(&options.servername, "session"));
    let protocol = options
        .min_version
        .clone()
        .unwrap_or_else(|| "TLSv1.3".to_string());
    Ok(TlsSocket {
        servername: options.servername.clone(),
        authorized: options.reject_unauthorized,
        authorization_error: (!options.reject_unauthorized)
            .then(|| "UNABLE_TO_VERIFY_LEAF_SIGNATURE".to_string()),
        alpn_protocol: options.alpn_protocols.first().cloned(),
        reused_session: options.session.is_some(),
        session,
        cipher: CipherInfo {
            name: "TLS_AES_256_GCM_SHA384".to_string(),
            standard_name: "TLS_AES_256_GCM_SHA384".to_string(),
            version: protocol.clone(),
        },
        peer_certificate: certificate_for(&options.servername),
        local_certificate: certificate_for("localhost"),
        ephemeral_key_info: EphemeralKeyInfo {
            r#type: "ECDH".to_string(),
            name: "X25519".to_string(),
            size: 253,
        },
        trace_enabled: false,
        protocol,
        encrypted: true,
        tls_ticket: deterministic_tls_bytes(&options.servername, "ticket"),
        renegotiation_disabled: false,
        max_send_fragment: None,
        key_cert_context: None,
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

fn certificate_for(servername: &str) -> Certificate {
    Certificate {
        ca: false,
        subject: format!("CN={servername}"),
        issuer: "CN=tsonic-local-test-ca".to_string(),
        subjectaltname: format!("DNS:{servername}"),
        info_access: String::new(),
        valid_from: "1970-01-01T00:00:00Z".to_string(),
        valid_to: "9999-12-31T23:59:59Z".to_string(),
        fingerprint: hexish(servername, 20),
        fingerprint256: hexish(servername, 32),
        fingerprint512: hexish(servername, 64),
        serial_number: hexish(servername, 8),
        raw: servername.as_bytes().to_vec(),
        bits: Some(2048),
        exponent: Some("0x10001".to_string()),
        modulus: None,
        pubkey: Some(deterministic_tls_bytes(servername, "pubkey")),
        asn1_curve: Some("prime256v1".to_string()),
        nist_curve: Some("P-256".to_string()),
        ext_key_usage: vec!["serverAuth".to_string()],
    }
}

fn deterministic_tls_bytes(servername: &str, label: &str) -> Vec<u8> {
    let mut output = Vec::with_capacity(32);
    let seed = format!("{label}:{servername}");
    while output.len() < 32 {
        output.extend_from_slice(seed.as_bytes());
    }
    output.truncate(32);
    output
}

fn hexish(input: &str, bytes: usize) -> String {
    deterministic_tls_bytes(input, "cert")
        .into_iter()
        .take(bytes)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}
