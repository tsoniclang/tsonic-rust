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

    assert!(tsonic_node::crypto::get_hashes().contains(&"sha256"));
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
    assert_eq!(key.export(), secret);

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
}
