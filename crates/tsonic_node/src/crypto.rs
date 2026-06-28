use crate::buffer::{decode_bytes, Buffer};
use crate::error::{NodeError, NodeResult};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::rngs::OsRng;
use rsa::pkcs1v15::{Signature as RsaSignature, SigningKey, VerifyingKey};
use rsa::signature::{SignatureEncoding, Signer, Verifier};
use rsa::{RsaPrivateKey, RsaPublicKey};
use sha2::{Digest, Sha256, Sha384, Sha512};

pub fn random_bytes(size: usize) -> NodeResult<Buffer> {
    let mut bytes = vec![0_u8; size];
    #[cfg(unix)]
    {
        use std::io::Read;
        let mut file = std::fs::File::open("/dev/urandom")
            .map_err(|error| NodeError::new("ERR_CRYPTO_RANDOM_FAILED", error.to_string()))?;
        file.read_exact(&mut bytes)
            .map_err(|error| NodeError::new("ERR_CRYPTO_RANDOM_FAILED", error.to_string()))?;
        Ok(Buffer::from_bytes(bytes))
    }
    #[cfg(not(unix))]
    {
        let mut state = seed();
        for byte in &mut bytes {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *byte = state as u8;
        }
        Ok(Buffer::from_bytes(bytes))
    }
}

pub fn random_fill(buffer: &mut Buffer, offset: usize, size: usize) -> NodeResult<()> {
    if offset > buffer.len() || offset.saturating_add(size) > buffer.len() {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "randomFill range is outside buffer",
        ));
    }
    let bytes = random_bytes(size)?;
    for index in 0..size {
        buffer.set(offset + index, bytes.get(index).unwrap())?;
    }
    Ok(())
}

pub fn random_int(max: u64) -> NodeResult<u64> {
    random_int_range(0, max)
}

pub fn random_int_range(min: u64, max: u64) -> NodeResult<u64> {
    if min >= max {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "randomInt requires min < max",
        ));
    }
    let range = max - min;
    let bytes = random_bytes(8)?.as_bytes();
    let value = u64::from_le_bytes(bytes.try_into().unwrap());
    Ok(min + value % range)
}

pub fn timing_safe_equal(left: &Buffer, right: &Buffer) -> NodeResult<bool> {
    if left.len() != right.len() {
        return Err(NodeError::new(
            "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH",
            "inputs must have equal byte length",
        ));
    }
    let mut diff = 0_u8;
    for (left, right) in left.as_bytes().iter().zip(right.as_bytes().iter()) {
        diff |= left ^ right;
    }
    Ok(diff == 0)
}

pub fn get_hashes() -> Vec<&'static str> {
    vec!["sha1", "sha256", "sha384", "sha512"]
}

pub fn create_hash(algorithm: &str) -> NodeResult<Hash> {
    Hash::create(algorithm)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DigestResult {
    Buffer(Buffer),
    String(String),
}

#[derive(Debug, Clone)]
pub struct Hash {
    algorithm: Algorithm,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Algorithm {
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

#[derive(Debug, Clone)]
pub struct Hmac {
    algorithm: Algorithm,
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
    algorithm: Algorithm,
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
pub struct KeyObject {
    key_type: String,
    bytes: Buffer,
}

impl KeyObject {
    pub fn key_type(&self) -> &str {
        &self.key_type
    }

    pub fn export(&self) -> Buffer {
        self.bytes.clone()
    }
}

pub fn create_secret_key(key: &Buffer) -> KeyObject {
    KeyObject {
        key_type: "secret".to_string(),
        bytes: key.clone(),
    }
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

pub mod webcrypto {
    use super::{digest_bytes, parse_algorithm, random_bytes};
    use crate::buffer::Buffer;
    use crate::error::NodeResult;

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct Crypto;

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct SubtleCrypto;

    pub fn crypto() -> Crypto {
        Crypto
    }

    impl Crypto {
        pub fn subtle(&self) -> SubtleCrypto {
            SubtleCrypto
        }

        pub fn get_random_values(&self, buffer: &mut Buffer) -> NodeResult<()> {
            let bytes = random_bytes(buffer.len())?;
            for (index, byte) in bytes.as_bytes().into_iter().enumerate() {
                buffer.set(index, byte)?;
            }
            Ok(())
        }

        pub fn random_uuid(&self) -> NodeResult<String> {
            super::random_uuid()
        }
    }

    impl SubtleCrypto {
        pub fn digest(&self, algorithm: &str, data: &[u8]) -> NodeResult<Buffer> {
            let algorithm = parse_algorithm(algorithm)?;
            Ok(Buffer::from_bytes(digest_bytes(algorithm, data)))
        }
    }
}

fn parse_algorithm(algorithm: &str) -> NodeResult<Algorithm> {
    match algorithm.to_ascii_lowercase().as_str() {
        "sha256" | "sha-256" => Ok(Algorithm::Sha256),
        "sha1" | "sha-1" => Ok(Algorithm::Sha1),
        "sha384" | "sha-384" => Ok(Algorithm::Sha384),
        "sha512" | "sha-512" => Ok(Algorithm::Sha512),
        other => Err(NodeError::new(
            "ERR_CRYPTO_UNSUPPORTED_ALGORITHM",
            format!("unsupported hash algorithm `{other}`"),
        )),
    }
}

fn digest_bytes(algorithm: Algorithm, input: &[u8]) -> Vec<u8> {
    match algorithm {
        Algorithm::Sha1 => sha1(input).to_vec(),
        Algorithm::Sha256 => sha256(input).to_vec(),
        Algorithm::Sha384 => Sha384::digest(input).to_vec(),
        Algorithm::Sha512 => Sha512::digest(input).to_vec(),
    }
}

fn hmac_digest_buffer(algorithm: Algorithm, key: &[u8], data: &[u8]) -> Vec<u8> {
    match hmac_digest_algorithm(algorithm, key, data, None).expect("valid HMAC digest") {
        DigestResult::Buffer(buffer) => buffer.as_bytes().to_vec(),
        DigestResult::String(_) => unreachable!("buffer digest requested"),
    }
}

fn digest_len(algorithm: Algorithm) -> usize {
    match algorithm {
        Algorithm::Sha1 => 20,
        Algorithm::Sha256 => 32,
        Algorithm::Sha384 => 48,
        Algorithm::Sha512 => 64,
    }
}

fn hmac_block_size(algorithm: Algorithm) -> usize {
    match algorithm {
        Algorithm::Sha1 | Algorithm::Sha256 => 64,
        Algorithm::Sha384 | Algorithm::Sha512 => 128,
    }
}

fn sha1(input: &[u8]) -> [u8; 20] {
    let mut data = input.to_vec();
    let bit_len = (data.len() as u64) * 8;
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());

    let mut h0 = 0x6745_2301_u32;
    let mut h1 = 0xefcd_ab89_u32;
    let mut h2 = 0x98ba_dcfe_u32;
    let mut h3 = 0x1032_5476_u32;
    let mut h4 = 0xc3d2_e1f0_u32;

    for chunk in data.chunks(64) {
        let mut w = [0_u32; 80];
        for (index, word) in w.iter_mut().take(16).enumerate() {
            let base = index * 4;
            *word = u32::from_be_bytes([
                chunk[base],
                chunk[base + 1],
                chunk[base + 2],
                chunk[base + 3],
            ]);
        }
        for index in 16..80 {
            w[index] = (w[index - 3] ^ w[index - 8] ^ w[index - 14] ^ w[index - 16]).rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;
        for (index, word) in w.iter().enumerate() {
            let (f, k) = match index {
                0..=19 => ((b & c) | ((!b) & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0_u8; 20];
    for (index, word) in [h0, h1, h2, h3, h4].iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn sha256(input: &[u8]) -> [u8; 32] {
    const H0: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut data = input.to_vec();
    let bit_len = (data.len() as u64) * 8;
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());

    let mut h = H0;
    for chunk in data.chunks(64) {
        let mut w = [0_u32; 64];
        for (index, word) in w.iter_mut().take(16).enumerate() {
            let base = index * 4;
            *word = u32::from_be_bytes([
                chunk[base],
                chunk[base + 1],
                chunk[base + 2],
                chunk[base + 3],
            ]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0_u8; 32];
    for (index, word) in h.iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

#[cfg(not(unix))]
fn seed() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0x5eed)
}
