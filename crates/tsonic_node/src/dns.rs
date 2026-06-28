use std::net::ToSocketAddrs;
use std::sync::{Mutex, OnceLock};

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LookupAddress {
    pub address: String,
    pub family: u8,
}

pub fn lookup(hostname: &str) -> NodeResult<LookupAddress> {
    let mut addresses = (hostname, 0).to_socket_addrs().map_err(map_dns_error)?;
    let Some(address) = addresses.next() else {
        return Err(NodeError::new(
            "ENOTFOUND",
            "DNS lookup returned no addresses",
        ));
    };
    let ip = address.ip();
    Ok(LookupAddress {
        address: ip.to_string(),
        family: if ip.is_ipv4() { 4 } else { 6 },
    })
}

pub fn resolve4(hostname: &str) -> NodeResult<Vec<String>> {
    let values = (hostname, 0)
        .to_socket_addrs()
        .map_err(map_dns_error)?
        .filter_map(|address| {
            let ip = address.ip();
            ip.is_ipv4().then(|| ip.to_string())
        })
        .collect::<Vec<_>>();
    if values.is_empty() {
        Err(NodeError::new("ENODATA", "no IPv4 records found"))
    } else {
        Ok(values)
    }
}

pub fn resolve6(hostname: &str) -> NodeResult<Vec<String>> {
    let values = (hostname, 0)
        .to_socket_addrs()
        .map_err(map_dns_error)?
        .filter_map(|address| {
            let ip = address.ip();
            ip.is_ipv6().then(|| ip.to_string())
        })
        .collect::<Vec<_>>();
    if values.is_empty() {
        Err(NodeError::new("ENODATA", "no IPv6 records found"))
    } else {
        Ok(values)
    }
}

pub fn resolve(hostname: &str, rrtype: Option<&str>) -> NodeResult<Vec<String>> {
    match rrtype.unwrap_or("A").to_ascii_uppercase().as_str() {
        "A" => resolve4(hostname),
        "AAAA" => resolve6(hostname),
        "CNAME" => resolve_cname(hostname),
        "MX" => resolve_mx(hostname).map(|values| {
            values
                .into_iter()
                .map(|value| format!("{} {}", value.priority, value.exchange))
                .collect()
        }),
        "TXT" => {
            resolve_txt(hostname).map(|values| values.into_iter().map(|row| row.join("")).collect())
        }
        "SRV" => resolve_srv(hostname).map(|values| {
            values
                .into_iter()
                .map(|value| format!("{}:{} {}", value.name, value.port, value.priority))
                .collect()
        }),
        _ => Err(NodeError::new("ENODATA", "unsupported DNS record type")),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MxRecord {
    pub priority: u16,
    pub exchange: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SrvRecord {
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    pub name: String,
}

pub fn resolve_cname(_hostname: &str) -> NodeResult<Vec<String>> {
    Err(NodeError::new(
        "ENODATA",
        "CNAME lookup requires a DNS record resolver dependency",
    ))
}

pub fn resolve_mx(_hostname: &str) -> NodeResult<Vec<MxRecord>> {
    Err(NodeError::new(
        "ENODATA",
        "MX lookup requires a DNS record resolver dependency",
    ))
}

pub fn resolve_txt(_hostname: &str) -> NodeResult<Vec<Vec<String>>> {
    Err(NodeError::new(
        "ENODATA",
        "TXT lookup requires a DNS record resolver dependency",
    ))
}

pub fn resolve_srv(_hostname: &str) -> NodeResult<Vec<SrvRecord>> {
    Err(NodeError::new(
        "ENODATA",
        "SRV lookup requires a DNS record resolver dependency",
    ))
}

pub fn reverse(address: &str) -> NodeResult<Vec<String>> {
    address
        .parse::<std::net::IpAddr>()
        .map(|_| vec![address.to_string()])
        .map_err(|error| NodeError::new("ENOTFOUND", error.to_string()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefaultResultOrder {
    Ipv4First,
    Ipv6First,
    Verbatim,
}

impl DefaultResultOrder {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ipv4First => "ipv4first",
            Self::Ipv6First => "ipv6first",
            Self::Verbatim => "verbatim",
        }
    }
}

pub fn set_default_result_order(order: DefaultResultOrder) {
    *default_order().lock().unwrap() = order;
}

pub fn get_default_result_order() -> DefaultResultOrder {
    *default_order().lock().unwrap()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Resolver {
    servers: Vec<String>,
}

impl Resolver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_servers(&mut self, servers: &[&str]) {
        self.servers = servers.iter().map(|server| server.to_string()).collect();
    }

    pub fn get_servers(&self) -> Vec<String> {
        self.servers.clone()
    }

    pub fn lookup(&self, hostname: &str) -> NodeResult<LookupAddress> {
        lookup(hostname)
    }

    pub fn resolve4(&self, hostname: &str) -> NodeResult<Vec<String>> {
        resolve4(hostname)
    }

    pub fn resolve6(&self, hostname: &str) -> NodeResult<Vec<String>> {
        resolve6(hostname)
    }
}

pub mod promises {
    use super::{
        lookup, resolve, resolve4, resolve6, resolve_cname, resolve_mx, resolve_srv, resolve_txt,
        reverse, LookupAddress, MxRecord, SrvRecord,
    };
    use crate::error::NodeResult;

    pub fn lookup_now(hostname: &str) -> NodeResult<LookupAddress> {
        lookup(hostname)
    }

    pub fn resolve4_now(hostname: &str) -> NodeResult<Vec<String>> {
        resolve4(hostname)
    }

    pub fn resolve6_now(hostname: &str) -> NodeResult<Vec<String>> {
        resolve6(hostname)
    }

    pub fn resolve_now(hostname: &str, rrtype: Option<&str>) -> NodeResult<Vec<String>> {
        resolve(hostname, rrtype)
    }

    pub fn resolve_cname_now(hostname: &str) -> NodeResult<Vec<String>> {
        resolve_cname(hostname)
    }

    pub fn resolve_mx_now(hostname: &str) -> NodeResult<Vec<MxRecord>> {
        resolve_mx(hostname)
    }

    pub fn resolve_txt_now(hostname: &str) -> NodeResult<Vec<Vec<String>>> {
        resolve_txt(hostname)
    }

    pub fn resolve_srv_now(hostname: &str) -> NodeResult<Vec<SrvRecord>> {
        resolve_srv(hostname)
    }

    pub fn reverse_now(address: &str) -> NodeResult<Vec<String>> {
        reverse(address)
    }
}

fn map_dns_error(error: std::io::Error) -> NodeError {
    NodeError::new("ENOTFOUND", error.to_string())
}

static DEFAULT_ORDER: OnceLock<Mutex<DefaultResultOrder>> = OnceLock::new();

fn default_order() -> &'static Mutex<DefaultResultOrder> {
    DEFAULT_ORDER.get_or_init(|| Mutex::new(DefaultResultOrder::Verbatim))
}
