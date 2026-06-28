use std::collections::BTreeMap;
use std::path::Path;
use std::thread;

use tsonic_node::{child_process, http, module, net};

#[test]
fn net_socket_and_http_client_use_real_local_tcp() {
    let server = net::create_server("127.0.0.1", 0).unwrap();
    assert!(server.address().unwrap().port > 0);
    let port = server.local_port().unwrap();
    let handle = thread::spawn(move || {
        let mut server = server;
        let mut socket = server.accept().unwrap();
        assert_eq!(socket.remote_family().unwrap(), "IPv4");
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
            .unwrap();
        assert!(socket.bytes_written() > 0);
        socket.shutdown().unwrap();
    });

    let response = http::get("127.0.0.1", port, "/").unwrap();
    assert_eq!(response.status_code, 200);
    assert_eq!(response.text().unwrap(), "ok");
    handle.join().unwrap();

    assert_eq!(net::is_ip("127.0.0.1"), 4);
    assert!(net::is_ipv4("127.0.0.1"));
    assert!(net::is_ipv6("::1"));

    let server = net::create_server("127.0.0.1", 0).unwrap();
    let port = server.local_port().unwrap();
    let handle = thread::spawn(move || {
        let mut server = server;
        let mut socket = server.accept().unwrap();
        let data = socket.read_to_end().unwrap();
        assert_eq!(data, b"ping");
        assert_eq!(socket.bytes_read(), 4);
    });
    let mut socket = net::connect("127.0.0.1", port).unwrap();
    assert_eq!(socket.remote_family().unwrap(), "IPv4");
    assert_eq!(socket.remote_port().unwrap(), port);
    assert!(socket.local_port().unwrap() > 0);
    assert_eq!(socket.address().unwrap().family, "IPv4");
    socket.set_no_delay(true).unwrap();
    socket.set_timeout(1_000).unwrap();
    assert_eq!(socket.timeout(), Some(1_000));
    socket.set_encoding("utf8");
    assert_eq!(socket.encoding(), Some("utf8"));
    assert!(socket.write(b"ping").unwrap());
    assert_eq!(socket.bytes_written(), 4);
    assert!(socket.has_ref());
    socket.unref();
    assert!(!socket.has_ref());
    socket.r#ref();
    assert!(socket.has_ref());
    socket.end(None).unwrap();
    handle.join().unwrap();
}

#[test]
fn net_option_and_policy_shapes_are_closed_and_fact_backed() {
    let mut block_list = net::BlockList::new();
    block_list.add_address("192.0.2.10").unwrap();
    block_list.add_range("192.0.2.20", "192.0.2.30").unwrap();
    block_list.add_subnet("2001:db8::", 32).unwrap();
    assert!(block_list.check("192.0.2.10").unwrap());
    assert!(block_list.check("192.0.2.25").unwrap());
    assert!(block_list.check("2001:db8::1").unwrap());
    assert!(!block_list.check("198.51.100.1").unwrap());
    let restored = net::BlockList::from_json(&block_list.rules()).unwrap();
    assert_eq!(restored.rules(), block_list.rules());

    let socket_address = net::SocketAddress::parse("127.0.0.1:80").unwrap();
    assert_eq!(socket_address.address, "127.0.0.1");
    assert_eq!(socket_address.family, "IPv4");
    assert_eq!(socket_address.port, 80);
    assert_eq!(net::SocketAddress::new("::1", 443).unwrap().family, "IPv6");

    let mut server = net::create_server_with_options(&net::ListenOptions {
        host: "127.0.0.1".to_string(),
        port: 0,
        backlog: Some(8),
        ipv6_only: false,
        exclusive: true,
        readable_all: false,
        writable_all: false,
    })
    .unwrap();
    assert!(server.listening());
    assert_eq!(server.connections(), 0);
    server.set_max_connections(Some(16));
    assert_eq!(server.max_connections(), Some(16));
    let port = server.local_port().unwrap();
    let handle = thread::spawn(move || {
        let mut socket = server.accept().unwrap();
        assert_eq!(server.get_connections(), 1);
        socket.write(b"ok").unwrap();
        socket.end(None).unwrap();
    });

    let mut block_list = net::BlockList::new();
    block_list.add_address("203.0.113.1").unwrap();
    let mut socket = net::connect_with_options(&net::ConnectOptions {
        host: "127.0.0.1".to_string(),
        port,
        local_address: None,
        local_port: None,
        family: Some(4),
        no_delay: true,
        keep_alive: true,
        keep_alive_initial_delay: Some(250),
        timeout: Some(1_000),
        block_list: Some(block_list),
    })
    .unwrap();
    assert!(socket.keep_alive());
    assert_eq!(socket.keep_alive_initial_delay(), Some(250));
    socket.set_type_of_service(16).unwrap();
    assert_eq!(socket.type_of_service(), Some(16));
    assert_eq!(socket.ready_state(), "open");
    socket.pause();
    assert!(socket.is_paused());
    assert_eq!(socket.ready_state(), "readOnly");
    socket.resume();
    assert!(!socket.is_paused());
    let data = socket.read_to_end().unwrap();
    assert_eq!(data, b"ok");
    socket.reset_and_destroy().unwrap();
    assert!(socket.destroyed());
    assert_eq!(socket.ready_state(), "closed");
    handle.join().unwrap();

    let blocked = net::connect_with_options(&net::ConnectOptions {
        host: "192.0.2.10".to_string(),
        port: 1,
        local_address: None,
        local_port: None,
        family: Some(4),
        no_delay: false,
        keep_alive: false,
        keep_alive_initial_delay: None,
        timeout: None,
        block_list: Some(restored),
    });
    assert!(blocked.is_err());

    let socket = net::Socket::new_with_options(net::SocketConstructorOpts {
        allow_half_open: true,
        ..net::SocketConstructorOpts::default()
    })
    .unwrap();
    assert!(socket.allow_half_open());
    assert!(net::Socket::new_with_options(net::SocketConstructorOpts {
        fd: Some(1),
        ..net::SocketConstructorOpts::default()
    })
    .is_err());
}

#[test]
fn http_server_shapes_handle_in_memory_requests_without_dynamic_runtime() {
    assert!(http::methods().contains(&"GET"));
    assert_eq!(http::status_codes().get(&201), Some(&"Created"));
    assert_eq!(http::MAX_HEADER_SIZE, 16 * 1024);
    http::validate_header_name("x-token").unwrap();
    http::validate_header_value("x-token", "ok").unwrap();
    assert!(http::validate_header_name("bad header").is_err());
    assert!(http::validate_header_value("x-token", "bad\nvalue").is_err());

    let server = http::create_server(|request, response| {
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "/submit");
        assert_eq!(request.http_version, "1.1");
        assert!(request.complete);
        assert_eq!(
            request.get_header("content-type"),
            Some("text/plain".to_string())
        );
        assert_eq!(
            request.headers_distinct().get("content-type").unwrap(),
            &vec!["text/plain".to_string()]
        );
        response.set_header("content-type", "text/plain");
        response.append_header("vary", "accept");
        response.append_header("vary", "encoding");
        assert_eq!(response.get_header("vary").unwrap(), "accept, encoding");
        assert!(response.has_header("content-type"));
        let mut extra = BTreeMap::new();
        extra.insert("x-extra".to_string(), "1".to_string());
        response.set_headers(&extra);
        assert!(response.get_header_names().contains(&"x-extra".to_string()));
        let mut hints = BTreeMap::new();
        hints.insert("link".to_string(), "</style.css>; rel=preload".to_string());
        let hinted = std::cell::Cell::new(false);
        response.write_early_hints(&hints, Some(|| hinted.set(true)));
        assert!(hinted.get());
        response.write_head(201, &[("x-powered-by", "tsonic")]);
        response.flush_headers();
        assert!(response.headers_sent);
        let mut trailers = BTreeMap::new();
        trailers.insert("x-trailer".to_string(), "done".to_string());
        response.add_trailers(&trailers);
        let timed = std::cell::Cell::new(false);
        response.set_timeout(500, Some(|| timed.set(true)));
        assert_eq!(response.timeout(), Some(500));
        assert!(timed.get());
        response.write_continue(Some(|| {}));
        response.write_processing(Some(|| {}));
        response.end(Some(
            tsonic_node::buffer::Buffer::from_string("created", Some("utf8")).unwrap(),
        ));
        assert!(response.finished());
    });

    let mut request = http::IncomingMessage::new("POST", "/submit", b"payload".to_vec());
    request.set_header("content-type", "text/plain");
    assert_eq!(request.raw_headers, vec!["content-type", "text/plain"]);
    let incoming_timed = std::cell::Cell::new(false);
    request.set_timeout(250, Some(|| incoming_timed.set(true)));
    assert_eq!(request.timeout(), Some(250));
    assert!(incoming_timed.get());
    let response = server.handle(request);
    assert_eq!(response.status_code, 201);
    assert_eq!(response.status_message, "Created");
    assert_eq!(response.headers.get("content-type").unwrap(), "text/plain");
    assert_eq!(response.headers.get("x-powered-by").unwrap(), "tsonic");
    assert_eq!(
        response.headers.get("link").unwrap(),
        "</style.css>; rel=preload"
    );
    assert_eq!(response.text().unwrap(), "created");
    server.close();

    let mut destroyed = http::IncomingMessage::new("GET", "/aborted", Vec::new());
    destroyed.destroy();
    assert!(destroyed.destroyed());
    assert!(destroyed.aborted);
    assert!(!destroyed.complete);
}

#[test]
fn http_agent_and_client_request_expose_common_state() {
    let agent = http::Agent::new(Some(http::AgentOptions {
        keep_alive: true,
        keep_alive_msecs: 250,
        max_sockets: 16,
        max_free_sockets: 4,
        max_total_sockets: 32,
        timeout: Some(1_000),
        scheduling: "fifo".to_string(),
    }));
    let mut options = http::RequestOptions::get("example.test", 80, "/");
    options.agent = Some(agent.clone());
    options.auth = Some("u:p".to_string());
    assert_eq!(agent.get_name(Some(&options)), "example.test:80:GET");
    assert!(agent.keep_socket_alive());
    assert!(agent.reuse_socket());
    let mut agent_to_destroy = agent.clone();
    agent_to_destroy.destroy();
    assert!(agent_to_destroy.destroyed());
    assert!(!agent_to_destroy.reuse_socket());

    let mut request = http::ClientRequest::new(options);
    assert_eq!(request.method, "GET");
    assert_eq!(request.host, "example.test");
    request.set_timeout(2_000, Some(|| {}));
    assert_eq!(request.timeout(), Some(2_000));
    request.set_no_delay(true);
    assert!(request.no_delay());
    request.set_socket_keep_alive(true, Some(123));
    assert_eq!(request.keep_alive_delay(), Some(123));
    request.on_socket();
    assert!(request.reused_socket);
    request.abort();
    assert!(request.aborted);
    request.set_header("x-client", "1");
    assert_eq!(request.get_header("x-client"), Some("1".to_string()));
    request.remove_header("x-client");
    assert_eq!(request.get_header("x-client"), None);
    assert!(request.get_headers().is_empty());
}

#[test]
fn module_safe_helpers_do_not_execute_loaders() {
    let builtins = module::builtin_modules();
    assert!(builtins.contains(&"fs"));
    assert!(builtins.contains(&"http"));
    let require = module::create_require("/workspace/app");
    assert_eq!(require.base(), "/workspace/app");
    assert_eq!(require.resolve("./local.js"), "/workspace/app/./local.js");
    assert_eq!(require.resolve("node:fs"), "node:fs");
}

#[test]
fn child_process_file_spawn_is_explicit_and_shell_free() {
    let current = std::env::current_exe().unwrap();
    let current = current.to_string_lossy().to_string();
    let output = child_process::spawn_file_sync(&current, &["--list"]).unwrap();
    assert!(output.success());
    assert_eq!(output.status, 0);
    assert_eq!(output.error, None);
    assert_eq!(output.stderr_string().unwrap(), "");
    assert!(output
        .stdout_string()
        .unwrap()
        .contains("network_process_tests"));
    let output = child_process::spawn_sync(&current, &["--list"]).unwrap();
    assert!(output.success());
    assert_eq!(output.output()[0], None);
    assert!(!output.to_spawn_sync_returns().stdout.is_empty());
    assert!(child_process::exec_file_sync_string(&current, &["--list"])
        .unwrap()
        .contains("network_process_tests"));
    assert!(
        String::from_utf8(child_process::exec_sync(&current, &["--list"]).unwrap())
            .unwrap()
            .contains("network_process_tests")
    );

    let mut child = child_process::spawn_file(&current, &["--list"]).unwrap();
    assert!(child.pid.unwrap() > 0);
    assert_eq!(child.spawnfile, current);
    assert_eq!(child.spawnargs, vec!["--list"]);
    assert_eq!(
        child.stdio,
        vec![
            child_process::Stdio::Pipe,
            child_process::Stdio::Pipe,
            child_process::Stdio::Pipe
        ]
    );
    assert_eq!(child.channel, Some("ipc".to_string()));
    assert!(child.stdin);
    assert!(child.connected);
    assert!(child.has_ref());
    child.unref_process();
    assert!(!child.has_ref());
    child.ref_process();
    assert!(child.has_ref());
    assert!(child.send("ready").unwrap());
    assert!(!child
        .send_with_options(
            "ready",
            &child_process::MessagingOptions {
                keep_open: true,
                kill_signal: Some("SIGTERM".to_string()),
            },
        )
        .unwrap());
    child.disconnect();
    assert_eq!(child.channel, None);
    assert!(child.send("ready").is_err());

    let output = child.wait().unwrap();
    assert!(output.success());
    assert_eq!(child.exit_code, Some(0));
    assert!(child
        .stdout
        .as_ref()
        .unwrap()
        .windows("network_process_tests".len())
        .any(|window| window == b"network_process_tests"));
    assert!(child_process::exec_file(&current, &["--list"])
        .unwrap()
        .stdout_string()
        .unwrap()
        .contains("network_process_tests"));
    let promisified = child_process::exec_file_promisify(
        &current,
        &["--list"],
        &child_process::SpawnOptions::default()
            .with_stdio(child_process::StdioOptions::tuple(
                child_process::Stdio::Pipe,
                child_process::Stdio::Pipe,
                child_process::Stdio::Pipe,
            ))
            .with_encoding(child_process::OutputEncoding::Utf8),
    )
    .unwrap();
    assert!(promisified.value.success());
    assert_eq!(promisified.child.spawnfile, current);
    let forked = child_process::fork_file(
        &promisified.child.spawnfile,
        &["--list"],
        &Default::default(),
    )
    .unwrap();
    assert!(forked.pid.unwrap() > 0);

    let shell_reject = child_process::spawn_file_sync_with_options(
        &current,
        &["--list"],
        &child_process::SpawnOptions {
            shell: true,
            ..child_process::SpawnOptions::default()
        },
    );
    assert!(shell_reject.is_err());
    assert!(child_process::exec_command_sync("echo forbidden").is_err());
    assert!(child_process::spawn_shell_sync("echo forbidden").is_err());
    assert!(child_process::spawn_file_sync_with_options(
        &current,
        &["--list"],
        &child_process::SpawnOptions::default().with_abort_signal(true),
    )
    .is_err());
    assert!(child_process::spawn_file_sync_with_options(
        &current,
        &["--list"],
        &child_process::SpawnOptions::default().with_max_buffer(1),
    )
    .is_err());
    let ignored = child_process::spawn_file_sync_with_options(
        &current,
        &["--list"],
        &child_process::SpawnOptions::default().with_stdio(child_process::StdioOptions {
            stdin: child_process::Stdio::Ignore,
            stdout: child_process::Stdio::Ignore,
            stderr: child_process::Stdio::Ignore,
        }),
    )
    .unwrap();
    assert!(ignored.success());
    assert_eq!(ignored.stdout, Vec::<u8>::new());

    if Path::new("/bin/cat").exists() {
        let output = child_process::spawn_file_sync_with_options(
            "/bin/cat",
            &[],
            &child_process::SpawnOptions::default()
                .with_input(b"stdin payload".to_vec())
                .with_timeout_ms(1_000)
                .with_kill_signal("SIGTERM")
                .with_argv0("cat")
                .with_env("TSONIC_CHILD_TEST", "1"),
        )
        .unwrap();
        assert_eq!(output.stdout, b"stdin payload".to_vec());
        assert!(output.success());
        let exception = child_process::exec_exception("cat", &output);
        assert_eq!(exception.cmd, "cat");
        assert_eq!(exception.code, Some(0));
    }
}
