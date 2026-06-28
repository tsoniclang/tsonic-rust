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
    let generic_signature =
        tsonic_node::crypto::sign("sha256", &key_pair, b"important message").unwrap();

    assert!(
        tsonic_node::crypto::verify_sha256(&public_key, b"important message", &signature).unwrap()
    );
    assert!(!tsonic_node::crypto::verify_sha256(&public_key, b"tampered", &signature).unwrap());
    assert!(tsonic_node::crypto::verify(
        "sha256",
        &public_key,
        b"important message",
        &generic_signature
    )
    .unwrap());
    assert!(tsonic_node::crypto::sign("sha512", &key_pair, b"important message").is_err());
}

#[test]
fn https_http2_and_tls_validate_closed_request_shapes() {
    assert_eq!(tsonic_node::tls::default_port(), 443);
    assert!(tsonic_node::tls::check_server_identity("example.com").is_ok());
    assert!(tsonic_node::tls::check_server_identity("https://example.com").is_err());
    let mut tls_options = tsonic_node::tls::ConnectOptions::new("example.com", 443);
    tls_options.host = Some("example.com".to_string());
    tls_options.path = Some("/".to_string());
    tls_options.alpn_protocols.push("h2".to_string());
    tls_options.min_version = Some("TLSv1.3".to_string());
    tls_options.timeout = Some(1_000);
    tls_options.min_dh_size = Some(1_024);
    tls_options.request_ocsp = true;
    let socket = tsonic_node::tls::connect(&tls_options).unwrap();
    assert_eq!(socket.servername(), "example.com");
    assert!(socket.authorized());
    assert_eq!(socket.authorization_error(), None);
    assert_eq!(socket.alpn_protocol(), Some("h2"));
    assert!(socket.encrypted());
    assert_eq!(socket.get_protocol(), Some("TLSv1.3"));
    assert_eq!(socket.get_cipher().name, "TLS_AES_256_GCM_SHA384");
    assert_eq!(socket.get_cipher().version, "TLSv1.3");
    assert!(socket
        .get_peer_certificate()
        .subjectaltname
        .contains("example.com"));
    assert!(!socket.get_peer_certificate().ca);
    assert_eq!(socket.get_peer_certificate().bits, Some(2048));
    assert_eq!(
        socket.get_peer_certificate().exponent.as_deref(),
        Some("0x10001")
    );
    assert_eq!(
        socket.get_peer_certificate().nist_curve.as_deref(),
        Some("P-256")
    );
    assert_eq!(
        socket.get_peer_certificate().ext_key_usage,
        vec!["serverAuth".to_string()]
    );
    assert!(socket.get_certificate().subject.contains("localhost"));
    assert_eq!(socket.get_ephemeral_key_info().name, "X25519");
    assert_eq!(socket.get_session().len(), 32);
    assert!(!socket.is_session_reused());
    assert_eq!(socket.get_finished().len(), 32);
    assert_eq!(socket.get_peer_finished().len(), 32);
    assert_eq!(
        socket
            .export_keying_material(8, "EXPORTER-tsonic", b"context")
            .len(),
        8
    );
    assert_eq!(socket.get_tls_ticket().len(), 32);
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
    reused.disable_renegotiation();
    assert!(reused.renegotiation_disabled());
    assert!(!reused.set_max_send_fragment(128));
    assert!(reused.set_max_send_fragment(16_384));
    assert_eq!(reused.max_send_fragment(), Some(16_384));
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
        session_timeout: Some(300),
        allow_partial_trust_chain: true,
        ..tsonic_node::tls::SecureContextOptions::default()
    });
    assert_eq!(context.options().alpn_protocols, vec!["h2".to_string()]);
    assert!(context.options().honor_cipher_order);
    assert_eq!(context.options().session_timeout, Some(300));
    assert!(context.options().allow_partial_trust_chain);
    reused.set_key_cert(context.clone());
    assert_eq!(
        reused.key_cert_context().unwrap().options().cert.as_deref(),
        Some("cert")
    );

    let https_options = tsonic_node::https::RequestOptions::get("https://example.com/");
    assert_eq!(https_options.method, "GET");
    assert!(tsonic_node::https::get("http://example.com/").is_err());
    let mut agent = tsonic_node::https::Agent::new(Some(tsonic_node::https::AgentOptions {
        keep_alive: true,
        keep_alive_msecs: 500,
        max_sockets: 8,
        max_free_sockets: 2,
        max_cached_sessions: 32,
        timeout: Some(1_000),
        reject_unauthorized: true,
        servername: Some("example.com".to_string()),
    }));
    assert!(agent.keep_socket_alive());
    assert!(agent.reuse_socket());
    assert!(agent.get_name(Some(&https_options)).contains("example.com"));
    agent.destroy();
    assert!(agent.destroyed());
    assert!(!agent.reuse_socket());
    let mut https_server = tsonic_node::https::create_server(
        tsonic_node::https::ServerOptions {
            request_cert: true,
            handshake_timeout: Some(30_000),
            max_cached_sessions: 64,
            ..tsonic_node::https::ServerOptions::default()
        },
        |_, response| response.end(None),
    );
    assert!(https_server.options().ca.is_empty());
    assert!(https_server.options().request_cert);
    https_server.set_timeout(2_000, Some(|| {}));
    assert_eq!(https_server.timeout(), Some(2_000));
    https_server.close_idle_connections();
    https_server.close_all_connections();
    assert!(https_server.idle_connections_closed());
    assert!(https_server.all_connections_closed());
    https_server.close();
    assert!(https_server.closed());

    let http2 = tsonic_node::http2::connect("https://example.com").unwrap();
    assert_eq!(http2.authority, "https://example.com");
    assert!(tsonic_node::http2::connect("example.com").is_err());
    let mut session = tsonic_node::http2::connect_session("https://example.com").unwrap();
    assert_eq!(session.authority(), "https://example.com");
    assert!(!session.closed());
    assert!(!session.connecting());
    assert!(session.encrypted());
    assert_eq!(session.alpn_protocol(), Some("h2"));
    assert_eq!(session.origin_set(), &["https://example.com".to_string()]);
    assert_eq!(
        session.session_type(),
        tsonic_node::http2::NGHTTP2_SESSION_CLIENT
    );
    assert!(session.has_ref());
    session.unref();
    assert!(!session.has_ref());
    session.ref_();
    assert!(session.has_ref());
    assert_eq!(session.local_settings().initial_window_size, 65_535);
    session.settings(tsonic_node::http2::Http2Settings {
        enable_push: false,
        max_concurrent_streams: Some(100),
        ..tsonic_node::http2::Http2Settings::default()
    });
    assert!(!session.local_settings().enable_push);
    assert!(session.pending_settings_ack());
    session.acknowledge_settings();
    assert!(!session.pending_settings_ack());
    session.set_local_window_size(100_000);
    assert_eq!(session.local_settings().initial_window_size, 100_000);
    assert_eq!(session.ping(b"123").unwrap(), b"123\0\0\0\0\0".to_vec());
    assert!(session.ping(b"too-long-payload").is_err());
    let timed = std::cell::Cell::new(false);
    session.set_timeout(50, Some(|| timed.set(true)));
    assert_eq!(session.timeout(), Some(50));
    assert!(timed.get());
    let state = session.state();
    assert_eq!(state.local_window_size, 100_000);
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
    assert!(!stream.aborted());
    assert!(!stream.pending());
    assert_eq!(stream.buffer_size(), 0);
    stream.priority(tsonic_node::http2::StreamPriorityOptions {
        exclusive: true,
        parent: Some(1),
        weight: 32,
        silent: false,
    });
    assert_eq!(stream.priority_options().unwrap().weight, 32);
    assert_eq!(stream.state().weight, Some(32));
    let headers = BTreeMap::from([(
        tsonic_node::http2::HTTP2_HEADER_STATUS.to_string(),
        tsonic_node::http2::HTTP_STATUS_OK.to_string(),
    )]);
    stream.respond(&headers);
    stream.additional_headers(&BTreeMap::from([("x-extra".to_string(), "1".to_string())]));
    stream.respond_with_file("/tmp/file.txt", &BTreeMap::new());
    assert!(stream.headers_sent());
    assert_eq!(stream.sent_headers().len(), 2);
    assert_eq!(stream.sent_info_headers().len(), 1);
    stream.send_trailers(&BTreeMap::from([(
        "x-trailer".to_string(),
        "done".to_string(),
    )]));
    assert_eq!(stream.trailers().get("x-trailer").unwrap(), "done");
    assert_eq!(
        stream.sent_trailers().unwrap().get("x-trailer").unwrap(),
        "done"
    );
    stream.set_timeout(25, Some(|| {}));
    assert_eq!(stream.timeout(), Some(25));
    stream.write(b"hello");
    assert_eq!(stream.data(), b"hello");
    assert_eq!(stream.buffer_size(), 5);
    stream.respond_with_options(
        &headers,
        tsonic_node::http2::ServerStreamResponseOptions {
            end_stream: true,
            wait_for_trailers: false,
        },
    );
    assert!(stream.end_after_headers());
    stream.respond_with_file_options(
        "/tmp/file.txt",
        &BTreeMap::new(),
        tsonic_node::http2::ServerStreamFileResponseOptions {
            offset: Some(2),
            length: Some(4),
            wait_for_trailers: true,
        },
    );
    assert!(stream
        .sent_headers()
        .last()
        .unwrap()
        .contains_key("x-tsonic-offset"));
    stream.close_with_code(tsonic_node::http2::NGHTTP2_NO_ERROR);
    assert_eq!(stream.rst_code(), tsonic_node::http2::NGHTTP2_NO_ERROR);
    assert!(stream.closed());
    stream.destroy();
    assert!(stream.destroyed());
    stream.end();

    let request_stream = tsonic_node::http2::Http2Stream::new(BTreeMap::from([
        (
            tsonic_node::http2::HTTP2_HEADER_METHOD.to_string(),
            "POST".to_string(),
        ),
        (
            tsonic_node::http2::HTTP2_HEADER_PATH.to_string(),
            "/submit".to_string(),
        ),
        (
            tsonic_node::http2::HTTP2_HEADER_AUTHORITY.to_string(),
            "example.com".to_string(),
        ),
    ]));
    let mut request = tsonic_node::http2::Http2ServerRequest::new(request_stream.clone());
    assert_eq!(request.method, "POST");
    assert_eq!(request.url, "/submit");
    assert_eq!(request.http_version, "2.0");
    request.push_body(Buffer::from_string("body", Some("utf8")).unwrap());
    assert_eq!(
        request.read(None).unwrap().to_string(Some("utf8")).unwrap(),
        "body"
    );
    request.set_timeout(10, Some(|| {}));
    assert_eq!(request.timeout(), Some(10));

    let mut response = tsonic_node::http2::Http2ServerResponse::new(request_stream);
    response.set_status_code(201);
    response.set_status_message("Created");
    response.set_send_date(false);
    response.set_header("Content-Type", "text/plain");
    response.append_header("Content-Type", "charset=utf8");
    assert!(response.has_header("content-type"));
    assert_eq!(
        response.get_header("CONTENT-TYPE"),
        Some("text/plain, charset=utf8")
    );
    response.write_head(
        201,
        &BTreeMap::from([("x-id".to_string(), "1".to_string())]),
    );
    response.write_continue();
    response.write_early_hints(&BTreeMap::from([("link".to_string(), "</a>".to_string())]));
    assert!(response.write("created"));
    response.add_trailers(&BTreeMap::from([(
        "x-trailer".to_string(),
        "ok".to_string(),
    )]));
    response.set_timeout(20, Some(|| {}));
    response.end(None::<&[u8]>);
    assert_eq!(response.status_code(), 201);
    assert_eq!(response.status_message(), "Created");
    assert!(!response.send_date());
    assert!(response.finished());
    assert_eq!(response.timeout(), Some(20));
    assert_eq!(response.body().len(), 1);
}

#[test]
fn cluster_exposes_closed_primary_worker_model() {
    let settings = tsonic_node::cluster::setup_primary("/bin/echo", &["worker"])
        .with_exec_argv(&["--enable-source-maps"])
        .with_cwd("/")
        .with_serialization("advanced")
        .with_silent(true);
    assert_eq!(settings.exec, "/bin/echo");
    assert_eq!(settings.args, vec!["worker".to_string()]);
    assert_eq!(settings.exec_argv, vec!["--enable-source-maps".to_string()]);
    assert_eq!(settings.cwd, Some("/".to_string()));
    assert_eq!(settings.serialization, Some("advanced".to_string()));
    assert!(settings.silent);
    assert!(tsonic_node::cluster::is_primary());
    assert!(!tsonic_node::cluster::is_worker());
    assert_eq!(
        tsonic_node::cluster::setup_master("/bin/echo", &[]).exec,
        "/bin/echo"
    );

    let env = BTreeMap::new();
    let mut worker = tsonic_node::cluster::fork(&settings, 1, &env).unwrap();
    assert_eq!(worker.id, 1);
    assert!(worker.process_id > 0);
    assert_eq!(worker.state, "online");
    assert!(worker.is_connected());
    assert!(worker.send("ready"));
    worker.disconnect();
    assert!(worker.exited_after_disconnect);
    assert!(!worker.is_connected());
    worker.destroy(Some("SIGTERM"));
    assert!(worker.is_dead());

    let mut manual_worker = tsonic_node::cluster::Worker::new(
        tsonic_node::cluster::WorkerOptions {
            id: Some(7),
            state: Some("listening".to_string()),
        },
        123,
    );
    assert_eq!(manual_worker.id, 7);
    assert_eq!(manual_worker.state, "listening");
    manual_worker.kill(None);
    assert!(manual_worker.is_dead());

    let address = tsonic_node::cluster::Address {
        address: "127.0.0.1".to_string(),
        port: 3000,
        address_type: tsonic_node::cluster::AddressType::Ipv4,
    };
    assert_eq!(address.port, 3000);

    let mut cluster = tsonic_node::cluster::Cluster::new(settings.clone());
    assert_eq!(cluster.settings().exec, "/bin/echo");
    assert_eq!(cluster.scheduling_policy(), tsonic_node::cluster::SCHED_RR);
    cluster.set_scheduling_policy(tsonic_node::cluster::SCHED_NONE);
    assert_eq!(
        cluster.scheduling_policy(),
        tsonic_node::cluster::SCHED_NONE
    );
    assert!(cluster.is_primary());
    assert!(cluster.is_master());
    assert!(!cluster.is_worker());
    cluster.setup_master(tsonic_node::cluster::setup_primary("/bin/echo", &["again"]));
    assert_eq!(cluster.settings().args, vec!["again".to_string()]);
    let forked = cluster.fork(2, &env).unwrap();
    assert_eq!(forked.id, 2);
    assert!(cluster.workers().contains_key(&2));
    let called = std::cell::Cell::new(false);
    cluster.disconnect(Some(|| called.set(true)));
    assert!(called.get());
    assert!(!cluster.workers().get(&2).unwrap().is_connected());
}
