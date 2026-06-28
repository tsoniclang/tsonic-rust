use tsonic_node::dgram;

#[test]
fn dgram_socket_sends_udp_datagrams_over_loopback() {
    let mut receiver = dgram::create_socket().unwrap();
    let mut sender = dgram::create_socket().unwrap();
    let port = receiver.local_port().unwrap();
    let address = receiver.address().unwrap();
    assert_eq!(address.family, "IPv4");
    assert_eq!(address.port, port);
    assert!(receiver.has_ref());
    receiver.unref();
    assert!(!receiver.has_ref());
    receiver.r#ref();
    assert!(receiver.has_ref());

    sender.set_recv_buffer_size(4096);
    sender.set_send_buffer_size(8192);
    assert_eq!(sender.get_recv_buffer_size(), 4096);
    assert_eq!(sender.get_send_buffer_size(), 8192);
    sender.set_broadcast(false).unwrap();
    assert!(!sender.broadcast());
    assert_eq!(sender.set_ttl(32).unwrap(), 32);
    assert_eq!(sender.ttl(), 32);
    assert_eq!(sender.get_send_queue_size(), 0);
    assert_eq!(sender.get_send_queue_count(), 0);

    assert_eq!(sender.send_to(b"ping", "127.0.0.1", port).unwrap(), 4);

    let mut buffer = [0_u8; 16];
    let (len, address) = receiver.recv_from(&mut buffer).unwrap();
    assert_eq!(&buffer[..len], b"ping");
    assert!(address.contains("127.0.0.1"));

    sender.connect("127.0.0.1", port).unwrap();
    assert_eq!(sender.remote_address().unwrap().port, port);
    assert_eq!(sender.send(b"pong").unwrap(), 4);
    let (len, _) = receiver.recv_from(&mut buffer).unwrap();
    assert_eq!(&buffer[..len], b"pong");
    sender.add_membership("224.0.0.251", None);
    sender.drop_membership("224.0.0.251", None);
    sender.close();
    assert!(sender.closed());
}
