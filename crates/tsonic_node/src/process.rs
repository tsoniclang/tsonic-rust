use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use crate::error::{NodeError, NodeResult};
use crate::events::EventEmitter;
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub name: String,
    pub source_url: String,
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
    }
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
    }
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

pub fn stdout() -> Writable {
    Writable::new()
}

pub fn stderr() -> Writable {
    Writable::new()
}

pub fn stdin_is_tty() -> bool {
    false
}

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

    pub fn emit(&mut self, event: &str, args: &[JsValue]) -> bool {
        self.emitter.emit(event, args)
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
