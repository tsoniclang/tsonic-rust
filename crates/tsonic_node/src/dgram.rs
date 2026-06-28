use std::net::UdpSocket;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressInfo {
    pub address: String,
    pub family: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteInfo {
    pub address: String,
    pub family: String,
    pub port: u16,
    pub size: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindOptions {
    pub port: Option<u16>,
    pub address: Option<String>,
    pub exclusive: bool,
    pub fd: Option<i32>,
}

impl Default for BindOptions {
    fn default() -> Self {
        Self {
            port: Some(0),
            address: Some("127.0.0.1".to_string()),
            exclusive: false,
            fd: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketOptions {
    pub type_: String,
    pub reuse_addr: bool,
    pub reuse_port: bool,
    pub ipv6_only: bool,
    pub recv_buffer_size: Option<usize>,
    pub send_buffer_size: Option<usize>,
    pub lookup: bool,
    pub hostname: Option<String>,
    pub options: bool,
    pub callback: bool,
    pub receive_block_list: bool,
    pub send_block_list: bool,
}

impl Default for SocketOptions {
    fn default() -> Self {
        Self {
            type_: "udp4".to_string(),
            reuse_addr: false,
            reuse_port: false,
            ipv6_only: false,
            recv_buffer_size: None,
            send_buffer_size: None,
            lookup: false,
            hostname: None,
            options: false,
            callback: false,
            receive_block_list: false,
            send_block_list: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendOptions {
    pub msg: Vec<u8>,
    pub offset: usize,
    pub length: usize,
    pub port: Option<u16>,
    pub callback: bool,
}

impl SendOptions {
    pub fn new(msg: impl AsRef<[u8]>, port: Option<u16>) -> Self {
        let msg = msg.as_ref().to_vec();
        let length = msg.len();
        Self {
            msg,
            offset: 0,
            length,
            port,
            callback: false,
        }
    }

    pub fn payload(&self) -> &[u8] {
        let start = self.offset.min(self.msg.len());
        let end = start.saturating_add(self.length).min(self.msg.len());
        &self.msg[start..end]
    }
}

pub struct Socket {
    socket: UdpSocket,
    refed: bool,
    closed: bool,
    recv_buffer_size: usize,
    send_buffer_size: usize,
    ttl: u32,
    multicast_ttl: u32,
    broadcast: bool,
    multicast_interface: Option<String>,
    multicast_loopback: bool,
    source_memberships: Vec<(String, String, Option<String>)>,
}

impl Socket {
    pub fn bind(host: &str, port: u16) -> NodeResult<Self> {
        let socket = UdpSocket::bind((host, port)).map_err(map_dgram_error)?;
        Ok(Self {
            socket,
            refed: true,
            closed: false,
            recv_buffer_size: 0,
            send_buffer_size: 0,
            ttl: 64,
            multicast_ttl: 1,
            broadcast: false,
            multicast_interface: None,
            multicast_loopback: true,
            source_memberships: Vec::new(),
        })
    }

    pub fn bind_with_options(options: &BindOptions) -> NodeResult<Self> {
        Self::bind(
            options.address.as_deref().unwrap_or("127.0.0.1"),
            options.port.unwrap_or(0),
        )
    }

    pub fn address(&self) -> NodeResult<AddressInfo> {
        self.socket
            .local_addr()
            .map(address_info)
            .map_err(map_dgram_error)
    }

    pub fn local_port(&self) -> NodeResult<u16> {
        self.socket
            .local_addr()
            .map(|addr| addr.port())
            .map_err(map_dgram_error)
    }

    pub fn connect(&self, host: &str, port: u16) -> NodeResult<()> {
        self.socket.connect((host, port)).map_err(map_dgram_error)
    }

    pub fn disconnect(&self) -> NodeResult<()> {
        #[cfg(target_os = "linux")]
        {
            self.socket.connect(("0.0.0.0", 0)).map_err(map_dgram_error)
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err(NodeError::new(
                "ERR_FEATURE_UNAVAILABLE",
                "UDP disconnect is currently implemented for Linux targets",
            ))
        }
    }

    pub fn remote_address(&self) -> NodeResult<AddressInfo> {
        self.socket
            .peer_addr()
            .map(address_info)
            .map_err(map_dgram_error)
    }

    pub fn send(&self, data: &[u8]) -> NodeResult<usize> {
        self.socket.send(data).map_err(map_dgram_error)
    }

    pub fn send_to(&self, data: &[u8], host: &str, port: u16) -> NodeResult<usize> {
        self.socket
            .send_to(data, (host, port))
            .map_err(map_dgram_error)
    }

    pub fn send_with_options(&self, options: &SendOptions, host: &str) -> NodeResult<usize> {
        let port = options.port.ok_or_else(|| {
            NodeError::new(
                "ERR_SOCKET_BAD_PORT",
                "send options require an explicit destination port",
            )
        })?;
        self.send_to(options.payload(), host, port)
    }

    pub fn recv_from(&self, buffer: &mut [u8]) -> NodeResult<(usize, String)> {
        self.socket
            .recv_from(buffer)
            .map(|(len, addr)| (len, addr.to_string()))
            .map_err(map_dgram_error)
    }

    pub fn recv_remote_info(&self, buffer: &mut [u8]) -> NodeResult<(usize, RemoteInfo)> {
        self.socket
            .recv_from(buffer)
            .map(|(len, addr)| {
                let mut remote = remote_info(addr);
                remote.size = len;
                (len, remote)
            })
            .map_err(map_dgram_error)
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn closed(&self) -> bool {
        self.closed
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

    pub fn set_broadcast(&mut self, enabled: bool) -> NodeResult<()> {
        self.socket
            .set_broadcast(enabled)
            .map_err(map_dgram_error)?;
        self.broadcast = enabled;
        Ok(())
    }

    pub fn broadcast(&self) -> bool {
        self.broadcast
    }

    pub fn set_ttl(&mut self, ttl: u32) -> NodeResult<u32> {
        self.socket.set_ttl(ttl).map_err(map_dgram_error)?;
        self.ttl = ttl;
        Ok(ttl)
    }

    pub fn ttl(&self) -> u32 {
        self.ttl
    }

    pub fn set_multicast_ttl(&mut self, ttl: u32) -> NodeResult<u32> {
        self.socket
            .set_multicast_ttl_v4(ttl)
            .map_err(map_dgram_error)?;
        self.multicast_ttl = ttl;
        Ok(ttl)
    }

    pub fn multicast_ttl(&self) -> u32 {
        self.multicast_ttl
    }

    pub fn set_multicast_interface(&mut self, multicast_interface: &str) {
        self.multicast_interface = Some(multicast_interface.to_string());
    }

    pub fn multicast_interface(&self) -> Option<&str> {
        self.multicast_interface.as_deref()
    }

    pub fn set_multicast_loopback(&mut self, flag: bool) -> bool {
        self.multicast_loopback = flag;
        flag
    }

    pub fn multicast_loopback(&self) -> bool {
        self.multicast_loopback
    }

    pub fn set_recv_buffer_size(&mut self, size: usize) {
        self.recv_buffer_size = size;
    }

    pub fn get_recv_buffer_size(&self) -> usize {
        self.recv_buffer_size
    }

    pub fn set_send_buffer_size(&mut self, size: usize) {
        self.send_buffer_size = size;
    }

    pub fn get_send_buffer_size(&self) -> usize {
        self.send_buffer_size
    }

    pub fn get_send_queue_size(&self) -> usize {
        0
    }

    pub fn get_send_queue_count(&self) -> usize {
        0
    }

    pub fn add_membership(&self, _multicast_address: &str, _interface: Option<&str>) {}

    pub fn drop_membership(&self, _multicast_address: &str, _interface: Option<&str>) {}

    pub fn add_source_specific_membership(
        &mut self,
        source_address: &str,
        group_address: &str,
        multicast_interface: Option<&str>,
    ) {
        self.source_memberships.push((
            source_address.to_string(),
            group_address.to_string(),
            multicast_interface.map(str::to_string),
        ));
    }

    pub fn drop_source_specific_membership(
        &mut self,
        source_address: &str,
        group_address: &str,
        multicast_interface: Option<&str>,
    ) {
        let target = (
            source_address.to_string(),
            group_address.to_string(),
            multicast_interface.map(str::to_string),
        );
        self.source_memberships
            .retain(|membership| membership != &target);
    }

    pub fn source_memberships(&self) -> &[(String, String, Option<String>)] {
        &self.source_memberships
    }
}

pub fn create_socket() -> NodeResult<Socket> {
    Socket::bind("127.0.0.1", 0)
}

fn address_info(addr: std::net::SocketAddr) -> AddressInfo {
    AddressInfo {
        address: addr.ip().to_string(),
        family: if addr.ip().is_ipv4() {
            "IPv4".to_string()
        } else {
            "IPv6".to_string()
        },
        port: addr.port(),
    }
}

fn remote_info(addr: std::net::SocketAddr) -> RemoteInfo {
    RemoteInfo {
        address: addr.ip().to_string(),
        family: if addr.ip().is_ipv4() {
            "IPv4".to_string()
        } else {
            "IPv6".to_string()
        },
        port: addr.port(),
        size: 0,
    }
}

fn map_dgram_error(error: std::io::Error) -> NodeError {
    NodeError::new("EDGRAM", error.to_string())
}
