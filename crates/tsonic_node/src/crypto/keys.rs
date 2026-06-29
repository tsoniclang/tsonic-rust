#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyObject {
    key_type: String,
    bytes: Buffer,
    asymmetric_key_type: Option<String>,
    asymmetric_key_details: Option<AsymmetricKeyDetails>,
    extractable: bool,
    key_usages: Vec<String>,
    algorithm: Option<KeyAlgorithm>,
}

impl KeyObject {
    pub fn key_type(&self) -> &str {
        &self.key_type
    }

    pub fn symmetric_key_size(&self) -> Option<usize> {
        if self.key_type == "secret" {
            Some(self.bytes.len())
        } else {
            None
        }
    }

    pub fn asymmetric_key_type(&self) -> Option<&str> {
        self.asymmetric_key_type.as_deref()
    }

    pub fn asymmetric_key_details(&self) -> Option<&AsymmetricKeyDetails> {
        self.asymmetric_key_details.as_ref()
    }

    pub fn extractable(&self) -> bool {
        self.extractable
    }

    pub fn key_usages(&self) -> &[String] {
        &self.key_usages
    }

    pub fn algorithm(&self) -> Option<&KeyAlgorithm> {
        self.algorithm.as_ref()
    }

    pub fn export(&self) -> Buffer {
        self.bytes.clone()
    }

    pub fn export_with_options(&self, options: KeyExportOptions) -> NodeResult<KeyExportResult> {
        match options.encoding.as_deref() {
            None => Ok(KeyExportResult::Buffer(self.export())),
            Some(encoding) => Ok(KeyExportResult::String(self.export_string(encoding)?)),
        }
    }

    pub fn export_string(&self, encoding: &str) -> NodeResult<String> {
        self.bytes.to_string(Some(encoding))
    }

    pub fn equals(&self, other: &Self) -> bool {
        self.key_type == other.key_type && self.bytes == other.bytes
    }
}

pub fn create_secret_key(key: &Buffer) -> KeyObject {
    KeyObject {
        key_type: "secret".to_string(),
        bytes: key.clone(),
        asymmetric_key_type: None,
        asymmetric_key_details: None,
        extractable: true,
        key_usages: Vec::new(),
        algorithm: Some(KeyAlgorithm {
            name: "secret".to_string(),
        }),
    }
}

pub fn create_secret_key_bytes(key: &[u8]) -> KeyObject {
    KeyObject {
        key_type: "secret".to_string(),
        bytes: Buffer::from_bytes(key.to_vec()),
        asymmetric_key_type: None,
        asymmetric_key_details: None,
        extractable: true,
        key_usages: Vec::new(),
        algorithm: Some(KeyAlgorithm {
            name: "secret".to_string(),
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AsymmetricKeyDetails {
    pub modulus_length: Option<usize>,
    pub public_exponent: Option<u64>,
    pub hash_algorithm: Option<String>,
    pub mgf1_hash_algorithm: Option<String>,
    pub salt_length: Option<usize>,
    pub named_curve: Option<String>,
    pub divisor_length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyExportOptions {
    pub format: String,
    pub r#type: Option<String>,
    pub cipher: Option<String>,
    pub passphrase: Option<String>,
    pub encoding: Option<String>,
}

impl Default for KeyExportOptions {
    fn default() -> Self {
        Self {
            format: "buffer".to_string(),
            r#type: None,
            cipher: None,
            passphrase: None,
            encoding: None,
        }
    }
}

pub type PrivateKeyExportOptions = KeyExportOptions;
pub type PublicKeyExportOptions = KeyExportOptions;
pub type SymmetricKeyExportOptions = KeyExportOptions;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyExportResult {
    Buffer(Buffer),
    String(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RsaOtherPrimesInfo {
    pub r: Option<String>,
    pub d: Option<String>,
    pub t: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonWebKey {
    pub kty: Option<String>,
    pub crv: Option<String>,
    pub x: Option<String>,
    pub y: Option<String>,
    pub d: Option<String>,
    pub n: Option<String>,
    pub e: Option<String>,
    pub k: Option<String>,
    pub p: Option<String>,
    pub q: Option<String>,
    pub dp: Option<String>,
    pub dq: Option<String>,
    pub qi: Option<String>,
    pub oth: Vec<RsaOtherPrimesInfo>,
    pub alg: Option<String>,
    pub key_use: Option<String>,
    pub key_ops: Vec<String>,
    pub ext: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonWebKeyInput {
    pub key: JsonWebKey,
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JwkKeyExportOptions {
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrivateKeyInput {
    pub key: Buffer,
    pub format: Option<String>,
    pub r#type: Option<String>,
    pub encoding: Option<String>,
    pub passphrase: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicKeyInput {
    pub key: Buffer,
    pub format: Option<String>,
    pub r#type: Option<String>,
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaPrivateKeyInput {
    pub key: Buffer,
    pub padding: Option<i32>,
    pub oaep_hash: Option<String>,
    pub oaep_label: Option<Buffer>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaPublicKeyInput {
    pub key: Buffer,
    pub padding: Option<i32>,
}
