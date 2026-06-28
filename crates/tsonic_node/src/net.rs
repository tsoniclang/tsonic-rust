use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs};

use crate::error::{NodeError, NodeResult};

pub struct Socket {
    stream: TcpStream,
}

impl Socket {
    pub fn connect(host: &str, port: u16) -> NodeResult<Self> {
        let stream = TcpStream::connect((host, port)).map_err(map_net_error)?;
        Ok(Self { stream })
    }

    pub fn from_stream(stream: TcpStream) -> Self {
        Self { stream }
    }

    pub fn write_all(&mut self, data: &[u8]) -> NodeResult<()> {
        self.stream.write_all(data).map_err(map_net_error)
    }

    pub fn read_to_end(&mut self) -> NodeResult<Vec<u8>> {
        let mut data = Vec::new();
        self.stream.read_to_end(&mut data).map_err(map_net_error)?;
        Ok(data)
    }

    pub fn shutdown(&self) -> NodeResult<()> {
        self.stream.shutdown(Shutdown::Both).map_err(map_net_error)
    }
}

pub struct Server {
    listener: TcpListener,
}

impl Server {
    pub fn listen(host: &str, port: u16) -> NodeResult<Self> {
        let listener = TcpListener::bind((host, port)).map_err(map_net_error)?;
        Ok(Self { listener })
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

    pub fn accept(&self) -> NodeResult<Socket> {
        let (stream, _) = self.listener.accept().map_err(map_net_error)?;
        Ok(Socket::from_stream(stream))
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

pub fn create_server(host: &str, port: u16) -> NodeResult<Server> {
    Server::listen(host, port)
}

pub fn lookup_endpoint(host: &str, port: u16) -> NodeResult<Vec<String>> {
    (host, port)
        .to_socket_addrs()
        .map_err(map_net_error)
        .map(|items| items.map(|addr| addr.to_string()).collect())
}

fn map_net_error(error: std::io::Error) -> NodeError {
    NodeError::new("ENET", error.to_string())
}
