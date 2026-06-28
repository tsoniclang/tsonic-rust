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
    let mut tls_options = tsonic_node::tls::ConnectOptions::new("example.com", 443);
    tls_options.alpn_protocols.push("h2".to_string());
    tls_options.min_version = Some("TLSv1.3".to_string());
    tls_options.request_ocsp = true;
    let socket = tsonic_node::tls::connect(&tls_options).unwrap();
    assert_eq!(socket.servername(), "example.com");
    assert!(socket.authorized());
    assert_eq!(socket.authorization_error(), None);
    assert_eq!(socket.alpn_protocol(), Some("h2"));
    assert_eq!(socket.get_cipher().name, "TLS_AES_256_GCM_SHA384");
    assert_eq!(socket.get_cipher().version, "TLSv1.3");
    assert!(socket
        .get_peer_certificate()
        .subjectaltname
        .contains("example.com"));
    assert!(socket.get_certificate().subject.contains("localhost"));
    assert_eq!(socket.get_ephemeral_key_info().name, "X25519");
    assert_eq!(socket.get_session().len(), 32);
    assert!(!socket.is_session_reused());
    assert_eq!(socket.get_finished().len(), 32);
    assert_eq!(socket.get_peer_finished().len(), 32);
    assert!(socket
        .get_shared_sigalgs()
        .contains(&"rsa_pss_rsae_sha256".to_string()));
    let mut reused_options = tsonic_node::tls::ConnectOptions::new("example.com", 443);
    reused_options.session = Some(socket.get_session().to_vec());
    reused_options.reject_unauthorized = false;
    let mut reused = tsonic_node::tls::connect(&reused_options).unwrap();
    assert!(reused.is_session_reused());
    assert!(!reused.authorized());
    assert_eq!(
        reused.authorization_error(),
        Some("UNABLE_TO_VERIFY_LEAF_SIGNATURE")
    );
    assert!(reused.set_ticket_keys(&[1; 47]).is_err());
    reused.set_ticket_keys(&[2; 48]).unwrap();
    assert_eq!(reused.get_session(), &[2; 48]);
    reused.enable_trace();
    assert!(reused.trace_enabled());
    let context = tsonic_node::tls::create_secure_context(tsonic_node::tls::SecureContextOptions {
        key: Some("key".to_string()),
        cert: Some("cert".to_string()),
        pfx: Some("pfx".to_string()),
        passphrase: Some("secret".to_string()),
        ca: vec!["ca".to_string()],
        alpn_protocols: vec!["h2".to_string()],
        ciphers: Some("TLS_AES_256_GCM_SHA384".to_string()),
        sigalgs: Some("rsa_pss_rsae_sha256".to_string()),
        min_version: Some("TLSv1.2".to_string()),
        max_version: Some("TLSv1.3".to_string()),
        honor_cipher_order: true,
    });
    assert_eq!(context.options().alpn_protocols, vec!["h2".to_string()]);
    assert!(context.options().honor_cipher_order);

    let https_options = tsonic_node::https::RequestOptions::get("https://example.com/");
    assert_eq!(https_options.method, "GET");
    assert!(tsonic_node::https::get("http://example.com/").is_err());
    let https_server = tsonic_node::https::create_server(
        tsonic_node::https::ServerOptions::default(),
        |_, response| response.end(None),
    );
    assert!(https_server.options().ca.is_empty());

    let http2 = tsonic_node::http2::connect("https://example.com").unwrap();
    assert_eq!(http2.authority, "https://example.com");
    assert!(tsonic_node::http2::connect("example.com").is_err());
    let mut session = tsonic_node::http2::connect_session("https://example.com").unwrap();
    assert_eq!(session.authority(), "https://example.com");
    assert!(!session.closed());
    assert_eq!(session.local_settings().initial_window_size, 65_535);
    session.settings(tsonic_node::http2::Http2Settings {
        enable_push: false,
        max_concurrent_streams: Some(100),
        ..tsonic_node::http2::Http2Settings::default()
    });
    assert!(!session.local_settings().enable_push);
    assert_eq!(session.ping(b"123").unwrap(), b"123\0\0\0\0\0".to_vec());
    assert!(session.ping(b"too-long-payload").is_err());
    let timed = std::cell::Cell::new(false);
    session.set_timeout(50, Some(|| timed.set(true)));
    assert_eq!(session.timeout(), Some(50));
    assert!(timed.get());
    let state = session.state();
    assert_eq!(state.local_window_size, 65_535);
    session.goaway(tsonic_node::http2::NGHTTP2_CANCEL);
    assert_eq!(
        session.goaway_code(),
        Some(tsonic_node::http2::NGHTTP2_CANCEL)
    );
    assert!(session.closed());
    session.destroy();
    assert!(session.destroyed());
    let mut server = tsonic_node::http2::create_secure_server(tsonic_node::http2::ServerOptions {
        allow_http1: true,
        settings: BTreeMap::new(),
    });
    assert!(server.secure());
    assert!(server.options().allow_http1);
    server.set_timeout(100, Some(|| {}));
    assert_eq!(server.timeout(), Some(100));
    server.close();
    assert!(server.closed());
    let mut stream = tsonic_node::http2::Http2Stream::new(BTreeMap::from([
        (
            tsonic_node::http2::HTTP2_HEADER_METHOD.to_string(),
            tsonic_node::http2::HTTP2_METHOD_GET.to_string(),
        ),
        (
            tsonic_node::http2::HTTP2_HEADER_PATH.to_string(),
            "/".to_string(),
        ),
    ]));
    assert_eq!(
        stream.get_header(tsonic_node::http2::HTTP2_HEADER_METHOD),
        Some("GET")
    );
    assert!(stream
        .get_header_names()
        .contains(&tsonic_node::http2::HTTP2_HEADER_PATH.to_string()));
    let headers = BTreeMap::from([(
        tsonic_node::http2::HTTP2_HEADER_STATUS.to_string(),
        tsonic_node::http2::HTTP_STATUS_OK.to_string(),
    )]);
    stream.respond(&headers);
    stream.additional_headers(&BTreeMap::from([("x-extra".to_string(), "1".to_string())]));
    stream.respond_with_file("/tmp/file.txt", &BTreeMap::new());
    assert!(stream.headers_sent());
    assert_eq!(stream.sent_headers().len(), 3);
    stream.send_trailers(&BTreeMap::from([(
        "x-trailer".to_string(),
        "done".to_string(),
    )]));
    assert_eq!(stream.trailers().get("x-trailer").unwrap(), "done");
    stream.set_timeout(25, Some(|| {}));
    assert_eq!(stream.timeout(), Some(25));
    stream.write(b"hello");
    assert_eq!(stream.data(), b"hello");
    stream.close_with_code(tsonic_node::http2::NGHTTP2_NO_ERROR);
    assert_eq!(stream.rst_code(), tsonic_node::http2::NGHTTP2_NO_ERROR);
    assert!(stream.closed());
    stream.destroy();
    assert!(stream.destroyed());
    stream.end();
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
