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
    assert_eq!(tsonic_node::crypto::constants().rsa_sslv23_padding, 2);
    assert_eq!(tsonic_node::crypto::constants().rsa_ssl_v23_padding, 2);
    assert_eq!(
        tsonic_node::crypto::constants().ssl_op_no_tlsv1_3,
        536_870_912
    );
    assert_eq!(tsonic_node::crypto::constants().ssl_op_no_ticket, 16_384);
    assert_eq!(
        tsonic_node::crypto::constants().ssl_op_legacy_server_connect,
        4
    );
    assert_eq!(
        tsonic_node::crypto::constants().point_conversion_uncompressed,
        4
    );
    let constants = tsonic_node::crypto::constants();
    assert_eq!(
        tsonic_node::crypto::DH_CHECK_P_NOT_SAFE_PRIME,
        constants.dh_check_p_not_safe_prime
    );
    assert_eq!(
        tsonic_node::crypto::DH_CHECK_P_NOT_PRIME,
        constants.dh_check_p_not_prime
    );
    assert_eq!(
        tsonic_node::crypto::DH_UNABLE_TO_CHECK_GENERATOR,
        constants.dh_unable_to_check_generator
    );
    assert_eq!(
        tsonic_node::crypto::DH_NOT_SUITABLE_GENERATOR,
        constants.dh_not_suitable_generator
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_NONE,
        constants.engine_method_none
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_RSA,
        constants.engine_method_rsa
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_DSA,
        constants.engine_method_dsa
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_DH,
        constants.engine_method_dh
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_RAND,
        constants.engine_method_rand
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_EC,
        constants.engine_method_ec
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_CIPHERS,
        constants.engine_method_ciphers
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_DIGESTS,
        constants.engine_method_digests
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_PKEY_METHS,
        constants.engine_method_pkey_meths
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_PKEY_ASN1_METHS,
        constants.engine_method_pkey_asn1_meths
    );
    assert_eq!(
        tsonic_node::crypto::ENGINE_METHOD_ALL,
        constants.engine_method_all
    );
    assert_eq!(
        tsonic_node::crypto::RSA_PKCS1_PADDING,
        constants.rsa_pkcs1_padding
    );
    assert_eq!(
        tsonic_node::crypto::RSA_SSLV23_PADDING,
        constants.rsa_sslv23_padding
    );
    assert_eq!(
        tsonic_node::crypto::RSA_SSL_V23_PADDING,
        constants.rsa_ssl_v23_padding
    );
    assert_eq!(
        tsonic_node::crypto::RSA_NO_PADDING,
        constants.rsa_no_padding
    );
    assert_eq!(
        tsonic_node::crypto::RSA_PKCS1_OAEP_PADDING,
        constants.rsa_pkcs1_oaep_padding
    );
    assert_eq!(
        tsonic_node::crypto::RSA_X931_PADDING,
        constants.rsa_x931_padding
    );
    assert_eq!(
        tsonic_node::crypto::RSA_PKCS1_PSS_PADDING,
        constants.rsa_pkcs1_pss_padding
    );
    assert_eq!(
        tsonic_node::crypto::RSA_PSS_SALTLEN_DIGEST,
        constants.rsa_pss_saltlen_digest
    );
    assert_eq!(
        tsonic_node::crypto::RSA_PSS_SALTLEN_MAX_SIGN,
        constants.rsa_pss_saltlen_max_sign
    );
    assert_eq!(
        tsonic_node::crypto::RSA_PSS_SALTLEN_AUTO,
        constants.rsa_pss_saltlen_auto
    );
    assert_eq!(
        tsonic_node::crypto::POINT_CONVERSION_COMPRESSED,
        constants.point_conversion_compressed
    );
    assert_eq!(
        tsonic_node::crypto::POINT_CONVERSION_UNCOMPRESSED,
        constants.point_conversion_uncompressed
    );
    assert_eq!(
        tsonic_node::crypto::POINT_CONVERSION_HYBRID,
        constants.point_conversion_hybrid
    );
    assert_eq!(
        tsonic_node::crypto::DEFAULT_CORE_CIPHER_LIST,
        constants.default_core_cipher_list
    );
    assert_eq!(
        tsonic_node::crypto::DEFAULT_CIPHER_LIST,
        constants.default_cipher_list
    );
    assert_eq!(
        tsonic_node::crypto::OPENSSL_VERSION_NUMBER,
        constants.openssl_version_number
    );
    assert_eq!(tsonic_node::crypto::SSL_OP_ALL, constants.ssl_op_all);
    assert_eq!(
        tsonic_node::crypto::SSL_OP_ALLOW_NO_DHE_KEX,
        constants.ssl_op_allow_no_dhe_kex
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
        constants.ssl_op_allow_unsafe_legacy_renegotiation
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_CIPHER_SERVER_PREFERENCE,
        constants.ssl_op_cipher_server_preference
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_CISCO_ANYCONNECT,
        constants.ssl_op_cisco_anyconnect
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_COOKIE_EXCHANGE,
        constants.ssl_op_cookie_exchange
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_CRYPTOPRO_TLSEXT_BUG,
        constants.ssl_op_cryptopro_tlsext_bug
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS,
        constants.ssl_op_dont_insert_empty_fragments
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_LEGACY_SERVER_CONNECT,
        constants.ssl_op_legacy_server_connect
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_COMPRESSION,
        constants.ssl_op_no_compression
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_ENCRYPT_THEN_MAC,
        constants.ssl_op_no_encrypt_then_mac
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_QUERY_MTU,
        constants.ssl_op_no_query_mtu
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_RENEGOTIATION,
        constants.ssl_op_no_renegotiation
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION,
        constants.ssl_op_no_session_resumption_on_renegotiation
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_SSLV2,
        constants.ssl_op_no_sslv2
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_SSLV3,
        constants.ssl_op_no_sslv3
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_TICKET,
        constants.ssl_op_no_ticket
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_TLSV1,
        constants.ssl_op_no_tlsv1
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_TLSV1_1,
        constants.ssl_op_no_tlsv1_1
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_TLSV1_2,
        constants.ssl_op_no_tlsv1_2
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_NO_TLSV1_3,
        constants.ssl_op_no_tlsv1_3
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_PRIORITIZE_CHACHA,
        constants.ssl_op_prioritize_chacha
    );
    assert_eq!(
        tsonic_node::crypto::SSL_OP_TLS_ROLLBACK_BUG,
        constants.ssl_op_tls_rollback_bug
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
    hash.update(b"a");
    hash.update_string("bc", Some("utf8")).unwrap();
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
    hmac.update(b"The quick brown fox ");
    hmac.update_string("jumps over the lazy dog", Some("utf8"))
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
                context: None,
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
                key: None,
                padding: None,
                salt_length: None,
            },
        )
        .unwrap());
}

#[test]
fn crypto_option_and_webcrypto_param_carriers_expose_closed_fields() {
    let heap = tsonic_node::crypto::secure_heap_used();
    assert_eq!(heap.total, 0);
    assert_eq!(heap.used, 0);
    assert_eq!(heap.utilization, 0);
    assert_eq!(heap.min, 0);

    let random_options = tsonic_node::crypto::RandomUUIDOptions {
        disable_entropy_cache: true,
    };
    assert!(random_options.disable_entropy_cache);
    let hash_options = tsonic_node::crypto::HashOptions {
        output_length: None,
    };
    assert_eq!(hash_options.output_length, None);
    let digest_options = tsonic_node::crypto::OneShotDigestOptions {
        output_length: None,
        encoding: Some("hex".to_string()),
    };
    assert_eq!(digest_options.encoding.as_deref(), Some("hex"));
    let cipher_options = tsonic_node::crypto::CipherInfoOptions {
        key_length: Some(32),
        iv_length: Some(12),
    };
    let cipher_info =
        tsonic_node::crypto::get_cipher_info("aes-256-gcm", Some(cipher_options)).unwrap();
    assert_eq!(cipher_info.name, "aes-256-gcm");
    assert_eq!(cipher_info.nid, 0);
    assert_eq!(cipher_info.block_size, 1);
    assert_eq!(cipher_info.iv_length, 12);
    assert_eq!(cipher_info.key_length, 32);
    assert_eq!(cipher_info.mode, "gcm");

    let key_export = tsonic_node::crypto::KeyExportOptions {
        format: "buffer".to_string(),
        key_type: Some("secret".to_string()),
        cipher: Some("aes-256-gcm".to_string()),
        passphrase: Some("pass".to_string()),
        encoding: Some("hex".to_string()),
    };
    assert_eq!(key_export.format, "buffer");
    assert_eq!(key_export.key_type.as_deref(), Some("secret"));
    assert_eq!(key_export.cipher.as_deref(), Some("aes-256-gcm"));
    assert_eq!(key_export.passphrase.as_deref(), Some("pass"));
    assert_eq!(key_export.encoding.as_deref(), Some("hex"));

    let jwk = tsonic_node::crypto::JsonWebKey {
        kty: Some("oct".to_string()),
        crv: None,
        x: None,
        y: None,
        d: None,
        n: None,
        e: None,
        k: Some("abc".to_string()),
        p: Some("p".to_string()),
        q: Some("q".to_string()),
        dp: Some("dp".to_string()),
        dq: Some("dq".to_string()),
        qi: Some("qi".to_string()),
        oth: vec![tsonic_node::crypto::RsaOtherPrimesInfo {
            r: Some("r".to_string()),
            d: Some("d".to_string()),
            t: Some("t".to_string()),
        }],
        alg: Some("HS256".to_string()),
        key_use: Some("sig".to_string()),
        key_ops: vec!["sign".to_string()],
        ext: true,
    };
    let jwk_input = tsonic_node::crypto::JsonWebKeyInput { jwk: jwk.clone() };
    assert_eq!(jwk_input.jwk.kty.as_deref(), Some("oct"));
    assert_eq!(jwk.k.as_deref(), Some("abc"));
    assert_eq!(jwk.p.as_deref(), Some("p"));
    assert_eq!(jwk.q.as_deref(), Some("q"));
    assert_eq!(jwk.dp.as_deref(), Some("dp"));
    assert_eq!(jwk.dq.as_deref(), Some("dq"));
    assert_eq!(jwk.qi.as_deref(), Some("qi"));
    assert_eq!(jwk.oth[0].r.as_deref(), Some("r"));
    assert_eq!(jwk.key_use.as_deref(), Some("sig"));
    assert_eq!(jwk.alg.as_deref(), Some("HS256"));
    assert_eq!(jwk.key_ops, vec!["sign"]);
    assert!(jwk.ext);
    let jwk_export = tsonic_node::crypto::JwkKeyExportOptions {
        format: "jwk".to_string(),
    };
    assert_eq!(jwk_export.format, "jwk");

    let asym = tsonic_node::crypto::AsymmetricKeyDetails {
        modulus_length: Some(2048),
        public_exponent: Some(65_537),
        hash_algorithm: Some("sha256".to_string()),
        mgf1_hash_algorithm: Some("sha256".to_string()),
        salt_length: Some(32),
        named_curve: Some("P-256".to_string()),
        divisor_length: None,
    };
    assert_eq!(asym.modulus_length, Some(2048));
    assert_eq!(asym.public_exponent, Some(65_537));
    assert_eq!(asym.hash_algorithm.as_deref(), Some("sha256"));
    assert_eq!(asym.mgf1_hash_algorithm.as_deref(), Some("sha256"));
    assert_eq!(asym.salt_length, Some(32));
    assert_eq!(asym.named_curve.as_deref(), Some("P-256"));
    assert_eq!(asym.divisor_length, None);

    let signing = tsonic_node::crypto::SigningOptions {
        padding: Some(tsonic_node::crypto::constants().rsa_pkcs1_padding),
        salt_length: Some(32),
        dsa_encoding: Some("der".to_string()),
        context: Some(tsonic_node::buffer::Buffer::from_bytes(vec![1, 2, 3])),
    };
    assert_eq!(
        signing.padding,
        Some(tsonic_node::crypto::constants().rsa_pkcs1_padding)
    );
    assert_eq!(signing.salt_length, Some(32));
    assert_eq!(signing.dsa_encoding.as_deref(), Some("der"));
    assert_eq!(signing.context.as_ref().unwrap().len(), 3);
    let verify = tsonic_node::crypto::VerifyKeyObjectInput {
        key: None,
        padding: signing.padding,
        salt_length: signing.salt_length,
    };
    assert_eq!(verify.key, None);
    assert_eq!(verify.padding, signing.padding);
    assert_eq!(verify.salt_length, signing.salt_length);

    let scrypt = tsonic_node::crypto::ScryptOptions {
        cost: 1024,
        block_size: 8,
        parallelization: 2,
        maxmem: 1 << 20,
    };
    assert_eq!(scrypt.cost, 1024);
    assert_eq!(scrypt.block_size, 8);
    assert_eq!(scrypt.parallelization, 2);
    assert_eq!(scrypt.maxmem, 1 << 20);

    let key_algorithm = tsonic_node::crypto::KeyAlgorithm {
        name: "SHA-256".to_string(),
    };
    let rsa_algorithm = tsonic_node::crypto::RsaKeyAlgorithm {
        name: "RSA-PSS".to_string(),
        modulus_length: 2048,
        public_exponent: vec![1, 0, 1],
    };
    let rsa_hashed = tsonic_node::crypto::RsaHashedKeyAlgorithm {
        rsa: rsa_algorithm.clone(),
        hash: key_algorithm.clone(),
    };
    assert_eq!(rsa_hashed.rsa.modulus_length, 2048);
    assert_eq!(rsa_hashed.hash.name, "SHA-256");
    let hmac_algorithm = tsonic_node::crypto::HmacKeyAlgorithm {
        name: "HMAC".to_string(),
        hash: key_algorithm.clone(),
        length: 256,
    };
    assert_eq!(hmac_algorithm.hash.name, "SHA-256");
    assert_eq!(hmac_algorithm.length, 256);

    let crypto_key = tsonic_node::crypto::CryptoKey::secret(
        "HMAC",
        tsonic_node::buffer::Buffer::from_string("secret", Some("utf8")).unwrap(),
        &["sign", "verify"],
    );
    assert_eq!(crypto_key.key_type, "secret");
    assert!(crypto_key.extractable);
    assert_eq!(crypto_key.algorithm.name, "HMAC");
    assert_eq!(crypto_key.usages, vec!["sign", "verify"]);
    assert_eq!(crypto_key.data().len(), 6);
    let key_pair = tsonic_node::crypto::CryptoKeyPair {
        public_key: crypto_key.clone(),
        private_key: crypto_key.clone(),
    };
    assert_eq!(key_pair.public_key.key_type, "secret");
    assert_eq!(key_pair.private_key.key_type, "secret");

    let iv = tsonic_node::buffer::Buffer::from_bytes(vec![0; 12]);
    let aead = tsonic_node::crypto::AeadParams {
        name: "AES-GCM".to_string(),
        iv: iv.clone(),
        additional_data: Some(tsonic_node::buffer::Buffer::from_bytes(vec![1, 2])),
        tag_length: Some(128),
    };
    assert_eq!(aead.name, "AES-GCM");
    assert_eq!(aead.iv.len(), 12);
    assert_eq!(aead.additional_data.as_ref().unwrap().len(), 2);
    assert_eq!(aead.tag_length, Some(128));
    let ctr = tsonic_node::crypto::AesCtrParams {
        name: "AES-CTR".to_string(),
        counter: iv.clone(),
        length: 64,
    };
    assert_eq!(ctr.counter.len(), 12);
    assert_eq!(ctr.length, 64);
    let pss = tsonic_node::crypto::RsaPssParams {
        name: "RSA-PSS".to_string(),
        salt_length: 32,
    };
    assert_eq!(pss.salt_length, 32);
    let oaep = tsonic_node::crypto::RsaOaepParams {
        name: "RSA-OAEP".to_string(),
        label: Some(iv.clone()),
    };
    assert_eq!(oaep.label.unwrap().len(), 12);
    let ecdsa = tsonic_node::crypto::EcdsaParams {
        name: "ECDSA".to_string(),
        hash: key_algorithm,
    };
    assert_eq!(ecdsa.hash.name, "SHA-256");
    let ecdh = tsonic_node::crypto::EcdhKeyDeriveParams {
        name: "ECDH".to_string(),
        public: crypto_key,
    };
    assert_eq!(ecdh.public.key_type, "secret");
}

#[test]
fn crypto_extended_option_carriers_expose_documented_fields() {
    let bytes = tsonic_node::buffer::Buffer::from_bytes(vec![1, 2, 3, 4]);
    let private_input = tsonic_node::crypto::PrivateKeyInput {
        key: bytes.clone(),
        format: Some("pem".to_string()),
        key_type: Some("pkcs8".to_string()),
        encoding: Some("utf8".to_string()),
        passphrase: Some(bytes.clone()),
    };
    assert_eq!(private_input.key.len(), 4);
    assert_eq!(private_input.format.as_deref(), Some("pem"));
    assert_eq!(private_input.key_type.as_deref(), Some("pkcs8"));
    assert_eq!(private_input.encoding.as_deref(), Some("utf8"));
    assert_eq!(private_input.passphrase.as_ref().unwrap().len(), 4);

    let public_input = tsonic_node::crypto::PublicKeyInput {
        key: bytes.clone(),
        format: Some("der".to_string()),
        key_type: Some("spki".to_string()),
        encoding: None,
    };
    assert_eq!(public_input.key_type.as_deref(), Some("spki"));

    let rsa_private = tsonic_node::crypto::RsaPrivateKeyInput {
        key: bytes.clone(),
        padding: Some(tsonic_node::crypto::constants().rsa_pkcs1_oaep_padding),
        oaep_hash: Some("sha256".to_string()),
        oaep_label: Some(bytes.clone()),
        passphrase: Some("secret".to_string()),
    };
    assert_eq!(rsa_private.oaep_hash.as_deref(), Some("sha256"));
    assert_eq!(rsa_private.oaep_label.as_ref().unwrap().len(), 4);
    let rsa_public = tsonic_node::crypto::RsaPublicKeyInput {
        key: bytes.clone(),
        padding: Some(tsonic_node::crypto::constants().rsa_pkcs1_padding),
    };
    assert_eq!(rsa_public.key.len(), 4);

    let aes_algorithm = tsonic_node::crypto::AesKeyAlgorithm {
        name: "AES-GCM".to_string(),
        length: 256,
    };
    let aes_gen = tsonic_node::crypto::AesKeyGenParams {
        name: aes_algorithm.name.clone(),
        length: aes_algorithm.length,
    };
    let aes_derived = tsonic_node::crypto::AesDerivedKeyParams {
        name: "AES-CBC".to_string(),
        length: 128,
    };
    let aes_cbc = tsonic_node::crypto::AesCbcParams {
        name: aes_derived.name.clone(),
        iv: bytes.clone(),
    };
    assert_eq!(aes_gen.length, 256);
    assert_eq!(aes_derived.length, 128);
    assert_eq!(aes_cbc.iv.len(), 4);

    let rsa_gen = tsonic_node::crypto::RsaKeyGenParams {
        name: "RSA-PSS".to_string(),
        modulus_length: 2048,
        public_exponent: vec![1, 0, 1],
    };
    let rsa_hashed_gen = tsonic_node::crypto::RsaHashedKeyGenParams {
        name: rsa_gen.name.clone(),
        modulus_length: rsa_gen.modulus_length,
        public_exponent: rsa_gen.public_exponent.clone(),
        hash: "SHA-256".to_string(),
    };
    assert_eq!(rsa_hashed_gen.hash, "SHA-256");

    let hmac_gen = tsonic_node::crypto::HmacKeyGenParams {
        name: "HMAC".to_string(),
        hash: "SHA-256".to_string(),
        length: Some(256),
    };
    let hmac_import = tsonic_node::crypto::HmacImportParams {
        name: hmac_gen.name.clone(),
        hash: hmac_gen.hash.clone(),
        length: hmac_gen.length,
    };
    assert_eq!(hmac_import.length, Some(256));

    let ec_gen = tsonic_node::crypto::EcKeyGenParams {
        name: "ECDSA".to_string(),
        named_curve: "P-256".to_string(),
    };
    let ec_import = tsonic_node::crypto::EcKeyImportParams {
        name: ec_gen.name.clone(),
        named_curve: ec_gen.named_curve.clone(),
    };
    assert_eq!(ec_import.named_curve, "P-256");

    let cshake = tsonic_node::crypto::CShakeParams {
        name: "cSHAKE128".to_string(),
        output_length: 32,
        function_name: Some(bytes.clone()),
        customization: Some(bytes.clone()),
    };
    assert_eq!(cshake.output_length, 32);
    assert_eq!(cshake.function_name.as_ref().unwrap().len(), 4);
    let turbo = tsonic_node::crypto::TurboShakeParams {
        name: "TurboSHAKE128".to_string(),
        output_length: 32,
        domain_separation: Some(0x1f),
    };
    assert_eq!(turbo.domain_separation, Some(0x1f));
    let kangaroo = tsonic_node::crypto::KangarooTwelveParams {
        name: "KangarooTwelve".to_string(),
        output_length: 32,
        customization: Some(bytes.clone()),
    };
    assert_eq!(kangaroo.customization.as_ref().unwrap().len(), 4);
    let kmac = tsonic_node::crypto::KmacParams {
        name: "KMAC128".to_string(),
        output_length: 32,
        customization: Some(bytes.clone()),
    };
    assert_eq!(kmac.output_length, 32);
    let kmac_algorithm = tsonic_node::crypto::KmacKeyAlgorithm {
        name: "KMAC128".to_string(),
        length: 256,
    };
    let kmac_gen = tsonic_node::crypto::KmacKeyGenParams {
        name: kmac_algorithm.name.clone(),
        length: Some(kmac_algorithm.length),
    };
    let kmac_import = tsonic_node::crypto::KmacImportParams {
        name: kmac_gen.name.clone(),
        length: kmac_gen.length,
    };
    assert_eq!(kmac_import.length, Some(256));

    let argon = tsonic_node::crypto::Argon2Parameters {
        message: bytes.clone(),
        nonce: bytes.clone(),
        parallelism: 2,
        memory: 4096,
        passes: 3,
        tag_length: 32,
        secret: Some(bytes.clone()),
        associated_data: Some(bytes.clone()),
    };
    assert_eq!(argon.parallelism, 2);
    assert_eq!(argon.secret.as_ref().unwrap().len(), 4);
    let argon_params = tsonic_node::crypto::Argon2Params {
        name: "Argon2id".to_string(),
        nonce: bytes.clone(),
        parallelism: argon.parallelism,
        memory: argon.memory,
        passes: argon.passes,
        version: Some(0x13),
        secret_value: argon.secret.clone(),
        associated_data: argon.associated_data.clone(),
    };
    assert_eq!(argon_params.version, Some(0x13));

    let prime = tsonic_node::crypto::GeneratePrimeOptions {
        add: Some(bytes.clone()),
        rem: Some(bytes.clone()),
        safe: Some(true),
        bigint: Some(false),
    };
    assert_eq!(prime.safe, Some(true));
    let check_prime = tsonic_node::crypto::CheckPrimeOptions { checks: Some(32) };
    assert_eq!(check_prime.checks, Some(32));

    let rsa_pair = tsonic_node::crypto::RsaKeyPairOptions {
        modulus_length: 2048,
        public_exponent: Some(65_537),
    };
    assert_eq!(rsa_pair.public_exponent, Some(65_537));
    let rsa_pss_pair = tsonic_node::crypto::RsaPssKeyPairOptions {
        modulus_length: 2048,
        public_exponent: Some(65_537),
        hash_algorithm: Some("sha256".to_string()),
        mgf1_hash_algorithm: Some("sha256".to_string()),
        salt_length: Some("auto".to_string()),
    };
    assert_eq!(rsa_pss_pair.salt_length.as_deref(), Some("auto"));
    let dsa_pair = tsonic_node::crypto::DsaKeyPairOptions {
        modulus_length: 2048,
        divisor_length: 256,
    };
    assert_eq!(dsa_pair.divisor_length, 256);
    let dh_pair = tsonic_node::crypto::DhKeyPairOptions {
        prime: Some(bytes.clone()),
        prime_length: Some(2048),
        generator: Some(2),
        group_name: Some("modp14".to_string()),
    };
    assert_eq!(dh_pair.group_name.as_deref(), Some("modp14"));
    let ec_pair = tsonic_node::crypto::EcKeyPairOptions {
        named_curve: "P-256".to_string(),
        param_encoding: Some("named".to_string()),
    };
    assert_eq!(ec_pair.param_encoding.as_deref(), Some("named"));
}

#[test]
fn crypto_x509_extended_accessors_are_closed_and_deterministic() {
    let raw = tsonic_node::buffer::Buffer::from_string("certificate", Some("utf8")).unwrap();
    let cert = tsonic_node::crypto::X509Certificate::new(raw.clone());

    assert_eq!(cert.raw(), raw);
    assert_eq!(cert.key_usage(), &[] as &[String]);
    assert_eq!(cert.subject_alt_name(), None);
    assert_eq!(cert.info_access(), None);
    assert_eq!(cert.serial_number(), "");
    assert_eq!(cert.signature_algorithm(), None);
    assert_eq!(cert.signature_algorithm_oid(), "");
    assert!(!cert.ca());
    assert_eq!(cert.valid_from_date().get_time(), 0.0);
    assert_eq!(cert.valid_to_date().get_time(), 0.0);
    assert_eq!(cert.issuer_certificate(), None);
    assert!(!cert.check_issued(&cert));
    assert!(!cert.check_private_key(&tsonic_node::crypto::create_secret_key_bytes(b"different")));
    assert!(cert.verify(&cert.public_key()));
    assert_eq!(cert.check_host("example.com", None), None);
    assert_eq!(cert.check_email("a@example.com", None), None);
    assert_eq!(cert.check_ip("127.0.0.1"), None);
    assert_eq!(cert.to_json(), cert.to_string());
    assert_eq!(
        cert.fingerprint(),
        "735ad571c189d7ba84464bf4a9f1d2280175b128"
    );
    assert_eq!(
        cert.fingerprint512(),
        "3d9e7bd9a4cb0b591c367461e6e8f625181d65bd6f45c1695de3c4e5f1a6b2dc\
         5be58e8f22f9d8e7d16057adef058743ce9b22dd7d33f3db6374c05be0efd982"
            .replace(' ', "")
    );

    let options = tsonic_node::crypto::X509CheckOptions {
        subject: Some("always".to_string()),
        wildcards: Some(true),
        partial_wildcards: Some(false),
        multi_label_wildcards: Some(false),
        single_label_subdomains: Some(true),
    };
    assert_eq!(options.subject.as_deref(), Some("always"));
    assert_eq!(options.wildcards, Some(true));
    assert_eq!(options.single_label_subdomains, Some(true));
}
