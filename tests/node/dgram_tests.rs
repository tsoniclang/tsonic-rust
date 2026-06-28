use tsonic_node::dgram;

#[test]
fn dgram_socket_sends_udp_datagrams_over_loopback() {
    let receiver = dgram::create_socket().unwrap();
    let sender = dgram::create_socket().unwrap();
    let port = receiver.local_port().unwrap();
    assert_eq!(sender.send_to(b"ping", "127.0.0.1", port).unwrap(), 4);

    let mut buffer = [0_u8; 16];
    let (len, address) = receiver.recv_from(&mut buffer).unwrap();
    assert_eq!(&buffer[..len], b"ping");
    assert!(address.contains("127.0.0.1"));
}
