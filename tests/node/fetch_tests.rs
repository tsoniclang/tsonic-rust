use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use tsonic_js::web::{AbortController, Body, Headers, Request};
use tsonic_js::JsValue;

#[test]
fn fetch_gets_local_http_response_into_web_carriers() {
    let (url, server) = one_shot_http_server(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}",
    );

    let response = tsonic_node::fetch::fetch(&url, None).unwrap();
    server.join().unwrap();

    assert_eq!(response.status(), 200);
    assert!(response.ok());
    assert_eq!(
        response.headers().get("content-type"),
        Some("application/json".to_string())
    );
    assert_eq!(response.text().unwrap(), "{\"ok\":true}");
    assert_eq!(response.json_body().unwrap().inspect(), "{ok: true}");
}

#[test]
fn fetch_posts_request_body_and_headers() {
    let (url, server) = one_shot_http_server("HTTP/1.1 201 Created\r\nContent-Length: 2\r\n\r\nok");
    let mut headers = Headers::new();
    headers.set("x-test", "1");
    let request = Request::with_init(
        url,
        "post",
        headers,
        Body::Text("payload".to_string()),
        None,
    );

    let response = tsonic_node::fetch::fetch_request(&request).unwrap();
    let raw_request = server.join().unwrap();

    assert_eq!(response.status(), 201);
    assert_eq!(response.text().unwrap(), "ok");
    assert!(raw_request.starts_with("POST / HTTP/1.1"));
    assert!(raw_request.contains("x-test: 1"));
    assert!(raw_request.ends_with("payload"));
}

#[test]
fn fetch_rejects_pre_aborted_signal_without_network() {
    let controller = AbortController::new();
    controller.abort(JsValue::String("stop".to_string()));
    let error = tsonic_node::fetch::fetch(
        "http://127.0.0.1:9/",
        Some(tsonic_node::fetch::FetchInit {
            signal: Some(controller.signal()),
            ..Default::default()
        }),
    )
    .unwrap_err();

    assert_eq!(error.code(), "ABORT_ERR");
}

fn one_shot_http_server(response: &'static str) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 4096];
        let count = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..count]).to_string();
        stream.write_all(response.as_bytes()).unwrap();
        request
    });
    (format!("http://{address}/"), handle)
}
