use crate::buffer::{decode_bytes, Buffer};
use crate::error::{NodeError, NodeResult};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::rngs::OsRng;
use rsa::pkcs1v15::{Signature as RsaSignature, SigningKey, VerifyingKey};
use rsa::signature::{SignatureEncoding, Signer, Verifier};
use rsa::{RsaPrivateKey, RsaPublicKey};
use sha2::{Digest, Sha256, Sha384, Sha512};
use tsonic_js::date::JsDate;

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

pub fn get_ciphers() -> Vec<&'static str> {
    vec!["aes-256-gcm"]
}

pub fn get_curves() -> Vec<&'static str> {
    vec!["rsa"]
}

pub fn get_fips() -> u8 {
    0
}

pub fn set_fips(value: u8) -> NodeResult<()> {
    if value == 0 {
        Ok(())
    } else {
        Err(NodeError::new(
            "ERR_CRYPTO_FIPS_UNAVAILABLE",
            "FIPS mode is not available in this closed Rust runtime",
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SecureHeapUsage {
    pub total: usize,
    pub used: usize,
    pub utilization: usize,
    pub min: usize,
}

pub fn secure_heap_used() -> SecureHeapUsage {
    SecureHeapUsage::default()
}

pub const DH_CHECK_P_NOT_SAFE_PRIME: i32 = 2;
pub const DH_CHECK_P_NOT_PRIME: i32 = 1;
pub const DH_UNABLE_TO_CHECK_GENERATOR: i32 = 4;
pub const DH_NOT_SUITABLE_GENERATOR: i32 = 8;
pub const ENGINE_METHOD_NONE: i32 = 0;
pub const ENGINE_METHOD_RSA: i32 = 1;
pub const ENGINE_METHOD_DSA: i32 = 2;
pub const ENGINE_METHOD_DH: i32 = 4;
pub const ENGINE_METHOD_RAND: i32 = 8;
pub const ENGINE_METHOD_EC: i32 = 2048;
pub const ENGINE_METHOD_CIPHERS: i32 = 64;
pub const ENGINE_METHOD_DIGESTS: i32 = 128;
pub const ENGINE_METHOD_PKEY_METHS: i32 = 512;
pub const ENGINE_METHOD_PKEY_ASN1_METHS: i32 = 1024;
pub const ENGINE_METHOD_ALL: i32 = 0xffff;
pub const RSA_PKCS1_PADDING: i32 = 1;
pub const RSA_SSLV23_PADDING: i32 = 2;
pub const RSA_SSL_V23_PADDING: i32 = 2;
pub const RSA_NO_PADDING: i32 = 3;
pub const RSA_PKCS1_OAEP_PADDING: i32 = 4;
pub const RSA_X931_PADDING: i32 = 5;
pub const RSA_PKCS1_PSS_PADDING: i32 = 6;
pub const RSA_PSS_SALTLEN_DIGEST: i32 = -1;
pub const RSA_PSS_SALTLEN_MAX_SIGN: i32 = -2;
pub const RSA_PSS_SALTLEN_AUTO: i32 = -2;
pub const POINT_CONVERSION_COMPRESSED: i32 = 2;
pub const POINT_CONVERSION_UNCOMPRESSED: i32 = 4;
pub const POINT_CONVERSION_HYBRID: i32 = 6;
pub const DEFAULT_CORE_CIPHER_LIST: &str = "TLS_AES_256_GCM_SHA384";
pub const DEFAULT_CIPHER_LIST: &str = "TLS_AES_256_GCM_SHA384";
pub const OPENSSL_VERSION_NUMBER: u64 = 0;
pub const SSL_OP_ALL: i64 = 2_147_485_776;
pub const SSL_OP_ALLOW_NO_DHE_KEX: i64 = 1_024;
pub const SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: i64 = 262_144;
pub const SSL_OP_CIPHER_SERVER_PREFERENCE: i64 = 4_194_304;
pub const SSL_OP_CISCO_ANYCONNECT: i64 = 32_768;
pub const SSL_OP_COOKIE_EXCHANGE: i64 = 8_192;
pub const SSL_OP_CRYPTOPRO_TLSEXT_BUG: i64 = 2_147_483_648;
pub const SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: i64 = 2_048;
pub const SSL_OP_LEGACY_SERVER_CONNECT: i64 = 4;
pub const SSL_OP_NO_COMPRESSION: i64 = 131_072;
pub const SSL_OP_NO_ENCRYPT_THEN_MAC: i64 = 524_288;
pub const SSL_OP_NO_QUERY_MTU: i64 = 4_096;
pub const SSL_OP_NO_RENEGOTIATION: i64 = 1_073_741_824;
pub const SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: i64 = 65_536;
pub const SSL_OP_NO_SSLV2: i64 = 0;
pub const SSL_OP_NO_SSLV3: i64 = 33_554_432;
pub const SSL_OP_NO_TICKET: i64 = 16_384;
pub const SSL_OP_NO_TLSV1: i64 = 67_108_864;
pub const SSL_OP_NO_TLSV1_1: i64 = 268_435_456;
pub const SSL_OP_NO_TLSV1_2: i64 = 134_217_728;
pub const SSL_OP_NO_TLSV1_3: i64 = 536_870_912;
pub const SSL_OP_PRIORITIZE_CHACHA: i64 = 2_097_152;
pub const SSL_OP_TLS_ROLLBACK_BUG: i64 = 8_388_608;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CryptoConstants {
    pub dh_check_p_not_safe_prime: i32,
    pub dh_check_p_not_prime: i32,
    pub dh_unable_to_check_generator: i32,
    pub dh_not_suitable_generator: i32,
    pub engine_method_none: i32,
    pub engine_method_rsa: i32,
    pub engine_method_dsa: i32,
    pub engine_method_dh: i32,
    pub engine_method_rand: i32,
    pub engine_method_ec: i32,
    pub engine_method_ciphers: i32,
    pub engine_method_digests: i32,
    pub engine_method_pkey_meths: i32,
    pub engine_method_pkey_asn1_meths: i32,
    pub engine_method_all: i32,
    pub rsa_pkcs1_padding: i32,
    pub rsa_sslv23_padding: i32,
    pub rsa_ssl_v23_padding: i32,
    pub rsa_no_padding: i32,
    pub rsa_pkcs1_oaep_padding: i32,
    pub rsa_x931_padding: i32,
    pub rsa_pkcs1_pss_padding: i32,
    pub rsa_pss_saltlen_digest: i32,
    pub rsa_pss_saltlen_max_sign: i32,
    pub rsa_pss_saltlen_auto: i32,
    pub point_conversion_compressed: i32,
    pub point_conversion_uncompressed: i32,
    pub point_conversion_hybrid: i32,
    pub default_core_cipher_list: String,
    pub default_cipher_list: String,
    pub openssl_version_number: u64,
    pub ssl_op_all: i64,
    pub ssl_op_allow_no_dhe_kex: i64,
    pub ssl_op_allow_unsafe_legacy_renegotiation: i64,
    pub ssl_op_cipher_server_preference: i64,
    pub ssl_op_cisco_anyconnect: i64,
    pub ssl_op_cookie_exchange: i64,
    pub ssl_op_cryptopro_tlsext_bug: i64,
    pub ssl_op_dont_insert_empty_fragments: i64,
    pub ssl_op_legacy_server_connect: i64,
    pub ssl_op_no_compression: i64,
    pub ssl_op_no_encrypt_then_mac: i64,
    pub ssl_op_no_query_mtu: i64,
    pub ssl_op_no_renegotiation: i64,
    pub ssl_op_no_session_resumption_on_renegotiation: i64,
    pub ssl_op_no_sslv2: i64,
    pub ssl_op_no_sslv3: i64,
    pub ssl_op_no_ticket: i64,
    pub ssl_op_no_tlsv1: i64,
    pub ssl_op_no_tlsv1_1: i64,
    pub ssl_op_no_tlsv1_2: i64,
    pub ssl_op_no_tlsv1_3: i64,
    pub ssl_op_prioritize_chacha: i64,
    pub ssl_op_tls_rollback_bug: i64,
}

pub fn constants() -> CryptoConstants {
    CryptoConstants {
        dh_check_p_not_safe_prime: DH_CHECK_P_NOT_SAFE_PRIME,
        dh_check_p_not_prime: DH_CHECK_P_NOT_PRIME,
        dh_unable_to_check_generator: DH_UNABLE_TO_CHECK_GENERATOR,
        dh_not_suitable_generator: DH_NOT_SUITABLE_GENERATOR,
        engine_method_none: ENGINE_METHOD_NONE,
        engine_method_rsa: ENGINE_METHOD_RSA,
        engine_method_dsa: ENGINE_METHOD_DSA,
        engine_method_dh: ENGINE_METHOD_DH,
        engine_method_rand: ENGINE_METHOD_RAND,
        engine_method_ec: ENGINE_METHOD_EC,
        engine_method_ciphers: ENGINE_METHOD_CIPHERS,
        engine_method_digests: ENGINE_METHOD_DIGESTS,
        engine_method_pkey_meths: ENGINE_METHOD_PKEY_METHS,
        engine_method_pkey_asn1_meths: ENGINE_METHOD_PKEY_ASN1_METHS,
        engine_method_all: ENGINE_METHOD_ALL,
        rsa_pkcs1_padding: RSA_PKCS1_PADDING,
        rsa_sslv23_padding: RSA_SSLV23_PADDING,
        rsa_ssl_v23_padding: RSA_SSL_V23_PADDING,
        rsa_no_padding: RSA_NO_PADDING,
        rsa_pkcs1_oaep_padding: RSA_PKCS1_OAEP_PADDING,
        rsa_x931_padding: RSA_X931_PADDING,
        rsa_pkcs1_pss_padding: RSA_PKCS1_PSS_PADDING,
        rsa_pss_saltlen_digest: RSA_PSS_SALTLEN_DIGEST,
        rsa_pss_saltlen_max_sign: RSA_PSS_SALTLEN_MAX_SIGN,
        rsa_pss_saltlen_auto: RSA_PSS_SALTLEN_AUTO,
        point_conversion_compressed: POINT_CONVERSION_COMPRESSED,
        point_conversion_uncompressed: POINT_CONVERSION_UNCOMPRESSED,
        point_conversion_hybrid: POINT_CONVERSION_HYBRID,
        default_core_cipher_list: DEFAULT_CORE_CIPHER_LIST.to_string(),
        default_cipher_list: DEFAULT_CIPHER_LIST.to_string(),
        openssl_version_number: OPENSSL_VERSION_NUMBER,
        ssl_op_all: SSL_OP_ALL,
        ssl_op_allow_no_dhe_kex: SSL_OP_ALLOW_NO_DHE_KEX,
        ssl_op_allow_unsafe_legacy_renegotiation: SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
        ssl_op_cipher_server_preference: SSL_OP_CIPHER_SERVER_PREFERENCE,
        ssl_op_cisco_anyconnect: SSL_OP_CISCO_ANYCONNECT,
        ssl_op_cookie_exchange: SSL_OP_COOKIE_EXCHANGE,
        ssl_op_cryptopro_tlsext_bug: SSL_OP_CRYPTOPRO_TLSEXT_BUG,
        ssl_op_dont_insert_empty_fragments: SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS,
        ssl_op_legacy_server_connect: SSL_OP_LEGACY_SERVER_CONNECT,
        ssl_op_no_compression: SSL_OP_NO_COMPRESSION,
        ssl_op_no_encrypt_then_mac: SSL_OP_NO_ENCRYPT_THEN_MAC,
        ssl_op_no_query_mtu: SSL_OP_NO_QUERY_MTU,
        ssl_op_no_renegotiation: SSL_OP_NO_RENEGOTIATION,
        ssl_op_no_session_resumption_on_renegotiation:
            SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION,
        ssl_op_no_sslv2: SSL_OP_NO_SSLV2,
        ssl_op_no_sslv3: SSL_OP_NO_SSLV3,
        ssl_op_no_ticket: SSL_OP_NO_TICKET,
        ssl_op_no_tlsv1: SSL_OP_NO_TLSV1,
        ssl_op_no_tlsv1_1: SSL_OP_NO_TLSV1_1,
        ssl_op_no_tlsv1_2: SSL_OP_NO_TLSV1_2,
        ssl_op_no_tlsv1_3: SSL_OP_NO_TLSV1_3,
        ssl_op_prioritize_chacha: SSL_OP_PRIORITIZE_CHACHA,
        ssl_op_tls_rollback_bug: SSL_OP_TLS_ROLLBACK_BUG,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RandomUUIDOptions {
    pub disable_entropy_cache: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HashOptions {
    pub output_length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OneShotDigestOptions {
    pub output_length: Option<usize>,
    pub output_encoding: Option<String>,
}

pub type OneShotDigestOptionsWithBufferEncoding = OneShotDigestOptions;
pub type OneShotDigestOptionsWithStringEncoding = OneShotDigestOptions;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CipherInfoOptions {
    pub key_length: Option<usize>,
    pub iv_length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CipherInfo {
    pub name: String,
    pub nid: i32,
    pub block_size: usize,
    pub iv_length: usize,
    pub key_length: usize,
    pub mode: String,
}

pub fn get_cipher_info(name: &str, options: Option<CipherInfoOptions>) -> Option<CipherInfo> {
    if name.eq_ignore_ascii_case("aes-256-gcm") {
        let options = options.unwrap_or(CipherInfoOptions {
            key_length: Some(32),
            iv_length: Some(12),
        });
        Some(CipherInfo {
            name: "aes-256-gcm".to_string(),
            nid: 0,
            block_size: 1,
            iv_length: options.iv_length.unwrap_or(12),
            key_length: options.key_length.unwrap_or(32),
            mode: "gcm".to_string(),
        })
    } else {
        None
    }
}

