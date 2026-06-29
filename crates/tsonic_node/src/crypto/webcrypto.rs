#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Algorithm {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyAlgorithm {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AesKeyAlgorithm {
    pub name: String,
    pub length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AesKeyGenParams {
    pub name: String,
    pub length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AesDerivedKeyParams {
    pub name: String,
    pub length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaKeyAlgorithm {
    pub name: String,
    pub modulus_length: usize,
    pub public_exponent: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaKeyGenParams {
    pub name: String,
    pub modulus_length: usize,
    pub public_exponent: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaHashedKeyGenParams {
    pub name: String,
    pub modulus_length: usize,
    pub public_exponent: Vec<u8>,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaHashedKeyAlgorithm {
    pub rsa: RsaKeyAlgorithm,
    pub hash: KeyAlgorithm,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaHashedImportParams {
    pub name: String,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HmacKeyAlgorithm {
    pub name: String,
    pub hash: KeyAlgorithm,
    pub length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HmacKeyGenParams {
    pub name: String,
    pub hash: String,
    pub length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HmacImportParams {
    pub name: String,
    pub hash: String,
    pub length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EcKeyGenParams {
    pub name: String,
    pub named_curve: String,
}

pub type EcKeyAlgorithm = EcKeyGenParams;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EcKeyImportParams {
    pub name: String,
    pub named_curve: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CryptoKey {
    pub key_type: String,
    pub extractable: bool,
    pub algorithm: KeyAlgorithm,
    pub usages: Vec<String>,
    data: Buffer,
}

impl CryptoKey {
    pub fn secret(name: &str, data: Buffer, usages: &[&str]) -> Self {
        Self {
            key_type: "secret".to_string(),
            extractable: true,
            algorithm: KeyAlgorithm {
                name: name.to_string(),
            },
            usages: usages.iter().map(|value| value.to_string()).collect(),
            data,
        }
    }

    pub fn data(&self) -> Buffer {
        self.data.clone()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CryptoKeyPair {
    pub public_key: CryptoKey,
    pub private_key: CryptoKey,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyPairExportResult {
    pub public_key: KeyObject,
    pub private_key: KeyObject,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AeadParams {
    pub name: String,
    pub iv: Buffer,
    pub additional_data: Option<Buffer>,
    pub tag_length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AesCbcParams {
    pub name: String,
    pub iv: Buffer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CipherGcmOptions {
    pub auth_tag_length: usize,
}

pub type CipherCCMOptions = CipherGcmOptions;
pub type CipherGCMOptions = CipherGcmOptions;
pub type CipherOCBOptions = CipherGcmOptions;
pub type CipherChaCha20Poly1305Options = CipherGcmOptions;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AesCtrParams {
    pub name: String,
    pub counter: Buffer,
    pub length: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaPssParams {
    pub name: String,
    pub salt_length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaOaepParams {
    pub name: String,
    pub label: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EcdsaParams {
    pub name: String,
    pub hash: KeyAlgorithm,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EcdhKeyDeriveParams {
    pub name: String,
    pub public: CryptoKey,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextParams {
    pub context: Buffer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncapsulatedKey {
    pub shared_key: Buffer,
    pub ciphertext: Buffer,
}

pub type EncapsulatedBits = EncapsulatedKey;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CShakeParams {
    pub name: String,
    pub output_length: usize,
    pub function_name: Option<Buffer>,
    pub customization: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurboShakeParams {
    pub name: String,
    pub output_length: usize,
    pub domain_separation: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KangarooTwelveParams {
    pub name: String,
    pub output_length: usize,
    pub customization: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KmacParams {
    pub name: String,
    pub output_length: usize,
    pub customization: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KmacKeyAlgorithm {
    pub name: String,
    pub length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KmacKeyGenParams {
    pub name: String,
    pub length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KmacImportParams {
    pub name: String,
    pub length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Argon2Parameters {
    pub message: Buffer,
    pub nonce: Buffer,
    pub parallelism: usize,
    pub memory: usize,
    pub passes: usize,
    pub tag_length: usize,
    pub secret: Option<Buffer>,
    pub associated_data: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Argon2Params {
    pub name: String,
    pub nonce: Buffer,
    pub parallelism: usize,
    pub memory: usize,
    pub passes: usize,
    pub version: Option<u32>,
    pub secret_value: Option<Buffer>,
    pub associated_data: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GeneratePrimeOptions {
    pub add: Option<Buffer>,
    pub rem: Option<Buffer>,
    pub safe: Option<bool>,
    pub bigint: Option<bool>,
}

pub type GeneratePrimeOptionsArrayBuffer = GeneratePrimeOptions;
pub type GeneratePrimeOptionsBigInt = GeneratePrimeOptions;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CheckPrimeOptions {
    pub checks: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaKeyPairOptions {
    pub modulus_length: usize,
    pub public_exponent: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RsaPssKeyPairOptions {
    pub modulus_length: usize,
    pub public_exponent: Option<u64>,
    pub hash_algorithm: Option<String>,
    pub mgf1_hash_algorithm: Option<String>,
    pub salt_length: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DsaKeyPairOptions {
    pub modulus_length: usize,
    pub divisor_length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DhKeyPairOptions {
    pub prime: Option<Buffer>,
    pub prime_length: Option<usize>,
    pub generator: Option<u32>,
    pub group_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EcKeyPairOptions {
    pub named_curve: String,
    pub param_encoding: Option<String>,
}

pub mod webcrypto {
    use super::{
        digest_bytes, parse_algorithm, random_bytes, CryptoKey, JsonWebKey, KeyExportResult,
    };
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

        pub fn import_secret_key(
            &self,
            algorithm: &str,
            data: &Buffer,
            usages: &[&str],
        ) -> CryptoKey {
            CryptoKey::secret(algorithm, data.clone(), usages)
        }

        pub fn export_key(&self, format: &str, key: &CryptoKey) -> NodeResult<KeyExportResult> {
            match format {
                "raw" => Ok(KeyExportResult::Buffer(key.data())),
                "jwk" => {
                    let jwk = JsonWebKey {
                        kty: Some("oct".to_string()),
                        crv: None,
                        x: None,
                        y: None,
                        d: None,
                        n: None,
                        e: None,
                        k: Some(key.data().to_string(Some("base64url"))?),
                        p: None,
                        q: None,
                        dp: None,
                        dq: None,
                        qi: None,
                        oth: Vec::new(),
                        alg: Some(key.algorithm.name.clone()),
                        key_use: None,
                        key_ops: key.usages.clone(),
                        ext: key.extractable,
                    };
                    Ok(KeyExportResult::String(format!(
                        "{{\"kty\":\"{}\",\"k\":\"{}\"}}",
                        jwk.kty.unwrap_or_default(),
                        jwk.k.unwrap_or_default()
                    )))
                }
                _ => Err(crate::error::NodeError::new(
                    "ERR_CRYPTO_UNSUPPORTED_KEY_FORMAT",
                    "unsupported WebCrypto exportKey format",
                )),
            }
        }
    }
}

