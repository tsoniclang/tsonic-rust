pub fn pbkdf2_sync(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    key_len: usize,
    digest: &str,
) -> NodeResult<Buffer> {
    if iterations == 0 {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "PBKDF2 iterations must be greater than zero",
        ));
    }
    let algorithm = parse_algorithm(digest)?;
    let digest_len = digest_len(algorithm);
    let mut output = Vec::with_capacity(key_len);
    let mut block_index = 1_u32;
    while output.len() < key_len {
        let mut block_salt = Vec::with_capacity(salt.len() + 4);
        block_salt.extend_from_slice(salt);
        block_salt.extend_from_slice(&block_index.to_be_bytes());
        let mut u = hmac_digest_buffer(algorithm, password, &block_salt);
        let mut t = u.clone();
        for _ in 1..iterations {
            u = hmac_digest_buffer(algorithm, password, &u);
            for (left, right) in t.iter_mut().zip(&u) {
                *left ^= *right;
            }
        }
        output.extend_from_slice(&t[..digest_len]);
        block_index = block_index
            .checked_add(1)
            .ok_or_else(|| NodeError::new("ERR_OUT_OF_RANGE", "PBKDF2 key length too large"))?;
    }
    output.truncate(key_len);
    Ok(Buffer::from_bytes(output))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pbkdf2Params {
    pub password: Buffer,
    pub salt: Buffer,
    pub iterations: u32,
    pub key_len: usize,
    pub hash: String,
}

pub fn pbkdf2_sync_params(params: &Pbkdf2Params) -> NodeResult<Buffer> {
    pbkdf2_sync(
        &params.password.as_bytes(),
        &params.salt.as_bytes(),
        params.iterations,
        params.key_len,
        &params.hash,
    )
}

pub fn pbkdf2_callback(params: &Pbkdf2Params, callback: impl FnOnce(NodeResult<Buffer>)) {
    callback(pbkdf2_sync_params(params));
}

pub fn hkdf_sync(
    digest: &str,
    input_keying_material: &[u8],
    salt: &[u8],
    info: &[u8],
    key_len: usize,
) -> NodeResult<Buffer> {
    let algorithm = parse_algorithm(digest)?;
    let digest_len = digest_len(algorithm);
    if key_len > 255 * digest_len {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "HKDF key length exceeds 255 digest blocks",
        ));
    }
    let effective_salt = if salt.is_empty() {
        vec![0_u8; digest_len]
    } else {
        salt.to_vec()
    };
    let prk = hmac_digest_buffer(algorithm, &effective_salt, input_keying_material);
    let mut output = Vec::with_capacity(key_len);
    let mut previous = Vec::new();
    let mut counter = 1_u8;
    while output.len() < key_len {
        let mut data = Vec::with_capacity(previous.len() + info.len() + 1);
        data.extend_from_slice(&previous);
        data.extend_from_slice(info);
        data.push(counter);
        previous = hmac_digest_buffer(algorithm, &prk, &data);
        output.extend_from_slice(&previous);
        counter = counter
            .checked_add(1)
            .ok_or_else(|| NodeError::new("ERR_OUT_OF_RANGE", "HKDF block counter overflow"))?;
    }
    output.truncate(key_len);
    Ok(Buffer::from_bytes(output))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HkdfParams {
    pub hash: String,
    pub input_keying_material: Buffer,
    pub salt: Buffer,
    pub info: Buffer,
    pub key_len: usize,
}

pub fn hkdf_sync_params(params: &HkdfParams) -> NodeResult<Buffer> {
    hkdf_sync(
        &params.hash,
        &params.input_keying_material.as_bytes(),
        &params.salt.as_bytes(),
        &params.info.as_bytes(),
        params.key_len,
    )
}

pub fn hkdf_callback(params: &HkdfParams, callback: impl FnOnce(NodeResult<Buffer>)) {
    callback(hkdf_sync_params(params));
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScryptOptions {
    pub cost: u32,
    pub block_size: u32,
    pub parallelization: u32,
    pub maxmem: usize,
}

impl Default for ScryptOptions {
    fn default() -> Self {
        Self {
            cost: 16_384,
            block_size: 8,
            parallelization: 1,
            maxmem: 32 * 1024 * 1024,
        }
    }
}

pub fn scrypt_sync(
    _password: &[u8],
    _salt: &[u8],
    _key_len: usize,
    _options: ScryptOptions,
) -> NodeResult<Buffer> {
    Err(NodeError::new(
        "ERR_CRYPTO_UNSUPPORTED_ALGORITHM",
        "scrypt requires an approved scrypt implementation dependency",
    ))
}
