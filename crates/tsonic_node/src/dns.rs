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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaaRecord {
    pub critical: u8,
    pub issue: Option<String>,
    pub issue_wild: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NaptrRecord {
    pub flags: String,
    pub service: String,
    pub regexp: String,
    pub replacement: String,
    pub order: u16,
    pub preference: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoaRecord {
    pub nsname: String,
    pub hostmaster: String,
    pub serial: u32,
    pub refresh: u32,
    pub retry: u32,
    pub expire: u32,
    pub minttl: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsaRecord {
    pub cert_usage: u8,
    pub selector: u8,
    pub match_type: u8,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnyRecord {
    A(String),
    Aaaa(String),
    Cname(String),
    Mx(MxRecord),
    Ns(String),
    Ptr(String),
    Soa(SoaRecord),
    Srv(SrvRecord),
    Txt(Vec<String>),
    Caa(CaaRecord),
    Naptr(NaptrRecord),
    Tlsa(TlsaRecord),
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

pub fn resolve_ns(_hostname: &str) -> NodeResult<Vec<String>> {
    unsupported_record_type("NS")
}

pub fn resolve_ptr(_hostname: &str) -> NodeResult<Vec<String>> {
    unsupported_record_type("PTR")
}

pub fn resolve_caa(_hostname: &str) -> NodeResult<Vec<CaaRecord>> {
    unsupported_record_type("CAA")
}

pub fn resolve_naptr(_hostname: &str) -> NodeResult<Vec<NaptrRecord>> {
    unsupported_record_type("NAPTR")
}

pub fn resolve_soa(_hostname: &str) -> NodeResult<SoaRecord> {
    Err(NodeError::new(
        "ENODATA",
        "SOA lookup requires a DNS record resolver dependency",
    ))
}

pub fn resolve_tlsa(_hostname: &str) -> NodeResult<Vec<TlsaRecord>> {
    unsupported_record_type("TLSA")
}

pub fn resolve_any(hostname: &str) -> NodeResult<Vec<AnyRecord>> {
    let mut records = Vec::new();
    records.extend(
        resolve4(hostname)
            .unwrap_or_default()
            .into_iter()
            .map(AnyRecord::A),
    );
    records.extend(
        resolve6(hostname)
            .unwrap_or_default()
            .into_iter()
            .map(AnyRecord::Aaaa),
    );
    if records.is_empty() {
        Err(NodeError::new("ENODATA", "no DNS records found"))
    } else {
        Ok(records)
    }
}

pub fn reverse(address: &str) -> NodeResult<Vec<String>> {
    address
        .parse::<std::net::IpAddr>()
        .map(|_| vec![address.to_string()])
        .map_err(|error| NodeError::new("ENOTFOUND", error.to_string()))
}

pub fn lookup_service(address: &str, port: u16) -> NodeResult<(String, String)> {
    address
        .parse::<std::net::IpAddr>()
        .map(|ip| (ip.to_string(), port.to_string()))
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
    local_ipv4: Option<String>,
    local_ipv6: Option<String>,
    cancelled: bool,
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

    pub fn set_local_address(&mut self, ipv4: Option<&str>, ipv6: Option<&str>) {
        self.local_ipv4 = ipv4.map(ToString::to_string);
        self.local_ipv6 = ipv6.map(ToString::to_string);
    }

    pub fn local_addresses(&self) -> (Option<&str>, Option<&str>) {
        (self.local_ipv4.as_deref(), self.local_ipv6.as_deref())
    }

    pub fn cancel(&mut self) {
        self.cancelled = true;
    }

    pub fn cancelled(&self) -> bool {
        self.cancelled
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

    pub fn resolve(&self, hostname: &str, rrtype: Option<&str>) -> NodeResult<Vec<String>> {
        resolve(hostname, rrtype)
    }

    pub fn resolve_cname(&self, hostname: &str) -> NodeResult<Vec<String>> {
        resolve_cname(hostname)
    }

    pub fn resolve_mx(&self, hostname: &str) -> NodeResult<Vec<MxRecord>> {
        resolve_mx(hostname)
    }

    pub fn resolve_txt(&self, hostname: &str) -> NodeResult<Vec<Vec<String>>> {
        resolve_txt(hostname)
    }

    pub fn resolve_srv(&self, hostname: &str) -> NodeResult<Vec<SrvRecord>> {
        resolve_srv(hostname)
    }

    pub fn resolve_ns(&self, hostname: &str) -> NodeResult<Vec<String>> {
        resolve_ns(hostname)
    }

    pub fn resolve_ptr(&self, hostname: &str) -> NodeResult<Vec<String>> {
        resolve_ptr(hostname)
    }

    pub fn resolve_caa(&self, hostname: &str) -> NodeResult<Vec<CaaRecord>> {
        resolve_caa(hostname)
    }

    pub fn resolve_naptr(&self, hostname: &str) -> NodeResult<Vec<NaptrRecord>> {
        resolve_naptr(hostname)
    }

    pub fn resolve_soa(&self, hostname: &str) -> NodeResult<SoaRecord> {
        resolve_soa(hostname)
    }

    pub fn resolve_tlsa(&self, hostname: &str) -> NodeResult<Vec<TlsaRecord>> {
        resolve_tlsa(hostname)
    }

    pub fn resolve_any(&self, hostname: &str) -> NodeResult<Vec<AnyRecord>> {
        resolve_any(hostname)
    }

    pub fn reverse(&self, address: &str) -> NodeResult<Vec<String>> {
        reverse(address)
    }
}

pub mod promises {
    use super::{
        lookup, lookup_service, resolve, resolve4, resolve6, resolve_any, resolve_caa,
        resolve_cname, resolve_mx, resolve_naptr, resolve_ns, resolve_ptr, resolve_soa,
        resolve_srv, resolve_tlsa, resolve_txt, reverse, AnyRecord, CaaRecord, LookupAddress,
        MxRecord, NaptrRecord, SoaRecord, SrvRecord, TlsaRecord,
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

    pub fn resolve_ns_now(hostname: &str) -> NodeResult<Vec<String>> {
        resolve_ns(hostname)
    }

    pub fn resolve_ptr_now(hostname: &str) -> NodeResult<Vec<String>> {
        resolve_ptr(hostname)
    }

    pub fn resolve_caa_now(hostname: &str) -> NodeResult<Vec<CaaRecord>> {
        resolve_caa(hostname)
    }

    pub fn resolve_naptr_now(hostname: &str) -> NodeResult<Vec<NaptrRecord>> {
        resolve_naptr(hostname)
    }

    pub fn resolve_soa_now(hostname: &str) -> NodeResult<SoaRecord> {
        resolve_soa(hostname)
    }

    pub fn resolve_tlsa_now(hostname: &str) -> NodeResult<Vec<TlsaRecord>> {
        resolve_tlsa(hostname)
    }

    pub fn resolve_any_now(hostname: &str) -> NodeResult<Vec<AnyRecord>> {
        resolve_any(hostname)
    }

    pub fn reverse_now(address: &str) -> NodeResult<Vec<String>> {
        reverse(address)
    }

    pub fn lookup_service_now(address: &str, port: u16) -> NodeResult<(String, String)> {
        lookup_service(address, port)
    }
}

fn map_dns_error(error: std::io::Error) -> NodeError {
    NodeError::new("ENOTFOUND", error.to_string())
}

fn unsupported_record_type<T>(record_type: &str) -> NodeResult<Vec<T>> {
    Err(NodeError::new(
        "ENODATA",
        format!("{record_type} lookup requires a DNS record resolver dependency"),
    ))
}

static DEFAULT_ORDER: OnceLock<Mutex<DefaultResultOrder>> = OnceLock::new();

fn default_order() -> &'static Mutex<DefaultResultOrder> {
    DEFAULT_ORDER.get_or_init(|| Mutex::new(DefaultResultOrder::Verbatim))
}
