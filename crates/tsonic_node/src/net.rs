use std::io::{Read, Write};
use std::net::{IpAddr, Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressInfo {
    pub address: String,
    pub family: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketAddress {
    pub address: String,
    pub family: String,
    pub port: u16,
    pub flowlabel: u32,
}

impl SocketAddress {
    pub fn new(address: &str, port: u16) -> NodeResult<Self> {
        let ip = address
            .parse::<IpAddr>()
            .map_err(|error| NodeError::new("EINVAL", error.to_string()))?;
        Ok(Self {
            address: ip.to_string(),
            family: family_string(ip),
            port,
            flowlabel: 0,
        })
    }

    pub fn parse(input: &str) -> NodeResult<Self> {
        let addr = input
            .parse::<std::net::SocketAddr>()
            .map_err(|error| NodeError::new("EINVAL", error.to_string()))?;
        Ok(socket_address(addr))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketConstructorOpts {
    pub allow_half_open: bool,
    pub fd: Option<i32>,
    pub readable: bool,
    pub writable: bool,
}

impl Default for SocketConstructorOpts {
    fn default() -> Self {
        Self {
            allow_half_open: false,
            fd: None,
            readable: true,
            writable: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectOptions {
    pub host: String,
    pub port: u16,
    pub local_address: Option<String>,
    pub local_port: Option<u16>,
    pub family: Option<u8>,
    pub no_delay: bool,
    pub keep_alive: bool,
    pub keep_alive_initial_delay: Option<u64>,
    pub timeout: Option<u64>,
    pub block_list: Option<BlockList>,
}

impl ConnectOptions {
    pub fn new(host: &str, port: u16) -> Self {
        Self {
            host: host.to_string(),
            port,
            local_address: None,
            local_port: None,
            family: None,
            no_delay: false,
            keep_alive: false,
            keep_alive_initial_delay: None,
            timeout: None,
            block_list: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenOptions {
    pub host: String,
    pub port: u16,
    pub backlog: Option<i32>,
    pub ipv6_only: bool,
    pub exclusive: bool,
    pub readable_all: bool,
    pub writable_all: bool,
}

impl ListenOptions {
    pub fn new(host: &str, port: u16) -> Self {
        Self {
            host: host.to_string(),
            port,
            backlog: None,
            ipv6_only: false,
            exclusive: false,
            readable_all: false,
            writable_all: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum BlockRule {
    Address(IpAddr),
    Range(IpAddr, IpAddr),
    Subnet(IpAddr, u8),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlockList {
    rules: Vec<BlockRule>,
}

impl BlockList {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_address(&mut self, address: &str) -> NodeResult<()> {
        self.rules.push(BlockRule::Address(parse_ip(address)?));
        Ok(())
    }

    pub fn add_range(&mut self, start: &str, end: &str) -> NodeResult<()> {
        self.rules
            .push(BlockRule::Range(parse_ip(start)?, parse_ip(end)?));
        Ok(())
    }

    pub fn add_subnet(&mut self, net: &str, prefix: u8) -> NodeResult<()> {
        let ip = parse_ip(net)?;
        let max = if ip.is_ipv4() { 32 } else { 128 };
        if prefix > max {
            return Err(NodeError::new("EINVAL", "invalid subnet prefix"));
        }
        self.rules.push(BlockRule::Subnet(ip, prefix));
        Ok(())
    }

    pub fn check(&self, address: &str) -> NodeResult<bool> {
        let ip = parse_ip(address)?;
        Ok(self.rules.iter().any(|rule| rule.matches(ip)))
    }

    pub fn rules(&self) -> Vec<String> {
        self.rules.iter().map(BlockRule::to_rule_string).collect()
    }

    pub fn from_json(rules: &[String]) -> NodeResult<Self> {
        let mut block_list = Self::new();
        for rule in rules {
            if let Some(value) = rule.strip_prefix("Address: ") {
                block_list.add_address(value)?;
            } else if let Some(value) = rule.strip_prefix("Range: ") {
                let Some((start, end)) = value.split_once('-') else {
                    return Err(NodeError::new("EINVAL", "invalid range rule"));
                };
                block_list.add_range(start, end)?;
            } else if let Some(value) = rule.strip_prefix("Subnet: ") {
                let Some((net, prefix)) = value.split_once('/') else {
                    return Err(NodeError::new("EINVAL", "invalid subnet rule"));
                };
                let prefix = prefix
                    .parse::<u8>()
                    .map_err(|error| NodeError::new("EINVAL", error.to_string()))?;
                block_list.add_subnet(net, prefix)?;
            } else {
                return Err(NodeError::new("EINVAL", "invalid blocklist rule"));
            }
        }
        Ok(block_list)
    }
}

impl BlockRule {
    fn matches(&self, ip: IpAddr) -> bool {
        match self {
            Self::Address(address) => *address == ip,
            Self::Range(start, end) => {
                ip_to_u128(*start) <= ip_to_u128(ip) && ip_to_u128(ip) <= ip_to_u128(*end)
            }
            Self::Subnet(net, prefix) => same_subnet(*net, ip, *prefix),
        }
    }

    fn to_rule_string(&self) -> String {
        match self {
            Self::Address(address) => format!("Address: {address}"),
            Self::Range(start, end) => format!("Range: {start}-{end}"),
            Self::Subnet(net, prefix) => format!("Subnet: {net}/{prefix}"),
        }
    }
}

pub struct Socket {
    stream: Option<TcpStream>,
    bytes_read: u64,
    bytes_written: u64,
    timeout: Option<u64>,
    encoding: Option<String>,
    refed: bool,
    destroyed: bool,
    paused: bool,
    allow_half_open: bool,
    keep_alive: bool,
    keep_alive_initial_delay: Option<u64>,
    type_of_service: Option<u32>,
}

impl Socket {
    pub fn connect(host: &str, port: u16) -> NodeResult<Self> {
        let stream = TcpStream::connect((host, port)).map_err(map_net_error)?;
        Ok(Self::from_stream(stream))
    }

    pub fn from_stream(stream: TcpStream) -> Self {
        Self {
            stream: Some(stream),
            bytes_read: 0,
            bytes_written: 0,
            timeout: None,
            encoding: None,
            refed: true,
            destroyed: false,
            paused: false,
            allow_half_open: false,
            keep_alive: false,
            keep_alive_initial_delay: None,
            type_of_service: None,
        }
    }

    pub fn new_with_options(options: SocketConstructorOpts) -> NodeResult<Self> {
        if options.fd.is_some() {
            return Err(NodeError::new(
                "ERR_UNSUPPORTED_FD_SOCKET",
                "fd-backed socket construction is not supported by the closed Rust runtime",
            ));
        }
        Ok(Self {
            stream: None,
            bytes_read: 0,
            bytes_written: 0,
            timeout: None,
            encoding: None,
            refed: true,
            destroyed: false,
            paused: false,
            allow_half_open: options.allow_half_open,
            keep_alive: false,
            keep_alive_initial_delay: None,
            type_of_service: None,
        })
    }

    pub fn write_all(&mut self, data: &[u8]) -> NodeResult<()> {
        self.stream_mut()?.write_all(data).map_err(map_net_error)?;
        self.bytes_written += data.len() as u64;
        Ok(())
    }

    pub fn write(&mut self, data: &[u8]) -> NodeResult<bool> {
        self.write_all(data)?;
        Ok(true)
    }

    pub fn read_to_end(&mut self) -> NodeResult<Vec<u8>> {
        let mut data = Vec::new();
        self.stream_mut()?
            .read_to_end(&mut data)
            .map_err(map_net_error)?;
        self.bytes_read += data.len() as u64;
        Ok(data)
    }

    pub fn end(&mut self, data: Option<&[u8]>) -> NodeResult<()> {
        if let Some(data) = data {
            self.write_all(data)?;
        }
        self.stream()?
            .shutdown(Shutdown::Write)
            .map_err(map_net_error)
    }

    pub fn shutdown(&self) -> NodeResult<()> {
        self.stream()?
            .shutdown(Shutdown::Both)
            .map_err(map_net_error)
    }

    pub fn destroy(&mut self) -> NodeResult<()> {
        self.destroyed = true;
        self.shutdown()
    }

    pub fn destroy_soon(&mut self) -> NodeResult<()> {
        self.destroy()
    }

    pub fn reset_and_destroy(&mut self) -> NodeResult<()> {
        self.destroy()
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn address(&self) -> NodeResult<AddressInfo> {
        self.stream()?
            .local_addr()
            .map(address_info)
            .map_err(map_net_error)
    }

    pub fn local_address(&self) -> NodeResult<String> {
        self.stream()?
            .local_addr()
            .map(|addr| addr.ip().to_string())
            .map_err(map_net_error)
    }

    pub fn local_port(&self) -> NodeResult<u16> {
        self.stream()?
            .local_addr()
            .map(|addr| addr.port())
            .map_err(map_net_error)
    }

    pub fn local_family(&self) -> NodeResult<String> {
        self.stream()?
            .local_addr()
            .map(|addr| family_string(addr.ip()))
            .map_err(map_net_error)
    }

    pub fn remote_address(&self) -> NodeResult<String> {
        self.stream()?
            .peer_addr()
            .map(|addr| addr.ip().to_string())
            .map_err(map_net_error)
    }

    pub fn remote_port(&self) -> NodeResult<u16> {
        self.stream()?
            .peer_addr()
            .map(|addr| addr.port())
            .map_err(map_net_error)
    }

    pub fn remote_family(&self) -> NodeResult<String> {
        self.stream()?
            .peer_addr()
            .map(|addr| family_string(addr.ip()))
            .map_err(map_net_error)
    }

    pub fn bytes_read(&self) -> u64 {
        self.bytes_read
    }

    pub fn bytes_written(&self) -> u64 {
        self.bytes_written
    }

    pub fn buffer_size(&self) -> usize {
        0
    }

    pub fn pending(&self) -> bool {
        self.stream.is_none() && !self.destroyed
    }

    pub fn connecting(&self) -> bool {
        false
    }

    pub fn ready_state(&self) -> &'static str {
        if self.destroyed {
            "closed"
        } else if self.paused {
            "readOnly"
        } else {
            "open"
        }
    }

    pub fn set_no_delay(&self, no_delay: bool) -> NodeResult<()> {
        self.stream()?.set_nodelay(no_delay).map_err(map_net_error)
    }

    pub fn set_keep_alive(
        &mut self,
        keep_alive: bool,
        initial_delay_millis: Option<u64>,
    ) -> NodeResult<()> {
        self.keep_alive = keep_alive;
        self.keep_alive_initial_delay = initial_delay_millis;
        Ok(())
    }

    pub fn keep_alive(&self) -> bool {
        self.keep_alive
    }

    pub fn keep_alive_initial_delay(&self) -> Option<u64> {
        self.keep_alive_initial_delay
    }

    pub fn set_type_of_service(&mut self, value: u32) -> NodeResult<()> {
        self.type_of_service = Some(value);
        Ok(())
    }

    pub fn type_of_service(&self) -> Option<u32> {
        self.type_of_service
    }

    pub fn set_timeout(&mut self, timeout_millis: u64) -> NodeResult<()> {
        self.timeout = Some(timeout_millis);
        let duration = Some(Duration::from_millis(timeout_millis));
        self.stream()?
            .set_read_timeout(duration)
            .map_err(map_net_error)?;
        self.stream()?
            .set_write_timeout(duration)
            .map_err(map_net_error)
    }

    pub fn timeout(&self) -> Option<u64> {
        self.timeout
    }

    pub fn set_encoding(&mut self, encoding: &str) {
        self.encoding = Some(encoding.to_ascii_lowercase());
    }

    pub fn encoding(&self) -> Option<&str> {
        self.encoding.as_deref()
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

    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self) {
        self.paused = false;
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn allow_half_open(&self) -> bool {
        self.allow_half_open
    }

    fn stream(&self) -> NodeResult<&TcpStream> {
        self.stream
            .as_ref()
            .ok_or_else(|| NodeError::new("ENOTCONN", "socket is not connected"))
    }

    fn stream_mut(&mut self) -> NodeResult<&mut TcpStream> {
        self.stream
            .as_mut()
            .ok_or_else(|| NodeError::new("ENOTCONN", "socket is not connected"))
    }
}

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
