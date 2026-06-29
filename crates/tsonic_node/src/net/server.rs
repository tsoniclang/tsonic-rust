pub struct Server {
    listener: TcpListener,
    refed: bool,
    max_connections: Option<usize>,
    connections: usize,
    listening: bool,
}

impl Server {
    pub fn listen(host: &str, port: u16) -> NodeResult<Self> {
        let listener = TcpListener::bind((host, port)).map_err(map_net_error)?;
        Ok(Self {
            listener,
            refed: true,
            max_connections: None,
            connections: 0,
            listening: true,
        })
    }

    pub fn listen_with_options(options: &ListenOptions) -> NodeResult<Self> {
        Self::listen(&options.host, options.port)
    }

    pub fn address(&self) -> NodeResult<AddressInfo> {
        self.listener
            .local_addr()
            .map(address_info)
            .map_err(map_net_error)
    }

    pub fn local_addr(&self) -> NodeResult<String> {
        self.listener
            .local_addr()
            .map(|addr| addr.to_string())
            .map_err(map_net_error)
    }

    pub fn local_port(&self) -> NodeResult<u16> {
        self.listener
            .local_addr()
            .map(|addr| addr.port())
            .map_err(map_net_error)
    }

    pub fn accept(&mut self) -> NodeResult<Socket> {
        let (stream, _) = self.listener.accept().map_err(map_net_error)?;
        self.connections += 1;
        Ok(Socket::from_stream(stream))
    }

    pub fn close(mut self) {
        self.listening = false;
    }

    pub fn listening(&self) -> bool {
        self.listening
    }

    pub fn max_connections(&self) -> Option<usize> {
        self.max_connections
    }

    pub fn set_max_connections(&mut self, value: Option<usize>) {
        self.max_connections = value;
    }

    pub fn connections(&self) -> usize {
        self.connections
    }

    pub fn get_connections(&self) -> usize {
        self.connections
    }

    pub fn r#ref(&mut self) {
        self.refed = true;
    }

    pub fn unref(&mut self) {
        self.refed = false;
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }
}

pub fn is_ip(value: &str) -> u8 {
    value
        .parse::<std::net::IpAddr>()
        .map(|addr| if addr.is_ipv4() { 4 } else { 6 })
        .unwrap_or(0)
}

pub fn is_ipv4(value: &str) -> bool {
    is_ip(value) == 4
}

pub fn is_ipv6(value: &str) -> bool {
    is_ip(value) == 6
}

pub fn connect(host: &str, port: u16) -> NodeResult<Socket> {
    Socket::connect(host, port)
}

pub fn connect_with_options(options: &ConnectOptions) -> NodeResult<Socket> {
    if options
        .block_list
        .as_ref()
        .is_some_and(|block_list| block_list.check(&options.host).unwrap_or(false))
    {
        return Err(NodeError::new("ERR_BLOCKED_ADDRESS", "address blocked"));
    }
    let mut socket = Socket::connect(&options.host, options.port)?;
    if options.no_delay {
        socket.set_no_delay(true)?;
    }
    if options.keep_alive {
        socket.set_keep_alive(true, options.keep_alive_initial_delay)?;
    }
    if let Some(timeout) = options.timeout {
        socket.set_timeout(timeout)?;
    }
    Ok(socket)
}

pub fn create_connection(host: &str, port: u16) -> NodeResult<Socket> {
    connect(host, port)
}

pub fn create_connection_with_options(options: &ConnectOptions) -> NodeResult<Socket> {
    connect_with_options(options)
}

pub fn create_server(host: &str, port: u16) -> NodeResult<Server> {
    Server::listen(host, port)
}

pub fn create_server_with_options(options: &ListenOptions) -> NodeResult<Server> {
    Server::listen_with_options(options)
}

pub fn lookup_endpoint(host: &str, port: u16) -> NodeResult<Vec<String>> {
    (host, port)
        .to_socket_addrs()
        .map_err(map_net_error)
        .map(|items| items.map(|addr| addr.to_string()).collect())
}

fn address_info(addr: std::net::SocketAddr) -> AddressInfo {
    AddressInfo {
        address: addr.ip().to_string(),
        family: family_string(addr.ip()),
        port: addr.port(),
    }
}

fn socket_address(addr: std::net::SocketAddr) -> SocketAddress {
    SocketAddress {
        address: addr.ip().to_string(),
        family: family_string(addr.ip()),
        port: addr.port(),
        flowlabel: 0,
    }
}

fn family_string(ip: std::net::IpAddr) -> String {
    if ip.is_ipv4() {
        "IPv4".to_string()
    } else {
        "IPv6".to_string()
    }
}

fn parse_ip(value: &str) -> NodeResult<IpAddr> {
    value
        .parse::<IpAddr>()
        .map_err(|error| NodeError::new("EINVAL", error.to_string()))
}

fn ip_to_u128(ip: IpAddr) -> u128 {
    match ip {
        IpAddr::V4(value) => u32::from(value) as u128,
        IpAddr::V6(value) => u128::from(value),
    }
}

fn same_subnet(net: IpAddr, ip: IpAddr, prefix: u8) -> bool {
    match (net, ip) {
        (IpAddr::V4(net), IpAddr::V4(ip)) => {
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            u32::from(net) & mask == u32::from(ip) & mask
        }
        (IpAddr::V6(net), IpAddr::V6(ip)) => {
            let mask = if prefix == 0 {
                0
            } else {
                u128::MAX << (128 - prefix)
            };
            u128::from(net) & mask == u128::from(ip) & mask
        }
        _ => false,
    }
}

fn map_net_error(error: std::io::Error) -> NodeError {
    NodeError::new("ENET", error.to_string())
}
