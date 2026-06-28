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

pub fn cwd() -> NodeResult<String> {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))
}

pub fn chdir(path: &str) -> NodeResult<()> {
    std::env::set_current_dir(path).map_err(|error| NodeError::new("ENOENT", error.to_string()))
}

pub fn argv() -> Vec<String> {
    std::env::args().collect()
}

pub fn argv0() -> String {
    argv().first().cloned().unwrap_or_default()
}

pub fn exec_argv() -> Vec<String> {
    Vec::new()
}

pub fn pid() -> u32 {
    std::process::id()
}

pub fn ppid() -> u32 {
    parent_process_id().unwrap_or(0)
}

pub fn getuid() -> Option<u32> {
    #[cfg(unix)]
    {
        Some(unsafe { libc::getuid() })
    }
    #[cfg(not(unix))]
    {
        None
    }
}

pub fn geteuid() -> Option<u32> {
    #[cfg(unix)]
    {
        Some(unsafe { libc::geteuid() })
    }
    #[cfg(not(unix))]
    {
        None
    }
}

pub fn getgid() -> Option<u32> {
    #[cfg(unix)]
    {
        Some(unsafe { libc::getgid() })
    }
    #[cfg(not(unix))]
    {
        None
    }
}

pub fn getegid() -> Option<u32> {
    #[cfg(unix)]
    {
        Some(unsafe { libc::getegid() })
    }
    #[cfg(not(unix))]
    {
        None
    }
}

pub fn getgroups() -> NodeResult<Vec<u32>> {
    getgroups_impl()
}

pub fn kill(pid: u32, signal: Option<i32>) -> NodeResult<bool> {
    kill_impl(pid, signal.unwrap_or(15))
}

pub fn exec_path() -> NodeResult<String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))
}

pub fn platform() -> String {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        std::env::consts::OS
    }
    .to_string()
}

pub fn arch() -> String {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" | "i686" => "ia32",
        other => other,
    }
    .to_string()
}

pub fn version() -> String {
    "tsonic-rust".to_string()
}

pub fn versions() -> Vec<(String, String)> {
    vec![
        ("node".to_string(), version()),
        (
            "tsonic_rust".to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
        ),
    ]
}

pub fn release() -> Release {
    Release {
        name: "tsonic-rust".to_string(),
        source_url: "https://github.com/tsoniclang/tsonic-rust".to_string(),
        headers_url: None,
        lib_url: None,
        lts: None,
    }
}

pub fn title() -> String {
    process_title().lock().unwrap().clone()
}

pub fn set_title(value: &str) {
    *process_title().lock().unwrap() = value.to_string();
}

pub fn features() -> ProcessFeatures {
    ProcessFeatures {
        debug: false,
        inspector: false,
        ipv6: true,
        tls: true,
        tls_alpn: true,
        tls_ocsp: true,
        tls_sni: true,
        uv: false,
        cached_builtins: false,
        require_module: true,
        typescript: Some("transform".to_string()),
    }
}

pub fn config() -> ProcessConfig {
    let target_arch = arch();
    let target_platform = platform();
    ProcessConfig {
        target_defaults: vec![
            ("default_configuration".to_string(), "Release".to_string()),
            ("target_arch".to_string(), target_arch.clone()),
            ("target_platform".to_string(), target_platform),
        ],
        variables: vec![
            ("host_arch".to_string(), std::env::consts::ARCH.to_string()),
            ("host_os".to_string(), std::env::consts::OS.to_string()),
        ],
        cflags: Vec::new(),
        defines: Vec::new(),
        include_dirs: Vec::new(),
        libraries: Vec::new(),
        default_configuration: "Release".to_string(),
        host_arch: std::env::consts::ARCH.to_string(),
        target_arch,
        node_install_npm: false,
        node_install_waf: false,
        node_prefix: String::new(),
        node_shared_openssl: false,
        node_shared_js_engine: false,
        node_shared_zlib: false,
        node_use_dtrace: false,
        node_use_etw: false,
        node_use_openssl: true,
        js_engine_no_strict_aliasing: 0,
        js_engine_use_snapshot: false,
        visibility: "default".to_string(),
    }
}

pub fn allowed_node_environment_flags() -> Vec<&'static str> {
    vec![
        "--enable-source-maps",
        "--no-warnings",
        "--trace-warnings",
        "--unhandled-rejections",
    ]
}

pub fn available_memory() -> u64 {
    os::freemem()
}

pub fn get_active_resources_info() -> Vec<&'static str> {
    vec!["Process"]
}

pub fn emit_warning(message: &str, name: Option<&str>, code: Option<&str>, detail: Option<&str>) {
    warnings().lock().unwrap().push(ProcessWarning {
        name: name.unwrap_or("Warning").to_string(),
        message: message.to_string(),
        code: code.map(str::to_string),
        detail: detail.map(str::to_string),
    });
}

pub fn emit_warning_with_options(message: &str, options: EmitWarningOptions) {
    emit_warning(
        message,
        options.r#type.as_deref(),
        options.code.as_deref(),
        options.detail.as_deref(),
    );
}

pub fn emitted_warnings() -> Vec<ProcessWarning> {
    warnings().lock().unwrap().clone()
}

pub fn clear_warnings() {
    warnings().lock().unwrap().clear();
}

pub fn uptime() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64()
}

pub fn hrtime(previous: Option<(u64, u32)>) -> (u64, u32) {
    let elapsed = START.get_or_init(Instant::now).elapsed();
    let mut seconds = elapsed.as_secs();
    let mut nanos = elapsed.subsec_nanos();
    if let Some((previous_seconds, previous_nanos)) = previous {
        seconds = seconds.saturating_sub(previous_seconds);
        if nanos >= previous_nanos {
            nanos -= previous_nanos;
        } else if seconds > 0 {
            seconds -= 1;
            nanos = 1_000_000_000 + nanos - previous_nanos;
        } else {
            nanos = 0;
        }
    }
    (seconds, nanos)
}

pub fn hrtime_bigint() -> u128 {
    let elapsed = START.get_or_init(Instant::now).elapsed();
    u128::from(elapsed.as_secs()) * 1_000_000_000 + u128::from(elapsed.subsec_nanos())
}

pub fn versions_struct() -> ProcessVersions {
    ProcessVersions {
        node: version(),
        tsonic_rust: env!("CARGO_PKG_VERSION").to_string(),
        ares: String::new(),
        http_parser: String::new(),
        modules: String::new(),
        openssl: String::new(),
        uv: String::new(),
        js_engine: String::new(),
        zlib: String::new(),
    }
}

pub fn memory_usage() -> MemoryUsage {
    let rss = current_rss_bytes().unwrap_or(0);
    MemoryUsage {
        rss,
        heap_total: 0,
        heap_used: 0,
        external: 0,
        array_buffers: 0,
    }
}

pub fn cpu_usage(previous: Option<CpuUsage>) -> CpuUsage {
    let elapsed = START.get_or_init(Instant::now).elapsed();
    let total_micros = elapsed.as_micros() as u64;
    let current = CpuUsage {
        user: total_micros,
        system: 0,
    };
    if let Some(previous) = previous {
        CpuUsage {
            user: current.user.saturating_sub(previous.user),
            system: current.system.saturating_sub(previous.system),
        }
    } else {
        current
    }
}

pub fn resource_usage() -> ResourceUsage {
    let cpu = cpu_usage(None);
    ResourceUsage {
        user_cpu_time: cpu.user,
        system_cpu_time: cpu.system,
        max_rss: memory_usage().rss,
        shared_memory_size: 0,
        unshared_data_size: 0,
        unshared_stack_size: 0,
        minor_page_fault: 0,
        major_page_fault: 0,
        swapped_out: 0,
        fs_read: 0,
        fs_write: 0,
        ipc_sent: 0,
        ipc_received: 0,
        signals_count: 0,
        voluntary_context_switches: 0,
        involuntary_context_switches: 0,
    }
}

pub fn memory_usage_rss() -> u64 {
    memory_usage().rss
}

pub fn constrained_memory() -> u64 {
    available_memory()
}

pub fn thread_cpu_usage(previous: Option<CpuUsage>) -> CpuUsage {
    cpu_usage(previous)
}

pub fn env_get(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub fn env_set(name: &str, value: &str) {
    std::env::set_var(name, value);
}

pub fn env_delete(name: &str) {
    std::env::remove_var(name);
}

pub fn load_env_file(path: &str) -> NodeResult<()> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| NodeError::new("ENOENT", error.to_string()))?;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((name, value)) = trimmed.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"').trim_matches('\'');
        env_set(name.trim(), value);
    }
    Ok(())
}

pub fn exit_code() -> Option<i32> {
    let code = EXIT_CODE.load(Ordering::SeqCst);
    if code == i32::MIN {
        None
    } else {
        Some(code)
    }
}

pub fn set_exit_code(code: i32) {
    EXIT_CODE.store(code, Ordering::SeqCst);
}

pub fn next_tick(callback: impl FnOnce()) {
    callback();
}

pub fn connected() -> bool {
    ipc_state().lock().unwrap().connected
}

pub fn channel() -> Option<String> {
    ipc_state().lock().unwrap().channel.clone()
}

pub fn main_module() -> Option<String> {
    ipc_state().lock().unwrap().main_module.clone()
}

pub fn disconnect() -> NodeResult<()> {
    if !connected() {
        return Err(NodeError::new(
            "ERR_IPC_CHANNEL_CLOSED",
            "process IPC channel is not connected",
        ));
    }
    ipc_state().lock().unwrap().connected = false;
    Ok(())
}

pub fn send(_message: &JsValue) -> NodeResult<bool> {
    if connected() {
        Ok(true)
    } else {
        Err(NodeError::new(
            "ERR_IPC_CHANNEL_CLOSED",
            "process IPC channel is not connected",
        ))
    }
}

pub fn no_deprecation() -> bool {
    false
}

pub fn throw_deprecation() -> bool {
    false
}

pub fn trace_deprecation() -> bool {
    false
}

pub fn trace_process_warnings() -> bool {
    false
}

pub fn has_uncaught_exception_capture_callback() -> bool {
    UNCAUGHT_EXCEPTION_CAPTURE.load(Ordering::SeqCst)
}

pub fn set_uncaught_exception_capture_callback(enabled: bool) {
    UNCAUGHT_EXCEPTION_CAPTURE.store(enabled, Ordering::SeqCst);
}

pub fn add_uncaught_exception_capture_callback() {
    set_uncaught_exception_capture_callback(true);
}

pub fn abort() -> NodeResult<()> {
    Err(NodeError::new(
        "ERR_PROCESS_ABORT_UNSUPPORTED",
        "process.abort is not exposed by the closed generated Rust runtime",
    ))
}

pub fn execve(_file: &str, _args: &[&str], _env: &[(&str, &str)]) -> NodeResult<()> {
    Err(NodeError::new(
        "ERR_PROCESS_EXECVE_UNSUPPORTED",
        "process.execve would replace the native process image and is not exposed",
    ))
}

pub fn finalization() -> ProcessFinalization {
    ProcessFinalization {
        registered_count: FINALIZATION_COUNT.load(Ordering::SeqCst),
    }
}

pub fn finalization_register() {
    FINALIZATION_COUNT.fetch_add(1, Ordering::SeqCst);
}

pub fn finalization_unregister() {
    FINALIZATION_COUNT
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
            value.checked_sub(1)
        })
        .ok();
}

pub fn stdout() -> Writable {
    Writable::new()
}

pub fn stderr() -> Writable {
    Writable::new()
}

pub fn stdin_is_tty() -> bool {
    false
}

pub fn umask(mask: Option<u32>) -> u32 {
    umask_impl(mask)
}

pub fn source_maps_enabled() -> bool {
    false
}

pub fn debug_port() -> u16 {
    0
}

pub fn get_builtin_module(id: &str) -> Option<&'static str> {
    crate::module::builtin_modules()
        .into_iter()
        .find(|module| *module == id || format!("node:{module}") == id)
}

pub fn ref_handle<T>(_value: &T) {}

pub fn unref_handle<T>(_value: &T) {}

#[derive(Default)]
pub struct ProcessEvents {
    emitter: EventEmitter,
}

impl ProcessEvents {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.on(event, listener);
        self
    }

    pub fn add_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.on(event, listener)
    }

    pub fn on_with_id<F>(&mut self, event: impl Into<String>, listener: F) -> usize
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.on_with_id(event, listener)
    }

    pub fn once<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.once(event, listener);
        self
    }

    pub fn prepend_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.prepend_listener(event, listener);
        self
    }

    pub fn prepend_once_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.prepend_once_listener(event, listener);
        self
    }

    pub fn emit(&mut self, event: &str, args: &[JsValue]) -> bool {
        self.emitter.emit(event, args)
    }

    pub fn off_by_id(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.emitter.off_by_id(event, listener_id);
        self
    }

    pub fn remove_listener_by_id(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.emitter.remove_listener_by_id(event, listener_id);
        self
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.emitter.remove_all_listeners(event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<usize> {
        self.emitter.listeners(event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<usize> {
        self.emitter.raw_listeners(event)
    }

    pub fn event_names(&self) -> Vec<String> {
        self.emitter.event_names()
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.emitter.listener_count(event)
    }
}

pub fn exit(code: Option<i32>) -> ! {
    std::process::exit(code.unwrap_or_else(|| exit_code().unwrap_or(0)));
}

#[cfg(target_os = "linux")]
fn parent_process_id() -> Option<u32> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line.strip_prefix("PPid:")?.trim();
        value.parse::<u32>().ok()
    })
}

#[cfg(not(target_os = "linux"))]
fn parent_process_id() -> Option<u32> {
    None
}

#[cfg(unix)]
fn getgroups_impl() -> NodeResult<Vec<u32>> {
    let count = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
    if count < 0 {
        return Err(NodeError::new(
            "ERR_PROCESS_GROUPS",
            std::io::Error::last_os_error().to_string(),
        ));
    }
    let mut groups = vec![0 as libc::gid_t; count as usize];
    let actual = unsafe { libc::getgroups(count, groups.as_mut_ptr()) };
    if actual < 0 {
        return Err(NodeError::new(
            "ERR_PROCESS_GROUPS",
            std::io::Error::last_os_error().to_string(),
        ));
    }
    groups.truncate(actual as usize);
    Ok(groups)
}

#[cfg(not(unix))]
fn getgroups_impl() -> NodeResult<Vec<u32>> {
    Ok(Vec::new())
}

#[cfg(unix)]
fn kill_impl(pid: u32, signal: i32) -> NodeResult<bool> {
    if pid > i32::MAX as u32 {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "pid is outside pid_t range",
        ));
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, signal) };
    if result == 0 {
        Ok(true)
    } else {
        let error = std::io::Error::last_os_error();
        Err(NodeError::new("ESRCH", error.to_string()))
    }
}

#[cfg(not(unix))]
fn kill_impl(_pid: u32, _signal: i32) -> NodeResult<bool> {
    Err(NodeError::new(
        "ERR_FEATURE_UNAVAILABLE",
        "process.kill is currently implemented for Unix targets",
    ))
}

#[cfg(unix)]
fn umask_impl(mask: Option<u32>) -> u32 {
    let current = unsafe { libc::umask(mask.unwrap_or(0) as libc::mode_t) } as u32;
    if mask.is_none() {
        unsafe {
            libc::umask(current as libc::mode_t);
        }
    }
    current
}

#[cfg(not(unix))]
fn umask_impl(_mask: Option<u32>) -> u32 {
    0
}

#[cfg(target_os = "linux")]
fn current_rss_bytes() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages = statm.split_whitespace().nth(1)?.parse::<u64>().ok()?;
    Some(pages * 4096)
}

#[cfg(not(target_os = "linux"))]
fn current_rss_bytes() -> Option<u64> {
    None
}

static PROCESS_TITLE: OnceLock<Mutex<String>> = OnceLock::new();
static WARNINGS: OnceLock<Mutex<Vec<ProcessWarning>>> = OnceLock::new();
static IPC_STATE: OnceLock<Mutex<ProcessIpcState>> = OnceLock::new();
static UNCAUGHT_EXCEPTION_CAPTURE: AtomicBool = AtomicBool::new(false);
static FINALIZATION_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn process_title() -> &'static Mutex<String> {
    PROCESS_TITLE.get_or_init(|| Mutex::new("tsonic-rust".to_string()))
}

fn warnings() -> &'static Mutex<Vec<ProcessWarning>> {
    WARNINGS.get_or_init(|| Mutex::new(Vec::new()))
}

fn ipc_state() -> &'static Mutex<ProcessIpcState> {
    IPC_STATE.get_or_init(|| Mutex::new(ProcessIpcState::default()))
}
