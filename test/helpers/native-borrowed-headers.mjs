export const nativeBorrowedHeaderReadTest = `
#[test]
fn generated_nested_views_read_present_native_headers() {
    use std::cell::{Cell, RefCell};
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::rc::Rc;
    use std::time::Duration;
    use tsonic_rust_node::{http, run_event_loop};
    use tsonic_rust_runtime::{Callable, TsonicError};

    let observed = Rc::new(Cell::new(false));
    let server_slot = Rc::new(RefCell::new(None::<http::ServerHandle<TsonicError>>));
    let callback_slot = server_slot.clone();
    let callback_observed = observed.clone();
    let server = http::with_default_http(|roots| http::create_server_callable(roots, Callable::new(
        move |(request, response): (http::IncomingMessage<TsonicError>, http::ServerResponse<TsonicError>)| {
            let headers = request.headers_distinct();
            let inline = index::firstFromHeaderHolder(headers.clone(), "x-item".to_owned())?;
            let guarded = index::guardedFirstFromHeaderHolder(headers, "x-item".to_owned())?;
            assert_eq!(inline.as_deref(), Some("live"));
            assert_eq!(guarded.as_deref(), Some("live"));
            callback_observed.set(true);
            response.end_empty()?;
            let selected_server = callback_slot.borrow_mut().take().unwrap();
            selected_server.close()?;
            Ok::<(), TsonicError>(())
        },
    ))).unwrap();
    *server_slot.borrow_mut() = Some(server.clone());
    server.listen_default_host(0, Callable::new(|()| Ok::<(), TsonicError>(()))).unwrap();
    let port = server.local_port().unwrap();
    let client = std::thread::spawn(move || {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        stream.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
        stream.write_all(b"GET / HTTP/1.1\\r\\nHost: localhost\\r\\nX-Item: live\\r\\n\\r\\n").unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        assert!(response.starts_with(b"HTTP/1.1 200"));
    });
    run_event_loop().unwrap();
    client.join().unwrap();
    assert!(observed.get());
}
`;
