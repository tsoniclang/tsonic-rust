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
    pub iodef: Option<String>,
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
pub struct AnyARecord {
    pub address: String,
}

impl AnyARecord {
    pub fn record_type(&self) -> &'static str {
        "A"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyAaaaRecord {
    pub address: String,
}

impl AnyAaaaRecord {
    pub fn record_type(&self) -> &'static str {
        "AAAA"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyCnameRecord {
    pub value: String,
}

impl AnyCnameRecord {
    pub fn record_type(&self) -> &'static str {
        "CNAME"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyNsRecord {
    pub value: String,
}

impl AnyNsRecord {
    pub fn record_type(&self) -> &'static str {
        "NS"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyPtrRecord {
    pub value: String,
}

impl AnyPtrRecord {
    pub fn record_type(&self) -> &'static str {
        "PTR"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyMxRecord {
    pub priority: u16,
    pub exchange: String,
}

impl AnyMxRecord {
    pub fn record_type(&self) -> &'static str {
        "MX"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnySrvRecord {
    pub priority: u16,
    pub weight: u16,
    pub port: u16,
    pub name: String,
}

impl AnySrvRecord {
    pub fn record_type(&self) -> &'static str {
        "SRV"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyTxtRecord {
    pub entries: Vec<String>,
}

impl AnyTxtRecord {
    pub fn record_type(&self) -> &'static str {
        "TXT"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnySoaRecord {
    pub nsname: String,
    pub hostmaster: String,
    pub serial: u32,
    pub refresh: u32,
    pub retry: u32,
    pub expire: u32,
    pub minttl: u32,
}

impl AnySoaRecord {
    pub fn record_type(&self) -> &'static str {
        "SOA"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyCaaRecord {
    pub critical: u8,
    pub issue: Option<String>,
    pub issue_wild: Option<String>,
    pub iodef: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
}

impl AnyCaaRecord {
    pub fn record_type(&self) -> &'static str {
        "CAA"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyNaptrRecord {
    pub flags: String,
    pub service: String,
    pub regexp: String,
    pub replacement: String,
    pub order: u16,
    pub preference: u16,
}

impl AnyNaptrRecord {
    pub fn record_type(&self) -> &'static str {
        "NAPTR"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnyTlsaRecord {
    pub cert_usage: u8,
    pub selector: u8,
    pub match_type: u8,
    pub data: Vec<u8>,
}

impl AnyTlsaRecord {
    pub fn record_type(&self) -> &'static str {
        "TLSA"
    }
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
pub struct ResolverOptions {
    pub timeout: Option<u64>,
    pub tries: Option<u32>,
    pub max_timeout: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Resolver {
    servers: Vec<String>,
    local_ipv4: Option<String>,
    local_ipv6: Option<String>,
    cancelled: bool,
    options: ResolverOptions,
}

impl Resolver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_options(options: ResolverOptions) -> Self {
        Self {
            options,
            ..Self::default()
        }
    }

    pub fn options(&self) -> &ResolverOptions {
        &self.options
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

    pub fn lookup_one(
        &self,
        hostname: &str,
        options: LookupOneOptions,
    ) -> NodeResult<LookupAddress> {
        lookup_one(hostname, options)
    }

    pub fn lookup_all(
        &self,
        hostname: &str,
        options: LookupAllOptions,
    ) -> NodeResult<Vec<LookupAddress>> {
        lookup_all(hostname, options)
    }

    pub fn resolve4(&self, hostname: &str) -> NodeResult<Vec<String>> {
        resolve4(hostname)
    }

    pub fn resolve6(&self, hostname: &str) -> NodeResult<Vec<String>> {
        resolve6(hostname)
    }

    pub fn resolve4_with_ttl(&self, hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
        resolve4_with_ttl(hostname)
    }

    pub fn resolve6_with_ttl(&self, hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
        resolve6_with_ttl(hostname)
    }

    pub fn resolve4_with_options(
        &self,
        hostname: &str,
        options: ResolveOptions,
    ) -> NodeResult<ResolveAddressResult> {
        resolve4_with_options(hostname, options)
    }

    pub fn resolve6_with_options(
        &self,
        hostname: &str,
        options: ResolveOptions,
    ) -> NodeResult<ResolveAddressResult> {
        resolve6_with_options(hostname, options)
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
        lookup, lookup_all, lookup_one, lookup_service, resolve, resolve4, resolve4_with_options,
        resolve4_with_ttl, resolve6, resolve6_with_options, resolve6_with_ttl, resolve_any,
        resolve_caa, resolve_cname, resolve_mx, resolve_naptr, resolve_ns, resolve_ptr,
        resolve_soa, resolve_srv, resolve_tlsa, resolve_txt, reverse, AnyRecord, CaaRecord,
        LookupAddress, LookupAllOptions, LookupOneOptions, MxRecord, NaptrRecord, RecordWithTtl,
        ResolveAddressResult, ResolveOptions, ResolverOptions, SoaRecord, SrvRecord, TlsaRecord,
    };
    use crate::error::NodeResult;

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct Resolver {
        inner: super::Resolver,
    }

    impl Resolver {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn with_options(options: ResolverOptions) -> Self {
            Self {
                inner: super::Resolver::with_options(options),
            }
        }

        pub fn options(&self) -> &ResolverOptions {
            self.inner.options()
        }

        pub fn set_servers(&mut self, servers: &[&str]) {
            self.inner.set_servers(servers);
        }

        pub fn get_servers(&self) -> Vec<String> {
            self.inner.get_servers()
        }

        pub fn set_local_address(&mut self, ipv4: Option<&str>, ipv6: Option<&str>) {
            self.inner.set_local_address(ipv4, ipv6);
        }

        pub fn cancel(&mut self) {
            self.inner.cancel();
        }

        pub fn cancelled(&self) -> bool {
            self.inner.cancelled()
        }

        pub fn lookup(&self, hostname: &str) -> NodeResult<LookupAddress> {
            self.inner.lookup(hostname)
        }

        pub fn lookup_one(
            &self,
            hostname: &str,
            options: LookupOneOptions,
        ) -> NodeResult<LookupAddress> {
            self.inner.lookup_one(hostname, options)
        }

        pub fn lookup_all(
            &self,
            hostname: &str,
            options: LookupAllOptions,
        ) -> NodeResult<Vec<LookupAddress>> {
            self.inner.lookup_all(hostname, options)
        }

        pub fn resolve4(&self, hostname: &str) -> NodeResult<Vec<String>> {
            self.inner.resolve4(hostname)
        }

        pub fn resolve6(&self, hostname: &str) -> NodeResult<Vec<String>> {
            self.inner.resolve6(hostname)
        }

        pub fn resolve4_with_ttl(&self, hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
            self.inner.resolve4_with_ttl(hostname)
        }

        pub fn resolve6_with_ttl(&self, hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
            self.inner.resolve6_with_ttl(hostname)
        }

        pub fn resolve4_with_options(
            &self,
            hostname: &str,
            options: ResolveOptions,
        ) -> NodeResult<ResolveAddressResult> {
            self.inner.resolve4_with_options(hostname, options)
        }

        pub fn resolve6_with_options(
            &self,
            hostname: &str,
            options: ResolveOptions,
        ) -> NodeResult<ResolveAddressResult> {
            self.inner.resolve6_with_options(hostname, options)
        }

        pub fn resolve(&self, hostname: &str, rrtype: Option<&str>) -> NodeResult<Vec<String>> {
            self.inner.resolve(hostname, rrtype)
        }

        pub fn resolve_cname(&self, hostname: &str) -> NodeResult<Vec<String>> {
            self.inner.resolve_cname(hostname)
        }

        pub fn resolve_mx(&self, hostname: &str) -> NodeResult<Vec<MxRecord>> {
            self.inner.resolve_mx(hostname)
        }

        pub fn resolve_txt(&self, hostname: &str) -> NodeResult<Vec<Vec<String>>> {
            self.inner.resolve_txt(hostname)
        }

        pub fn resolve_srv(&self, hostname: &str) -> NodeResult<Vec<SrvRecord>> {
            self.inner.resolve_srv(hostname)
        }

        pub fn resolve_ns(&self, hostname: &str) -> NodeResult<Vec<String>> {
            self.inner.resolve_ns(hostname)
        }

        pub fn resolve_ptr(&self, hostname: &str) -> NodeResult<Vec<String>> {
            self.inner.resolve_ptr(hostname)
        }

        pub fn resolve_caa(&self, hostname: &str) -> NodeResult<Vec<CaaRecord>> {
            self.inner.resolve_caa(hostname)
        }

        pub fn resolve_naptr(&self, hostname: &str) -> NodeResult<Vec<NaptrRecord>> {
            self.inner.resolve_naptr(hostname)
        }

        pub fn resolve_soa(&self, hostname: &str) -> NodeResult<SoaRecord> {
            self.inner.resolve_soa(hostname)
        }

        pub fn resolve_tlsa(&self, hostname: &str) -> NodeResult<Vec<TlsaRecord>> {
            self.inner.resolve_tlsa(hostname)
        }

        pub fn resolve_any(&self, hostname: &str) -> NodeResult<Vec<AnyRecord>> {
            self.inner.resolve_any(hostname)
        }

        pub fn reverse(&self, address: &str) -> NodeResult<Vec<String>> {
            self.inner.reverse(address)
        }
    }

    pub fn lookup_now(hostname: &str) -> NodeResult<LookupAddress> {
        lookup(hostname)
    }

    pub fn lookup_one_now(hostname: &str, options: LookupOneOptions) -> NodeResult<LookupAddress> {
        lookup_one(hostname, options)
    }

    pub fn lookup_all_now(
        hostname: &str,
        options: LookupAllOptions,
    ) -> NodeResult<Vec<LookupAddress>> {
        lookup_all(hostname, options)
    }

    pub fn resolve4_now(hostname: &str) -> NodeResult<Vec<String>> {
        resolve4(hostname)
    }

    pub fn resolve6_now(hostname: &str) -> NodeResult<Vec<String>> {
        resolve6(hostname)
    }

    pub fn resolve4_with_ttl_now(hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
        resolve4_with_ttl(hostname)
    }

    pub fn resolve6_with_ttl_now(hostname: &str) -> NodeResult<Vec<RecordWithTtl>> {
        resolve6_with_ttl(hostname)
    }

    pub fn resolve4_with_options_now(
        hostname: &str,
        options: ResolveOptions,
    ) -> NodeResult<ResolveAddressResult> {
        resolve4_with_options(hostname, options)
    }

    pub fn resolve6_with_options_now(
        hostname: &str,
        options: ResolveOptions,
    ) -> NodeResult<ResolveAddressResult> {
        resolve6_with_options(hostname, options)
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

fn lookup_addresses(hostname: &str) -> NodeResult<Vec<LookupAddress>> {
    let addresses = (hostname, 0)
        .to_socket_addrs()
        .map_err(map_dns_error)?
        .map(|address| {
            let ip = address.ip();
            LookupAddress {
                address: ip.to_string(),
                family: if ip.is_ipv4() { 4 } else { 6 },
            }
        })
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        Err(NodeError::new(
            "ENOTFOUND",
            "DNS lookup returned no addresses",
        ))
    } else {
        Ok(addresses)
    }
}

fn apply_result_order(addresses: &mut [LookupAddress], order: Option<DefaultResultOrder>) {
    match order.unwrap_or_else(get_default_result_order) {
        DefaultResultOrder::Ipv4First => addresses.sort_by_key(|address| address.family != 4),
        DefaultResultOrder::Ipv6First => addresses.sort_by_key(|address| address.family != 6),
        DefaultResultOrder::Verbatim => {}
    }
}

fn addresses_to_records_with_ttl(addresses: Vec<String>) -> Vec<RecordWithTtl> {
    addresses
        .into_iter()
        .map(|address| RecordWithTtl { address, ttl: 0 })
        .collect()
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
