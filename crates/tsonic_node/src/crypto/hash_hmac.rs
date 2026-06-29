pub fn create_hash(algorithm: &str) -> NodeResult<Hash> {
    Hash::create(algorithm)
}

pub fn create_hash_with_options(algorithm: &str, options: HashOptions) -> NodeResult<Hash> {
    if options.output_length.is_some() {
        return Err(NodeError::new(
            "ERR_CRYPTO_UNSUPPORTED_OPTION",
            "hash outputLength is only valid for unsupported XOF algorithms",
        ));
    }
    create_hash(algorithm)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DigestResult {
    Buffer(Buffer),
    String(String),
}

#[derive(Debug, Clone)]
pub struct Hash {
    algorithm: DigestAlgorithm,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DigestAlgorithm {
    Sha1,
    Sha256,
    Sha384,
    Sha512,
}

impl Hash {
    pub fn create(algorithm: &str) -> NodeResult<Self> {
        let algorithm = parse_algorithm(algorithm)?;
        Ok(Self {
            algorithm,
            bytes: Vec::new(),
        })
    }

    pub fn update_bytes(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    pub fn update(&mut self, bytes: &[u8]) -> &mut Self {
        self.update_bytes(bytes);
        self
    }

    pub fn copy(&self) -> Self {
        self.clone()
    }

    pub fn update_string(&mut self, value: &str, encoding: Option<&str>) -> NodeResult<()> {
        self.bytes
            .extend_from_slice(&crate::buffer::encode_string(value, encoding)?);
        Ok(())
    }

    pub fn digest(self, encoding: Option<&str>) -> NodeResult<DigestResult> {
        let bytes = digest_bytes(self.algorithm, &self.bytes);
        match encoding {
            None => Ok(DigestResult::Buffer(Buffer::from_bytes(bytes))),
            Some(encoding) => Ok(DigestResult::String(decode_bytes(&bytes, Some(encoding))?)),
        }
    }

    pub fn digest_string(self, encoding: &str) -> NodeResult<String> {
        match self.digest(Some(encoding))? {
            DigestResult::String(value) => Ok(value),
            DigestResult::Buffer(_) => Err(NodeError::new(
                "ERR_INVALID_RETURN_VALUE",
                "hash string digest returned a buffer",
            )),
        }
    }

    pub fn digest_buffer(self) -> NodeResult<Buffer> {
        match self.digest(None)? {
            DigestResult::Buffer(value) => Ok(value),
            DigestResult::String(_) => Err(NodeError::new(
                "ERR_INVALID_RETURN_VALUE",
                "hash buffer digest returned a string",
            )),
        }
    }
}

pub fn hash(algorithm: &str, data: &[u8], encoding: Option<&str>) -> NodeResult<DigestResult> {
    let mut hash = create_hash(algorithm)?;
    hash.update_bytes(data);
    hash.digest(encoding)
}

pub fn hash_with_options(
    algorithm: &str,
    data: &[u8],
    options: OneShotDigestOptions,
) -> NodeResult<DigestResult> {
    if options.output_length.is_some() {
        return Err(NodeError::new(
            "ERR_CRYPTO_UNSUPPORTED_OPTION",
            "one-shot digest outputLength is only valid for unsupported XOF algorithms",
        ));
    }
    hash(algorithm, data, options.output_encoding.as_deref())
}

#[derive(Debug, Clone)]
pub struct Hmac {
    algorithm: DigestAlgorithm,
    key: Vec<u8>,
    bytes: Vec<u8>,
}

impl Hmac {
    pub fn create(algorithm: &str, key: &[u8]) -> NodeResult<Self> {
        Ok(Self {
            algorithm: parse_algorithm(algorithm)?,
            key: key.to_vec(),
            bytes: Vec::new(),
        })
    }

    pub fn update_bytes(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    pub fn update(&mut self, bytes: &[u8]) -> &mut Self {
        self.update_bytes(bytes);
        self
    }

    pub fn update_string(&mut self, value: &str, encoding: Option<&str>) -> NodeResult<()> {
        self.bytes
            .extend_from_slice(&crate::buffer::encode_string(value, encoding)?);
        Ok(())
    }

    pub fn digest(self, encoding: Option<&str>) -> NodeResult<DigestResult> {
        hmac_digest_algorithm(self.algorithm, &self.key, &self.bytes, encoding)
    }

    pub fn digest_string(self, encoding: &str) -> NodeResult<String> {
        match self.digest(Some(encoding))? {
            DigestResult::String(value) => Ok(value),
            DigestResult::Buffer(_) => Err(NodeError::new(
                "ERR_INVALID_RETURN_VALUE",
                "hmac string digest returned a buffer",
            )),
        }
    }

    pub fn digest_buffer(self) -> NodeResult<Buffer> {
        match self.digest(None)? {
            DigestResult::Buffer(value) => Ok(value),
            DigestResult::String(_) => Err(NodeError::new(
                "ERR_INVALID_RETURN_VALUE",
                "hmac buffer digest returned a string",
            )),
        }
    }
}

pub fn create_hmac(algorithm: &str, key: &[u8]) -> NodeResult<Hmac> {
    Hmac::create(algorithm, key)
}

pub fn hmac_digest(
    algorithm: &str,
    key: &[u8],
    data: &[u8],
    encoding: Option<&str>,
) -> NodeResult<DigestResult> {
    let algorithm = parse_algorithm(algorithm)?;
    hmac_digest_algorithm(algorithm, key, data, encoding)
}

fn hmac_digest_algorithm(
    algorithm: DigestAlgorithm,
    key: &[u8],
    data: &[u8],
    encoding: Option<&str>,
) -> NodeResult<DigestResult> {
    let block_size = hmac_block_size(algorithm);
    let mut key_block = vec![0_u8; block_size];
    let normalized_key = if key.len() > block_size {
        digest_bytes(algorithm, key)
    } else {
        key.to_vec()
    };
    key_block[..normalized_key.len()].copy_from_slice(&normalized_key);

    let mut outer = vec![0x5c_u8; block_size];
    let mut inner = vec![0x36_u8; block_size];
    for index in 0..block_size {
        outer[index] ^= key_block[index];
        inner[index] ^= key_block[index];
    }
    inner.extend_from_slice(data);
    let inner_hash = digest_bytes(algorithm, &inner);
    outer.extend_from_slice(&inner_hash);
    let bytes = digest_bytes(algorithm, &outer);

    match encoding {
        None => Ok(DigestResult::Buffer(Buffer::from_bytes(bytes))),
        Some(encoding) => Ok(DigestResult::String(decode_bytes(&bytes, Some(encoding))?)),
    }
}

