use std::net::ToSocketAddrs;
use std::sync::{Mutex, OnceLock};

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LookupAddress {
    pub address: String,
    pub family: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LookupOptions {
    pub family: Option<u8>,
    pub hints: Option<u32>,
    pub all: bool,
    pub verbatim: Option<bool>,
    pub order: Option<DefaultResultOrder>,
}

pub type LookupOneOptions = LookupOptions;
pub type LookupAllOptions = LookupOptions;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupResult {
    One(LookupAddress),
    All(Vec<LookupAddress>),
}

pub fn lookup(hostname: &str) -> NodeResult<LookupAddress> {
    lookup_with_options(hostname, LookupOptions::default()).and_then(|result| match result {
        LookupResult::One(address) => Ok(address),
        LookupResult::All(mut addresses) => addresses
            .drain(..)
            .next()
            .ok_or_else(|| NodeError::new("ENOTFOUND", "DNS lookup returned no addresses")),
    })
}

pub fn lookup_one(hostname: &str, options: LookupOneOptions) -> NodeResult<LookupAddress> {
    let mut options = options;
    options.all = false;
    lookup_with_options(hostname, options).and_then(|result| match result {
        LookupResult::One(address) => Ok(address),
        LookupResult::All(_) => Err(NodeError::new(
            "EINVAL",
            "lookupOne expected a single address result",
        )),
    })
}

pub fn lookup_all(hostname: &str, mut options: LookupAllOptions) -> NodeResult<Vec<LookupAddress>> {
    options.all = true;
    lookup_with_options(hostname, options).map(|result| match result {
        LookupResult::All(addresses) => addresses,
        LookupResult::One(address) => vec![address],
    })
}

pub fn lookup_with_options(hostname: &str, options: LookupOptions) -> NodeResult<LookupResult> {
    let mut addresses = lookup_addresses(hostname)?;
    if let Some(family) = options.family {
        addresses.retain(|address| address.family == family);
    }
    apply_result_order(&mut addresses, options.order);
    if addresses.is_empty() {
        return Err(NodeError::new(
            "ENOTFOUND",
            "DNS lookup returned no matching addresses",
        ));
    }
    if options.all {
        Ok(LookupResult::All(addresses))
    } else {
        Ok(LookupResult::One(addresses.remove(0)))
    }
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
pub struct RecordWithTtl {
    pub address: String,
    pub ttl: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ResolveOptions {
    pub ttl: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolveWithTtlOptions {
    pub ttl: bool,
}

impl Default for ResolveWithTtlOptions {
    fn default() -> Self {
        Self { ttl: true }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveAddressResult {
    Addresses(Vec<String>),
    Records(Vec<RecordWithTtl>),
}

pub fn resolve4_with_ttl(hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
    resolve4(hostname).map(addresses_to_records_with_ttl)
}

pub fn resolve6_with_ttl(hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
    resolve6(hostname).map(addresses_to_records_with_ttl)
}

pub fn resolve4_with_options(
    hostname: &str,
    options: ResolveOptions,
) -> NodeResult<ResolveAddressResult> {
    if options.ttl {
        resolve4_with_ttl(hostname).map(ResolveAddressResult::Records)
    } else {
        resolve4(hostname).map(ResolveAddressResult::Addresses)
    }
}

pub fn resolve6_with_options(
    hostname: &str,
    options: ResolveOptions,
) -> NodeResult<ResolveAddressResult> {
    if options.ttl {
        resolve6_with_ttl(hostname).map(ResolveAddressResult::Records)
    } else {
        resolve6(hostname).map(ResolveAddressResult::Addresses)
    }
}
