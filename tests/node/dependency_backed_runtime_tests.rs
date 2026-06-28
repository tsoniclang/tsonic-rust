use std::collections::BTreeMap;

use tsonic_node::buffer::Buffer;

#[test]
fn crypto_aes_gcm_round_trips_and_rejects_bad_authentication() {
    let key = Buffer::from_bytes(vec![7; 32]);
    let iv = Buffer::from_bytes(vec![3; 12]);
    let plaintext = Buffer::from_string("secret payload", Some("utf8")).unwrap();

    let encrypted = tsonic_node::crypto::aes_256_gcm_encrypt(&key, &iv, &plaintext).unwrap();
    assert_ne!(encrypted.ciphertext.as_bytes(), plaintext.as_bytes());
    assert_eq!(encrypted.auth_tag.len(), 16);

    let decrypted = tsonic_node::crypto::aes_256_gcm_decrypt(
        &key,
        &iv,
        &encrypted.ciphertext,
        &encrypted.auth_tag,
    )
    .unwrap();
    assert_eq!(decrypted.to_string(Some("utf8")).unwrap(), "secret payload");

    let bad_tag = Buffer::from_bytes(vec![0; 16]);
    assert!(
        tsonic_node::crypto::aes_256_gcm_decrypt(&key, &iv, &encrypted.ciphertext, &bad_tag)
            .is_err()
    );
}

#[test]
fn crypto_rsa_sha256_sign_and_verify() {
    let key_pair = tsonic_node::crypto::generate_rsa_key_pair(2048).unwrap();
    let public_key = key_pair.public_key();
    let signature = tsonic_node::crypto::sign_sha256(&key_pair, b"important message");

    assert!(
        tsonic_node::crypto::verify_sha256(&public_key, b"important message", &signature).unwrap()
    );
    assert!(!tsonic_node::crypto::verify_sha256(&public_key, b"tampered", &signature).unwrap());
}

#[test]
fn https_http2_and_tls_validate_closed_request_shapes() {
    assert_eq!(tsonic_node::tls::default_port(), 443);
    assert!(tsonic_node::tls::check_server_identity("example.com").is_ok());
    assert!(tsonic_node::tls::check_server_identity("https://example.com").is_err());

    let https_options = tsonic_node::https::RequestOptions::get("https://example.com/");
    assert_eq!(https_options.method, "GET");
    assert!(tsonic_node::https::get("http://example.com/").is_err());

    let http2 = tsonic_node::http2::connect("https://example.com").unwrap();
    assert_eq!(http2.authority, "https://example.com");
    assert!(tsonic_node::http2::connect("example.com").is_err());
}

#[test]
fn cluster_exposes_closed_primary_worker_model() {
    let settings = tsonic_node::cluster::setup_primary("/bin/echo", &["worker"]);
    assert_eq!(settings.exec, "/bin/echo");
    assert_eq!(settings.args, vec!["worker".to_string()]);
    assert!(tsonic_node::cluster::is_primary());
    assert!(!tsonic_node::cluster::is_worker());

    let env = BTreeMap::new();
    let worker = tsonic_node::cluster::fork(&settings, 1, &env).unwrap();
    assert_eq!(worker.id, 1);
    assert!(worker.process_id > 0);
}
