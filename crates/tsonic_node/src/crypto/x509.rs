#[derive(Debug, Clone, PartialEq, Eq)]
pub struct X509Certificate {
    raw: Buffer,
    subject: String,
    issuer: String,
    valid_from: String,
    valid_to: String,
    fingerprint: String,
    fingerprint256: String,
    fingerprint512: String,
    key_usage: Vec<String>,
    subject_alt_name: Option<String>,
    info_access: Option<String>,
    serial_number: String,
    signature_algorithm: Option<String>,
    signature_algorithm_oid: String,
    ca: bool,
    public_key: KeyObject,
    issuer_certificate: Option<Box<X509Certificate>>,
}

impl X509Certificate {
    pub fn new(raw: Buffer) -> Self {
        let fingerprint = match hash("sha1", &raw.as_bytes(), Some("hex")) {
            Ok(DigestResult::String(value)) => value,
            _ => String::new(),
        };
        let fingerprint256 = match hash("sha256", &raw.as_bytes(), Some("hex")) {
            Ok(DigestResult::String(value)) => value,
            _ => String::new(),
        };
        let fingerprint512 = match hash("sha512", &raw.as_bytes(), Some("hex")) {
            Ok(DigestResult::String(value)) => value,
            _ => String::new(),
        };
        Self {
            raw: raw.clone(),
            subject: String::new(),
            issuer: String::new(),
            valid_from: String::new(),
            valid_to: String::new(),
            fingerprint,
            fingerprint256,
            fingerprint512,
            key_usage: Vec::new(),
            subject_alt_name: None,
            info_access: None,
            serial_number: String::new(),
            signature_algorithm: None,
            signature_algorithm_oid: String::new(),
            ca: false,
            public_key: create_secret_key(&raw),
            issuer_certificate: None,
        }
    }

    pub fn raw(&self) -> Buffer {
        self.raw.clone()
    }

    pub fn subject(&self) -> &str {
        &self.subject
    }

    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    pub fn valid_from(&self) -> &str {
        &self.valid_from
    }

    pub fn valid_to(&self) -> &str {
        &self.valid_to
    }

    pub fn valid_from_date(&self) -> JsDate {
        JsDate::parse(&self.valid_from).unwrap_or_else(|_| JsDate::from_millis(0.0))
    }

    pub fn valid_to_date(&self) -> JsDate {
        JsDate::parse(&self.valid_to).unwrap_or_else(|_| JsDate::from_millis(0.0))
    }

    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    pub fn fingerprint256(&self) -> &str {
        &self.fingerprint256
    }

    pub fn fingerprint512(&self) -> &str {
        &self.fingerprint512
    }

    pub fn key_usage(&self) -> &[String] {
        &self.key_usage
    }

    pub fn subject_alt_name(&self) -> Option<&str> {
        self.subject_alt_name.as_deref()
    }

    pub fn info_access(&self) -> Option<&str> {
        self.info_access.as_deref()
    }

    pub fn serial_number(&self) -> &str {
        &self.serial_number
    }

    pub fn signature_algorithm(&self) -> Option<&str> {
        self.signature_algorithm.as_deref()
    }

    pub fn signature_algorithm_oid(&self) -> &str {
        &self.signature_algorithm_oid
    }

    pub fn ca(&self) -> bool {
        self.ca
    }

    pub fn public_key(&self) -> KeyObject {
        self.public_key.clone()
    }

    pub fn issuer_certificate(&self) -> Option<&X509Certificate> {
        self.issuer_certificate.as_deref()
    }

    pub fn check_issued(&self, other_cert: &X509Certificate) -> bool {
        !self.issuer.is_empty() && self.issuer == other_cert.subject
    }

    pub fn check_private_key(&self, private_key: &KeyObject) -> bool {
        self.public_key.equals(private_key)
    }

    pub fn verify(&self, public_key: &KeyObject) -> bool {
        self.public_key.equals(public_key)
    }

    pub fn check_host(&self, name: &str, _options: Option<&X509CheckOptions>) -> Option<String> {
        if self.subject == name || self.subject_alt_name.as_deref() == Some(name) {
            Some(name.to_string())
        } else {
            None
        }
    }

    pub fn check_email(&self, email: &str, _options: Option<&X509CheckOptions>) -> Option<String> {
        if self.subject == email || self.subject_alt_name.as_deref() == Some(email) {
            Some(email.to_string())
        } else {
            None
        }
    }

    pub fn check_ip(&self, ip: &str) -> Option<String> {
        if self.subject_alt_name.as_deref() == Some(ip) {
            Some(ip.to_string())
        } else {
            None
        }
    }

    pub fn to_json(&self) -> String {
        self.to_string()
    }

    pub fn to_legacy_object(&self) -> X509CertificateLegacyObject {
        X509CertificateLegacyObject {
            subject: self.subject.clone(),
            issuer: self.issuer.clone(),
            valid_from: self.valid_from.clone(),
            valid_to: self.valid_to.clone(),
            fingerprint256: self.fingerprint256.clone(),
        }
    }
}

impl std::fmt::Display for X509Certificate {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}",
            self.raw.to_string(Some("base64")).unwrap_or_default()
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct X509CertificateLegacyObject {
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub fingerprint256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct X509CheckOptions {
    pub subject: Option<String>,
    pub wildcards: Option<bool>,
    pub partial_wildcards: Option<bool>,
    pub multi_label_wildcards: Option<bool>,
    pub single_label_subdomains: Option<bool>,
}

pub fn random_uuid() -> NodeResult<String> {
    let bytes = random_bytes(16)?.as_bytes();
    let mut bytes: [u8; 16] = bytes.try_into().unwrap();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    ))
}

pub fn random_uuid_with_options(_options: RandomUUIDOptions) -> NodeResult<String> {
    random_uuid()
}
