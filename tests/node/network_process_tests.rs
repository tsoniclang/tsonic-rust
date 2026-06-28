use std::thread;

use tsonic_node::{child_process, http, module, net};

#[test]
fn net_socket_and_http_client_use_real_local_tcp() {
    let server = net::create_server("127.0.0.1", 0).unwrap();
    let port = server.local_port().unwrap();
    let handle = thread::spawn(move || {
        let mut socket = server.accept().unwrap();
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
            .unwrap();
        socket.shutdown().unwrap();
    });

    let response = http::get("127.0.0.1", port, "/").unwrap();
    assert_eq!(response.status_code, 200);
    assert_eq!(response.text().unwrap(), "ok");
    handle.join().unwrap();

    assert_eq!(net::is_ip("127.0.0.1"), 4);
    assert!(net::is_ipv4("127.0.0.1"));
    assert!(net::is_ipv6("::1"));
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
    assert_eq!(output.status, 0);
    assert!(output
        .stdout_string()
        .unwrap()
        .contains("network_process_tests"));
}
