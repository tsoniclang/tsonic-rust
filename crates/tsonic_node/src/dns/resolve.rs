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

