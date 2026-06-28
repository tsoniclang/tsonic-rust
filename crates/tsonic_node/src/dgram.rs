use std::net::UdpSocket;

use crate::error::{NodeError, NodeResult};

pub struct Socket {
    socket: UdpSocket,
}

impl Socket {
    pub fn bind(host: &str, port: u16) -> NodeResult<Self> {
        let socket = UdpSocket::bind((host, port)).map_err(map_dgram_error)?;
        Ok(Self { socket })
    }

    pub fn local_port(&self) -> NodeResult<u16> {
        self.socket
            .local_addr()
            .map(|addr| addr.port())
            .map_err(map_dgram_error)
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
}

pub fn create_socket() -> NodeResult<Socket> {
    Socket::bind("127.0.0.1", 0)
}

fn map_dgram_error(error: std::io::Error) -> NodeError {
    NodeError::new("EDGRAM", error.to_string())
}
