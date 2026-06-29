#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientSessionOptions {
    pub authority: String,
    pub headers: BTreeMap<String, String>,
    pub prior_knowledge: bool,
    pub protocol: Option<String>,
    pub max_reserved_remote_streams: Option<usize>,
    pub session: SessionOptions,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionOptions {
    pub max_deflate_dynamic_table_size: Option<usize>,
    pub max_header_list_pairs: Option<usize>,
    pub max_outstanding_pings: Option<usize>,
    pub max_send_header_block_length: Option<usize>,
    pub max_session_memory: Option<usize>,
    pub max_settings: Option<usize>,
    pub padding_strategy: Option<u32>,
    pub peer_max_concurrent_streams: Option<u32>,
    pub remote_custom_settings: Vec<u32>,
    pub settings: Option<Http2Settings>,
    pub strict_field_whitespace_validation: bool,
    pub unknown_protocol_timeout: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClientSessionRequestOptions {
    pub end_stream: bool,
    pub exclusive: bool,
    pub parent: Option<u32>,
    pub signal_aborted: bool,
    pub wait_for_trailers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AlternativeServiceOptions {
    pub origin: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerStreamResponseOptions {
    pub end_stream: bool,
    pub wait_for_trailers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerStreamFileResponseOptions {
    pub offset: Option<u64>,
    pub length: Option<u64>,
    pub stat_check: Option<bool>,
    pub wait_for_trailers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerStreamFileResponseOptionsWithError {
    pub options: ServerStreamFileResponseOptions,
    pub on_error: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StatOptions {
    pub offset: u64,
    pub length: u64,
}
