use tsonic_node::crypto::{DigestResult, Hash};

#[test]
fn crypto_random_bytes_returns_requested_length() {
    assert_eq!(tsonic_node::crypto::random_bytes(8).unwrap().len(), 8);
    let mut buffer = tsonic_node::buffer::Buffer::alloc(4);
    tsonic_node::crypto::random_fill(&mut buffer, 1, 2).unwrap();
    assert!(tsonic_node::crypto::random_int(10).unwrap() < 10);
    let ranged = tsonic_node::crypto::random_int_range(10, 20).unwrap();
    assert!((10..20).contains(&ranged));
}

#[test]
fn crypto_sha256_known_vector() {
    assert_eq!(tsonic_node::crypto::constants().rsa_pkcs1_padding, 1);
    assert_eq!(
        tsonic_node::crypto::constants().point_conversion_uncompressed,
        4
    );
    assert_eq!(
        tsonic_node::crypto::hash("sha256", b"abc", Some("hex")).unwrap(),
        DigestResult::String(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".to_string()
        )
    );
    assert_eq!(
        tsonic_node::crypto::hash_with_options(
            "sha256",
            b"abc",
            tsonic_node::crypto::OneShotDigestOptions {
                output_length: None,
                encoding: Some("hex".to_string()),
            },
        )
        .unwrap(),
        DigestResult::String(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".to_string()
        )
    );
    assert!(tsonic_node::crypto::hash_with_options(
        "sha256",
        b"abc",
        tsonic_node::crypto::OneShotDigestOptions {
            output_length: Some(10),
            encoding: None,
        },
    )
    .is_err());
    let mut hash = tsonic_node::crypto::create_hash("sha256").unwrap();
    hash.update_string("abc", Some("utf8")).unwrap();
    let copied = hash.copy();
    let digest = hash.digest(Some("hex")).unwrap();
    assert_eq!(
        digest,
        DigestResult::String(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".to_string()
        )
    );
    assert_eq!(
        copied.digest_string("hex").unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let mut sha1 = Hash::create("sha1").unwrap();
    sha1.update_string("abc", Some("utf8")).unwrap();
    assert_eq!(
        sha1.digest(Some("hex")).unwrap(),
        DigestResult::String("a9993e364706816aba3e25717850c26c9cd0d89d".to_string())
    );

    let mut sha512 = Hash::create("sha512").unwrap();
    sha512.update_string("abc", Some("utf8")).unwrap();
    assert_eq!(
        sha512.digest_string("hex").unwrap(),
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a\
         2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
            .replace(' ', "")
    );

    let cipher_info = tsonic_node::crypto::get_cipher_info(
        "aes-256-gcm",
        Some(tsonic_node::crypto::CipherInfoOptions {
            key_length: Some(32),
            iv_length: Some(12),
        }),
    )
    .unwrap();
    assert_eq!(cipher_info.mode, "gcm");
    assert_eq!(cipher_info.key_length, 32);
}

#[test]
fn crypto_hmac_and_uuid_helpers_are_closed_runtime_apis() {
    let digest = tsonic_node::crypto::hmac_digest(
        "sha256",
        b"key",
        b"The quick brown fox jumps over the lazy dog",
        Some("hex"),
    )
    .unwrap();
    assert_eq!(
        digest,
        tsonic_node::crypto::DigestResult::String(
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8".to_string()
        )
    );

    let uuid = tsonic_node::crypto::random_uuid().unwrap();
    assert_eq!(uuid.len(), 36);
    assert_eq!(&uuid[14..15], "4");
    assert!(matches!(&uuid[19..20], "8" | "9" | "a" | "b"));
    assert_eq!(
        tsonic_node::crypto::random_uuid_with_options(tsonic_node::crypto::RandomUUIDOptions {
            disable_entropy_cache: true,
        })
        .unwrap()
        .len(),
        36
    );

    assert!(tsonic_node::crypto::get_hashes().contains(&"sha256"));
    assert_eq!(tsonic_node::crypto::get_ciphers(), vec!["aes-256-gcm"]);
    assert!(tsonic_node::crypto::get_curves().contains(&"rsa"));
    assert_eq!(tsonic_node::crypto::get_fips(), 0);
    tsonic_node::crypto::set_fips(0).unwrap();
    assert!(tsonic_node::crypto::set_fips(1).is_err());
    assert_eq!(tsonic_node::crypto::secure_heap_used().used, 0);
    let left = tsonic_node::buffer::Buffer::from_string("abc", Some("utf8")).unwrap();
    let right = tsonic_node::buffer::Buffer::from_string("abc", Some("utf8")).unwrap();
    let different = tsonic_node::buffer::Buffer::from_string("abd", Some("utf8")).unwrap();
    assert!(tsonic_node::crypto::timing_safe_equal(&left, &right).unwrap());
    assert!(!tsonic_node::crypto::timing_safe_equal(&left, &different).unwrap());
}

#[test]
fn crypto_hmac_keyobject_and_webcrypto_shapes_are_closed_wrappers() {
    let mut hmac = tsonic_node::crypto::create_hmac("sha256", b"key").unwrap();
    hmac.update_string("The quick brown fox jumps over the lazy dog", Some("utf8"))
        .unwrap();
    assert_eq!(
        hmac.digest_string("hex").unwrap(),
        "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    );

    let secret = tsonic_node::buffer::Buffer::from_string("secret", Some("utf8")).unwrap();
    let key = tsonic_node::crypto::create_secret_key(&secret);
    assert_eq!(key.key_type(), "secret");
    assert_eq!(key.symmetric_key_size(), Some(6));
    assert_eq!(key.asymmetric_key_type(), None);
    assert_eq!(key.asymmetric_key_details(), None);
    assert_eq!(key.export(), secret);
    assert_eq!(key.export_string("hex").unwrap(), "736563726574");
    assert_eq!(
        key.export_with_options(tsonic_node::crypto::KeyExportOptions {
            encoding: Some("hex".to_string()),
            ..tsonic_node::crypto::KeyExportOptions::default()
        })
        .unwrap(),
        tsonic_node::crypto::KeyExportResult::String("736563726574".to_string())
    );
    assert!(key.equals(&tsonic_node::crypto::create_secret_key_bytes(b"secret")));

    let cert = tsonic_node::crypto::X509Certificate::new(secret.clone());
    assert_eq!(cert.raw(), secret);
    assert_eq!(
        cert.fingerprint256(),
        "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe\
         97bf527a25b"
            .replace(' ', "")
    );
    assert_eq!(
        cert.to_legacy_object().fingerprint256,
        cert.fingerprint256()
    );

    let crypto = tsonic_node::crypto::webcrypto::crypto();
    let digest = crypto.subtle().digest("SHA-256", b"abc").unwrap();
    assert_eq!(
        digest.to_string(Some("hex")).unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let mut random = tsonic_node::buffer::Buffer::alloc(8);
    crypto.get_random_values(&mut random).unwrap();
    assert_eq!(random.len(), 8);
    assert_eq!(crypto.random_uuid().unwrap().len(), 36);
    let subtle = crypto.subtle();
    let secret_key = subtle.import_secret_key("HMAC", &secret, &["sign", "verify"]);
    assert_eq!(secret_key.key_type, "secret");
    assert_eq!(
        subtle.export_key("raw", &secret_key).unwrap(),
        tsonic_node::crypto::KeyExportResult::Buffer(secret.clone())
    );
    assert!(matches!(
        subtle.export_key("jwk", &secret_key).unwrap(),
        tsonic_node::crypto::KeyExportResult::String(value) if value.contains("\"kty\":\"oct\"")
    ));

    let algorithm = tsonic_node::crypto::HmacKeyAlgorithm {
        name: "HMAC".to_string(),
        hash: tsonic_node::crypto::KeyAlgorithm {
            name: "SHA-256".to_string(),
        },
        length: 256,
    };
    assert_eq!(algorithm.hash.name, "SHA-256");
}

#[test]
fn crypto_pbkdf2_and_hkdf_match_standard_vectors() {
    let derived = tsonic_node::crypto::pbkdf2_sync(b"password", b"salt", 1, 32, "sha256").unwrap();
    assert_eq!(
        derived.to_string(Some("hex")).unwrap(),
        "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
    );
    let params = tsonic_node::crypto::Pbkdf2Params {
        password: tsonic_node::buffer::Buffer::from_string("password", Some("utf8")).unwrap(),
        salt: tsonic_node::buffer::Buffer::from_string("salt", Some("utf8")).unwrap(),
        iterations: 1,
        key_len: 32,
        digest: "sha256".to_string(),
    };
    assert_eq!(
        tsonic_node::crypto::pbkdf2_sync_params(&params).unwrap(),
        derived
    );
    let mut callback_result = None;
    tsonic_node::crypto::pbkdf2_callback(&params, |result| {
        callback_result = Some(result);
    });
    assert_eq!(callback_result.unwrap().unwrap(), derived);

    let hkdf = tsonic_node::crypto::hkdf_sync(
        "sha256",
        &[0x0b; 22],
        &[
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
        ],
        &[0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9],
        42,
    )
    .unwrap();
    assert_eq!(
        hkdf.to_string(Some("hex")).unwrap(),
        "3cb25f25faacd57a90434f64d0362f2a\
         2d2d0a90cf1a5a4c5db02d56ecc4c5bf\
         34007208d5b887185865"
            .replace(' ', "")
    );
    let hkdf_params = tsonic_node::crypto::HkdfParams {
        digest: "sha256".to_string(),
        input_keying_material: tsonic_node::buffer::Buffer::from_bytes(vec![0x0b; 22]),
        salt: tsonic_node::buffer::Buffer::from_bytes(vec![
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
        ]),
        info: tsonic_node::buffer::Buffer::from_bytes(vec![
            0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
        ]),
        key_len: 42,
    };
    assert_eq!(
        tsonic_node::crypto::hkdf_sync_params(&hkdf_params).unwrap(),
        hkdf
    );
    let mut hkdf_callback_result = None;
    tsonic_node::crypto::hkdf_callback(&hkdf_params, |result| {
        hkdf_callback_result = Some(result);
    });
    assert_eq!(hkdf_callback_result.unwrap().unwrap(), hkdf);
    assert!(tsonic_node::crypto::scrypt_sync(
        b"password",
        b"salt",
        32,
        tsonic_node::crypto::ScryptOptions::default(),
    )
    .is_err());
}

#[test]
fn crypto_streaming_sign_and_verify_carriers_are_closed() {
    let key_pair = tsonic_node::crypto::generate_rsa_key_pair(2048).unwrap();
    let public_key = key_pair.public_key();
    let mut signer = tsonic_node::crypto::create_sign("sha256");
    signer
        .update_string("important", Some("utf8"))
        .unwrap()
        .update_bytes(b" message");
    let signature = signer
        .sign_with_options(
            &key_pair,
            tsonic_node::crypto::SigningOptions {
                padding: Some(tsonic_node::crypto::constants().rsa_pkcs1_padding),
                salt_length: None,
                dsa_encoding: None,
            },
        )
        .unwrap();

    let mut verifier = tsonic_node::crypto::create_verify("sha256");
    verifier.update_bytes(b"important message");
    assert!(verifier
        .verify_with_options(
            &public_key,
            &signature,
            tsonic_node::crypto::VerifyKeyObjectInput {
                padding: None,
                salt_length: None,
            },
        )
        .unwrap());
}
