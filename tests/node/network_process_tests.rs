use std::thread;

use tsonic_node::{child_process, http, module, net};

#[test]
fn net_socket_and_http_client_use_real_local_tcp() {
    let server = net::create_server("127.0.0.1", 0).unwrap();
    assert!(server.address().unwrap().port > 0);
    let port = server.local_port().unwrap();
    let handle = thread::spawn(move || {
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
fn http_server_shapes_handle_in_memory_requests_without_dynamic_runtime() {
    let server = http::create_server(|request, response| {
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "/submit");
        response.set_header("content-type", "text/plain");
        response.write_head(201, &[("x-powered-by", "tsonic")]);
        response.end(Some(
            tsonic_node::buffer::Buffer::from_string("created", Some("utf8")).unwrap(),
        ));
    });

    let mut request = http::IncomingMessage::new("POST", "/submit", b"payload".to_vec());
    request.set_header("content-type", "text/plain");
    let response = server.handle(request);
    assert_eq!(response.status_code, 201);
    assert_eq!(response.status_message, "Created");
    assert_eq!(response.headers.get("content-type").unwrap(), "text/plain");
    assert_eq!(response.headers.get("x-powered-by").unwrap(), "tsonic");
    assert_eq!(response.text().unwrap(), "created");
    server.close();
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
    assert_eq!(output.stderr_string().unwrap(), "");
    assert!(output
        .stdout_string()
        .unwrap()
        .contains("network_process_tests"));
    let output = child_process::spawn_sync(&current, &["--list"]).unwrap();
    assert!(output.success());
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
    assert!(child.stdin);
    assert!(child.connected);
    assert!(child.has_ref());
    child.unref_process();
    assert!(!child.has_ref());
    child.ref_process();
    assert!(child.has_ref());
    assert!(child.send("ready").unwrap());
    child.disconnect();
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
}
