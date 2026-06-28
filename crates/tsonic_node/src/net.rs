use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddressInfo {
    pub address: String,
    pub family: String,
    pub port: u16,
}

pub struct Socket {
    stream: TcpStream,
    bytes_read: u64,
    bytes_written: u64,
    timeout: Option<u64>,
    encoding: Option<String>,
    refed: bool,
    destroyed: bool,
}

impl Socket {
    pub fn connect(host: &str, port: u16) -> NodeResult<Self> {
        let stream = TcpStream::connect((host, port)).map_err(map_net_error)?;
        Ok(Self::from_stream(stream))
    }

    pub fn from_stream(stream: TcpStream) -> Self {
        Self {
            stream,
            bytes_read: 0,
            bytes_written: 0,
            timeout: None,
            encoding: None,
            refed: true,
            destroyed: false,
        }
    }

    pub fn write_all(&mut self, data: &[u8]) -> NodeResult<()> {
        self.stream.write_all(data).map_err(map_net_error)?;
        self.bytes_written += data.len() as u64;
        Ok(())
    }

    pub fn write(&mut self, data: &[u8]) -> NodeResult<bool> {
        self.write_all(data)?;
        Ok(true)
    }

    pub fn read_to_end(&mut self) -> NodeResult<Vec<u8>> {
        let mut data = Vec::new();
        self.stream.read_to_end(&mut data).map_err(map_net_error)?;
        self.bytes_read += data.len() as u64;
        Ok(data)
    }

    pub fn end(&mut self, data: Option<&[u8]>) -> NodeResult<()> {
        if let Some(data) = data {
            self.write_all(data)?;
        }
        self.stream.shutdown(Shutdown::Write).map_err(map_net_error)
    }

    pub fn shutdown(&self) -> NodeResult<()> {
        self.stream.shutdown(Shutdown::Both).map_err(map_net_error)
    }

    pub fn destroy(&mut self) -> NodeResult<()> {
        self.destroyed = true;
        self.shutdown()
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn address(&self) -> NodeResult<AddressInfo> {
        self.stream
            .local_addr()
            .map(address_info)
            .map_err(map_net_error)
    }

    pub fn local_address(&self) -> NodeResult<String> {
        self.stream
            .local_addr()
            .map(|addr| addr.ip().to_string())
            .map_err(map_net_error)
    }

    pub fn local_port(&self) -> NodeResult<u16> {
        self.stream
            .local_addr()
            .map(|addr| addr.port())
            .map_err(map_net_error)
    }

    pub fn local_family(&self) -> NodeResult<String> {
        self.stream
            .local_addr()
            .map(|addr| family_string(addr.ip()))
            .map_err(map_net_error)
    }

    pub fn remote_address(&self) -> NodeResult<String> {
        self.stream
            .peer_addr()
            .map(|addr| addr.ip().to_string())
            .map_err(map_net_error)
    }

    pub fn remote_port(&self) -> NodeResult<u16> {
        self.stream
            .peer_addr()
            .map(|addr| addr.port())
            .map_err(map_net_error)
    }

    pub fn remote_family(&self) -> NodeResult<String> {
        self.stream
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
        false
    }

    pub fn connecting(&self) -> bool {
        false
    }

    pub fn set_no_delay(&self, no_delay: bool) -> NodeResult<()> {
        self.stream.set_nodelay(no_delay).map_err(map_net_error)
    }

    pub fn set_timeout(&mut self, timeout_millis: u64) -> NodeResult<()> {
        self.timeout = Some(timeout_millis);
        let duration = Some(Duration::from_millis(timeout_millis));
        self.stream
            .set_read_timeout(duration)
            .map_err(map_net_error)?;
        self.stream
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
}

pub struct Server {
    listener: TcpListener,
    refed: bool,
}

impl Server {
    pub fn listen(host: &str, port: u16) -> NodeResult<Self> {
        let listener = TcpListener::bind((host, port)).map_err(map_net_error)?;
        Ok(Self {
            listener,
            refed: true,
        })
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

    pub fn accept(&self) -> NodeResult<Socket> {
        let (stream, _) = self.listener.accept().map_err(map_net_error)?;
        Ok(Socket::from_stream(stream))
    }

    pub fn close(self) {}

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

pub fn create_server(host: &str, port: u16) -> NodeResult<Server> {
    Server::listen(host, port)
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

fn family_string(ip: std::net::IpAddr) -> String {
    if ip.is_ipv4() {
        "IPv4".to_string()
    } else {
        "IPv6".to_string()
    }
}

fn map_net_error(error: std::io::Error) -> NodeError {
    NodeError::new("ENET", error.to_string())
}
