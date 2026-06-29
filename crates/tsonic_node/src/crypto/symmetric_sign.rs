#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AesGcmCiphertext {
    pub ciphertext: Buffer,
    pub auth_tag: Buffer,
}

pub fn aes_256_gcm_encrypt(
    key: &Buffer,
    iv: &Buffer,
    plaintext: &Buffer,
) -> NodeResult<AesGcmCiphertext> {
    if key.len() != 32 {
        return Err(NodeError::new(
            "ERR_CRYPTO_INVALID_KEYLEN",
            "AES-256-GCM key must be 32 bytes",
        ));
    }
    if iv.len() != 12 {
        return Err(NodeError::new(
            "ERR_CRYPTO_INVALID_IV",
            "AES-256-GCM iv must be 12 bytes",
        ));
    }
    let cipher = Aes256Gcm::new_from_slice(&key.as_bytes())
        .map_err(|error| NodeError::new("ERR_CRYPTO_INVALID_KEY", error.to_string()))?;
    let mut output = cipher
        .encrypt(
            Nonce::from_slice(&iv.as_bytes()),
            plaintext.as_bytes().as_ref(),
        )
        .map_err(|error| NodeError::new("ERR_CRYPTO_CIPHER_FAILED", error.to_string()))?;
    let tag = output.split_off(output.len().saturating_sub(16));
    Ok(AesGcmCiphertext {
        ciphertext: Buffer::from_bytes(output),
        auth_tag: Buffer::from_bytes(tag),
    })
}

pub fn aes_256_gcm_decrypt(
    key: &Buffer,
    iv: &Buffer,
    ciphertext: &Buffer,
    auth_tag: &Buffer,
) -> NodeResult<Buffer> {
    if key.len() != 32 {
        return Err(NodeError::new(
            "ERR_CRYPTO_INVALID_KEYLEN",
            "AES-256-GCM key must be 32 bytes",
        ));
    }
    if iv.len() != 12 {
        return Err(NodeError::new(
            "ERR_CRYPTO_INVALID_IV",
            "AES-256-GCM iv must be 12 bytes",
        ));
    }
    if auth_tag.len() != 16 {
        return Err(NodeError::new(
            "ERR_CRYPTO_INVALID_AUTH_TAG",
            "AES-256-GCM auth tag must be 16 bytes",
        ));
    }
    let cipher = Aes256Gcm::new_from_slice(&key.as_bytes())
        .map_err(|error| NodeError::new("ERR_CRYPTO_INVALID_KEY", error.to_string()))?;
    let mut sealed = ciphertext.as_bytes();
    sealed.extend_from_slice(&auth_tag.as_bytes());
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&iv.as_bytes()), sealed.as_ref())
        .map_err(|error| NodeError::new("ERR_CRYPTO_AUTH_FAILED", error.to_string()))?;
    Ok(Buffer::from_bytes(plaintext))
}

#[derive(Debug, Clone)]
pub struct RsaKeyPair {
    private_key: RsaPrivateKey,
    public_key: RsaPublicKey,
}

impl RsaKeyPair {
    pub fn public_key(&self) -> RsaPublicKey {
        self.public_key.clone()
    }
}

pub fn generate_rsa_key_pair(bits: usize) -> NodeResult<RsaKeyPair> {
    let private_key = RsaPrivateKey::new(&mut OsRng, bits)
        .map_err(|error| NodeError::new("ERR_CRYPTO_KEYGEN_FAILED", error.to_string()))?;
    let public_key = RsaPublicKey::from(&private_key);
    Ok(RsaKeyPair {
        private_key,
        public_key,
    })
}

pub fn sign_sha256(key_pair: &RsaKeyPair, data: &[u8]) -> Buffer {
    let signing_key = SigningKey::<Sha256>::new(key_pair.private_key.clone());
    Buffer::from_bytes(signing_key.sign(data).to_vec())
}

pub fn sign(algorithm: &str, key_pair: &RsaKeyPair, data: &[u8]) -> NodeResult<Buffer> {
    match parse_algorithm(algorithm)? {
        DigestAlgorithm::Sha256 => Ok(sign_sha256(key_pair, data)),
        _ => Err(NodeError::new(
            "ERR_CRYPTO_UNSUPPORTED_ALGORITHM",
            "sign currently supports RSA-SHA256",
        )),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SigningOptions {
    pub padding: Option<i32>,
    pub salt_length: Option<i32>,
    pub dsa_encoding: Option<String>,
    pub context: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignKeyObjectInput {
    pub key: KeyObject,
    pub padding: Option<i32>,
    pub salt_length: Option<i32>,
    pub dsa_encoding: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Sign {
    algorithm: String,
    bytes: Vec<u8>,
}

impl Sign {
    pub fn create(algorithm: &str) -> Self {
        Self {
            algorithm: algorithm.to_string(),
            bytes: Vec::new(),
        }
    }

    pub fn update_bytes(&mut self, bytes: &[u8]) -> &mut Self {
        self.bytes.extend_from_slice(bytes);
        self
    }

    pub fn update_string(&mut self, value: &str, encoding: Option<&str>) -> NodeResult<&mut Self> {
        self.bytes
            .extend_from_slice(&crate::buffer::encode_string(value, encoding)?);
        Ok(self)
    }

    pub fn sign(&self, key_pair: &RsaKeyPair) -> NodeResult<Buffer> {
        sign(&self.algorithm, key_pair, &self.bytes)
    }

    pub fn sign_with_options(
        &self,
        key_pair: &RsaKeyPair,
        _options: SigningOptions,
    ) -> NodeResult<Buffer> {
        self.sign(key_pair)
    }
}

pub fn create_sign(algorithm: &str) -> Sign {
    Sign::create(algorithm)
}

pub fn verify_sha256(
    public_key: &RsaPublicKey,
    data: &[u8],
    signature: &Buffer,
) -> NodeResult<bool> {
    let verifying_key = VerifyingKey::<Sha256>::new(public_key.clone());
    let signature = RsaSignature::try_from(signature.as_bytes().as_slice())
        .map_err(|error| NodeError::new("ERR_CRYPTO_INVALID_SIGNATURE", error.to_string()))?;
    Ok(verifying_key.verify(data, &signature).is_ok())
}

pub fn verify(
    algorithm: &str,
    public_key: &RsaPublicKey,
    data: &[u8],
    signature: &Buffer,
) -> NodeResult<bool> {
    match parse_algorithm(algorithm)? {
        DigestAlgorithm::Sha256 => verify_sha256(public_key, data, signature),
        _ => Err(NodeError::new(
            "ERR_CRYPTO_UNSUPPORTED_ALGORITHM",
            "verify currently supports RSA-SHA256",
        )),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyKeyObjectInput {
    pub key: Option<KeyObject>,
    pub padding: Option<i32>,
    pub salt_length: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct Verify {
    algorithm: String,
    bytes: Vec<u8>,
}

impl Verify {
    pub fn create(algorithm: &str) -> Self {
        Self {
            algorithm: algorithm.to_string(),
            bytes: Vec::new(),
        }
    }

    pub fn update_bytes(&mut self, bytes: &[u8]) -> &mut Self {
        self.bytes.extend_from_slice(bytes);
        self
    }

    pub fn update_string(&mut self, value: &str, encoding: Option<&str>) -> NodeResult<&mut Self> {
        self.bytes
            .extend_from_slice(&crate::buffer::encode_string(value, encoding)?);
        Ok(self)
    }

    pub fn verify(&self, public_key: &RsaPublicKey, signature: &Buffer) -> NodeResult<bool> {
        verify(&self.algorithm, public_key, &self.bytes, signature)
    }

    pub fn verify_with_options(
        &self,
        public_key: &RsaPublicKey,
        signature: &Buffer,
        _options: VerifyKeyObjectInput,
    ) -> NodeResult<bool> {
        self.verify(public_key, signature)
    }
}

pub fn create_verify(algorithm: &str) -> Verify {
    Verify::create(algorithm)
}
