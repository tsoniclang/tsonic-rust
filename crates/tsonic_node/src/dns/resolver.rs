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

