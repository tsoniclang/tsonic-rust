use tsonic_node::dgram;

#[test]
fn dgram_socket_sends_udp_datagrams_over_loopback() {
    let mut receiver = dgram::create_socket().unwrap();
    let mut sender = dgram::create_socket().unwrap();
    let option_bound = dgram::Socket::bind_with_options(&dgram::BindOptions {
        port: Some(0),
        address: Some("127.0.0.1".to_string()),
        exclusive: true,
        fd: None,
    })
    .unwrap();
    assert_eq!(option_bound.address().unwrap().family, "IPv4");
    let socket_options = dgram::SocketOptions {
        type_: "udp4".to_string(),
        reuse_addr: true,
        reuse_port: false,
        ipv6_only: false,
        recv_buffer_size: Some(4096),
        send_buffer_size: Some(8192),
        lookup: true,
        hostname: Some("localhost".to_string()),
        options: true,
        callback: true,
        receive_block_list: true,
        send_block_list: true,
    };
    assert_eq!(socket_options.type_, "udp4");
    assert!(socket_options.reuse_addr);
    assert_eq!(socket_options.recv_buffer_size, Some(4096));
    assert_eq!(socket_options.send_buffer_size, Some(8192));
    assert_eq!(socket_options.hostname.as_deref(), Some("localhost"));
    assert!(socket_options.lookup);
    assert!(socket_options.options);
    assert!(socket_options.callback);
    assert!(socket_options.receive_block_list);
    assert!(socket_options.send_block_list);
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
    sender.set_multicast_interface("127.0.0.1");
    assert_eq!(sender.multicast_interface(), Some("127.0.0.1"));
    assert!(!sender.set_multicast_loopback(false));
    assert!(!sender.multicast_loopback());

    assert_eq!(sender.send_to(b"ping", "127.0.0.1", port).unwrap(), 4);

    let mut buffer = [0_u8; 16];
    let (len, remote) = receiver.recv_remote_info(&mut buffer).unwrap();
    assert_eq!(&buffer[..len], b"ping");
    assert_eq!(remote.size, 4);
    assert_eq!(remote.family, "IPv4");
    assert_eq!(remote.port, sender.local_port().unwrap());

    sender.connect("127.0.0.1", port).unwrap();
    assert_eq!(sender.remote_address().unwrap().port, port);
    assert_eq!(sender.send(b"pong").unwrap(), 4);
    let (len, _) = receiver.recv_from(&mut buffer).unwrap();
    assert_eq!(&buffer[..len], b"pong");
    let send_options = dgram::SendOptions {
        msg: b"xxtrimmedxx".to_vec(),
        offset: 2,
        length: 7,
        port: Some(port),
        callback: true,
    };
    assert_eq!(send_options.payload(), b"trimmed");
    assert!(send_options.callback);
    assert_eq!(
        sender
            .send_with_options(&send_options, "127.0.0.1")
            .unwrap(),
        7
    );
    let (len, remote) = receiver.recv_remote_info(&mut buffer).unwrap();
    assert_eq!(&buffer[..len], b"trimmed");
    assert_eq!(remote.address, "127.0.0.1");
    sender.add_membership("224.0.0.251", None);
    sender.drop_membership("224.0.0.251", None);
    sender.add_source_specific_membership("127.0.0.1", "224.0.0.251", Some("lo"));
    assert_eq!(sender.source_memberships().len(), 1);
    sender.drop_source_specific_membership("127.0.0.1", "224.0.0.251", Some("lo"));
    assert!(sender.source_memberships().is_empty());
    sender.close();
    assert!(sender.closed());
}
