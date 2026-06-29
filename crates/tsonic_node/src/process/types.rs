use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use crate::error::{NodeError, NodeResult};
use crate::events::EventEmitter;
use crate::os;
use crate::stream::Writable;
use tsonic_js::JsValue;

static EXIT_CODE: AtomicI32 = AtomicI32::new(i32::MIN);
static START: OnceLock<Instant> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryUsage {
    pub rss: u64,
    pub heap_total: u64,
    pub heap_used: u64,
    pub external: u64,
    pub array_buffers: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CpuUsage {
    pub user: u64,
    pub system: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceUsage {
    pub user_cpu_time: u64,
    pub system_cpu_time: u64,
    pub max_rss: u64,
    pub shared_memory_size: u64,
    pub unshared_data_size: u64,
    pub unshared_stack_size: u64,
    pub minor_page_fault: u64,
    pub major_page_fault: u64,
    pub swapped_out: u64,
    pub fs_read: u64,
    pub fs_write: u64,
    pub ipc_sent: u64,
    pub ipc_received: u64,
    pub signals_count: u64,
    pub voluntary_context_switches: u64,
    pub involuntary_context_switches: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub name: String,
    pub source_url: String,
    pub headers_url: Option<String>,
    pub lib_url: Option<String>,
    pub lts: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessFeatures {
    pub debug: bool,
    pub inspector: bool,
    pub ipv6: bool,
    pub tls: bool,
    pub tls_alpn: bool,
    pub tls_ocsp: bool,
    pub tls_sni: bool,
    pub uv: bool,
    pub cached_builtins: bool,
    pub require_module: bool,
    pub typescript: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessConfig {
    pub target_defaults: Vec<(String, String)>,
    pub variables: Vec<(String, String)>,
    pub clang: i32,
    pub cflags: Vec<String>,
    pub defines: Vec<String>,
    pub include_dirs: Vec<String>,
    pub libraries: Vec<String>,
    pub default_configuration: String,
    pub host_arch: String,
    pub target_arch: String,
    pub node_install_npm: bool,
    pub node_install_waf: bool,
    pub node_prefix: String,
    pub node_shared_openssl: bool,
    pub node_shared_js_engine: bool,
    pub node_shared_zlib: bool,
    pub node_use_dtrace: bool,
    pub node_use_etw: bool,
    pub node_use_openssl: bool,
    pub js_engine_no_strict_aliasing: i32,
    pub js_engine_use_snapshot: bool,
    pub visibility: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessWarning {
    pub name: String,
    pub message: String,
    pub code: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EmitWarningOptions {
    pub r#type: Option<String>,
    pub code: Option<String>,
    pub detail: Option<String>,
    pub ctor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessVersions {
    pub node: String,
    pub tsonic_rust: String,
    pub ares: String,
    pub http_parser: String,
    pub modules: String,
    pub openssl: String,
    pub uv: String,
    pub js_engine: String,
    pub zlib: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessIpcState {
    pub connected: bool,
    pub channel: Option<String>,
    pub main_module: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessFinalization {
    pub registered_count: usize,
}

