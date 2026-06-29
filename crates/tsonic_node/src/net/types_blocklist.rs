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

