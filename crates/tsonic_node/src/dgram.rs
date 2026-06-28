use std::net::UdpSocket;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressInfo {
    pub address: String,
    pub family: String,
    pub port: u16,
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
        })
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

    pub fn recv_from(&self, buffer: &mut [u8]) -> NodeResult<(usize, String)> {
        self.socket
            .recv_from(buffer)
            .map(|(len, addr)| (len, addr.to_string()))
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

fn map_dgram_error(error: std::io::Error) -> NodeError {
    NodeError::new("EDGRAM", error.to_string())
}
