use std::net::ToSocketAddrs;

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

pub mod promises {
    use super::{lookup, resolve4, resolve6, LookupAddress};
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
}

fn map_dns_error(error: std::io::Error) -> NodeError {
    NodeError::new("ENOTFOUND", error.to_string())
}
