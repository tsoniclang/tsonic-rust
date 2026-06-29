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
