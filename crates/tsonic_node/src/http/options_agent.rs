#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClientRequestArgs {
    pub url: Option<String>,
    pub options: Option<RequestOptions>,
    pub callback: bool,
    pub protocol: Option<String>,
    pub host: Option<String>,
    pub hostname: Option<String>,
    pub family: Option<u8>,
    pub port: Option<u16>,
    pub local_address: Option<String>,
    pub socket_path: Option<String>,
    pub method: Option<String>,
    pub path: Option<String>,
    pub headers: OutgoingHttpHeaders,
    pub auth: Option<String>,
    pub agent: Option<Agent>,
    pub create_connection: bool,
    pub timeout: Option<u64>,
    pub set_host: bool,
    pub default_port: Option<String>,
    pub lookup: bool,
    pub join_duplicate_headers: bool,
    pub unique_headers: Vec<String>,
    pub signal_aborted: bool,
    pub max_header_size: Option<usize>,
    pub insecure_http_parser: bool,
    pub oncreate: bool,
    pub default_agent: Option<Agent>,
    pub local_port: Option<u16>,
    pub set_default_headers: bool,
}

impl ClientRequestArgs {
    pub fn to_request_options(&self) -> RequestOptions {
        RequestOptions {
            host: self
                .hostname
                .clone()
                .or_else(|| self.host.clone())
                .unwrap_or_else(|| "localhost".to_string()),
            port: self.port.unwrap_or(80),
            path: self.path.clone().unwrap_or_else(|| "/".to_string()),
            method: self.method.clone().unwrap_or_else(|| "GET".to_string()),
            headers: self.headers.clone(),
            protocol: self.protocol.clone().unwrap_or_else(|| "http:".to_string()),
            timeout: self.timeout,
            agent: self.agent.clone(),
            auth: self.auth.clone(),
            set_host: self.set_host,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentOptions {
    pub protocol: Option<String>,
    pub callback: bool,
    pub keep_alive: bool,
    pub keep_alive_msecs: u64,
    pub max_sockets: usize,
    pub max_free_sockets: usize,
    pub max_total_sockets: usize,
    pub timeout: Option<u64>,
    pub scheduling: String,
    pub agent_keep_alive_timeout_buffer: Option<u64>,
    pub proxy_env: Option<ProxyEnv>,
    pub default_port: Option<String>,
}

impl Default for AgentOptions {
    fn default() -> Self {
        Self {
            protocol: Some("http:".to_string()),
            callback: false,
            keep_alive: false,
            keep_alive_msecs: 1_000,
            max_sockets: usize::MAX,
            max_free_sockets: 256,
            max_total_sockets: usize::MAX,
            timeout: None,
            scheduling: "lifo".to_string(),
            agent_keep_alive_timeout_buffer: None,
            proxy_env: None,
            default_port: Some("80".to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agent {
    pub options: AgentOptions,
    pub callback: bool,
    pub max_sockets: usize,
    pub max_free_sockets: usize,
    pub max_total_sockets: usize,
    pub sockets: BTreeMap<String, Vec<String>>,
    pub free_sockets: BTreeMap<String, Vec<String>>,
    pub requests: BTreeMap<String, Vec<String>>,
    destroyed: bool,
}

impl Agent {
    pub fn new(options: Option<AgentOptions>) -> Self {
        let options = options.unwrap_or_default();
        Self {
            max_sockets: options.max_sockets,
            max_free_sockets: options.max_free_sockets,
            max_total_sockets: options.max_total_sockets,
            callback: options.callback,
            options,
            sockets: BTreeMap::new(),
            free_sockets: BTreeMap::new(),
            requests: BTreeMap::new(),
            destroyed: false,
        }
    }

    pub fn get_name(&self, options: Option<&RequestOptions>) -> String {
        options
            .map(|options| format!("{}:{}:{}", options.host, options.port, options.method))
            .unwrap_or_else(|| "localhost:80:GET".to_string())
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn keep_socket_alive(&self) -> bool {
        self.options.keep_alive
    }

    pub fn reuse_socket(&self) -> bool {
        !self.destroyed
    }

    pub fn record_socket(&mut self, name: &str, socket_id: &str) {
        self.sockets
            .entry(name.to_string())
            .or_default()
            .push(socket_id.to_string());
    }

    pub fn record_free_socket(&mut self, name: &str, socket_id: &str) {
        self.free_sockets
            .entry(name.to_string())
            .or_default()
            .push(socket_id.to_string());
    }

    pub fn record_request(&mut self, name: &str, request_id: &str) {
        self.requests
            .entry(name.to_string())
            .or_default()
            .push(request_id.to_string());
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestOptions {
    pub host: String,
    pub port: u16,
    pub path: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub protocol: String,
    pub timeout: Option<u64>,
    pub agent: Option<Agent>,
    pub auth: Option<String>,
    pub set_host: bool,
}

impl RequestOptions {
    pub fn get(host: impl Into<String>, port: u16, path: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port,
            path: path.into(),
            method: "GET".to_string(),
            headers: BTreeMap::new(),
            protocol: "http:".to_string(),
            timeout: None,
            agent: None,
            auth: None,
            set_host: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerOptions {
    pub incoming_message: Option<String>,
    pub server_response: Option<String>,
    pub high_water_mark: Option<usize>,
    pub insecure_http_parser: bool,
    pub max_header_size: Option<usize>,
    pub no_delay: bool,
    pub keep_alive: bool,
    pub keep_alive_initial_delay: Option<u64>,
    pub keep_alive_timeout: u64,
    pub keep_alive_timeout_buffer: u64,
    pub request_timeout: u64,
    pub headers_timeout: u64,
    pub connections_checking_interval: Option<u64>,
    pub join_duplicate_headers: bool,
    pub unique_headers: Vec<String>,
    pub require_host_header: bool,
    pub reject_non_standard_body_writes: bool,
    pub optimize_empty_requests: bool,
    pub should_upgrade_callback: bool,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            incoming_message: None,
            server_response: None,
            high_water_mark: None,
            insecure_http_parser: false,
            max_header_size: Some(MAX_HEADER_SIZE),
            no_delay: true,
            keep_alive: true,
            keep_alive_initial_delay: None,
            keep_alive_timeout: 5_000,
            keep_alive_timeout_buffer: 1_000,
            request_timeout: 300_000,
            headers_timeout: 60_000,
            connections_checking_interval: Some(30_000),
            join_duplicate_headers: false,
            unique_headers: Vec::new(),
            require_host_header: true,
            reject_non_standard_body_writes: false,
            optimize_empty_requests: false,
            should_upgrade_callback: false,
        }
    }
}
