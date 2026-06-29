use crate::error::{NodeError, NodeResult};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CpuTimes {
    pub user: u64,
    pub nice: u64,
    pub sys: u64,
    pub idle: u64,
    pub irq: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CpuInfo {
    pub model: String,
    pub speed: u32,
    pub times: CpuTimes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkInterfaceInfo {
    pub address: String,
    pub netmask: String,
    pub family: String,
    pub mac: String,
    pub internal: bool,
    pub cidr: Option<String>,
    pub scopeid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInfo {
    pub username: String,
    pub homedir: String,
    pub shell: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInfoOptions {
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriorityConstants {
    pub priority_low: i32,
    pub priority_below_normal: i32,
    pub priority_normal: i32,
    pub priority_above_normal: i32,
    pub priority_high: i32,
    pub priority_highest: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsConstants {
    pub errno: BTreeMap<&'static str, i32>,
    pub signals: BTreeMap<&'static str, i32>,
    pub priority: PriorityConstants,
    pub dlopen: BTreeMap<&'static str, i32>,
    pub uv: BTreeMap<&'static str, i32>,
}

pub fn platform() -> String {
    crate::process::platform()
}

pub fn arch() -> String {
    crate::process::arch()
}

pub fn eol() -> &'static str {
    if cfg!(windows) {
        "\r\n"
    } else {
        "\n"
    }
}

pub fn tmpdir() -> NodeResult<String> {
    Ok(std::env::temp_dir().to_string_lossy().to_string())
}

pub fn homedir() -> Option<String> {
    std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
}

pub fn hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "localhost".to_string())
}

pub fn r#type() -> String {
    if cfg!(target_os = "windows") {
        "Windows_NT"
    } else if cfg!(target_os = "macos") {
        "Darwin"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        std::env::consts::OS
    }
    .to_string()
}

pub fn release() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(value) = std::fs::read_to_string("/proc/sys/kernel/osrelease") {
            return value.trim().to_string();
        }
    }
    String::new()
}

pub fn version() -> String {
    release()
}

pub fn uptime() -> f64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(value) = std::fs::read_to_string("/proc/uptime") {
            if let Some(first) = value.split_whitespace().next() {
                if let Ok(seconds) = first.parse::<f64>() {
                    return seconds;
                }
            }
        }
    }
    0.0
}

pub fn available_parallelism() -> usize {
    std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
}

pub fn machine() -> String {
    std::env::consts::ARCH.to_string()
}

pub fn endianness() -> &'static str {
    if cfg!(target_endian = "little") {
        "LE"
    } else {
        "BE"
    }
}

pub fn dev_null() -> &'static str {
    if cfg!(windows) {
        "\\\\.\\nul"
    } else {
        "/dev/null"
    }
}

pub fn user_info() -> UserInfo {
    user_info_with_options(None)
}

pub fn user_info_with_options(_options: Option<UserInfoOptions>) -> UserInfo {
    UserInfo {
        username: std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_default(),
        homedir: homedir().unwrap_or_default(),
        shell: std::env::var("SHELL").ok(),
        uid: uid(),
        gid: gid(),
    }
}

pub fn cpus() -> Vec<CpuInfo> {
    cpuinfo().unwrap_or_else(|| {
        let count = available_parallelism();
        (0..count)
            .map(|_| CpuInfo {
                model: std::env::consts::ARCH.to_string(),
                speed: 0,
                times: CpuTimes::default(),
            })
            .collect()
    })
}

pub fn loadavg() -> [f64; 3] {
    #[cfg(target_os = "linux")]
    {
        if let Ok(value) = std::fs::read_to_string("/proc/loadavg") {
            let mut parts = value
                .split_whitespace()
                .take(3)
                .filter_map(|part| part.parse::<f64>().ok());
            if let (Some(one), Some(five), Some(fifteen)) =
                (parts.next(), parts.next(), parts.next())
            {
                return [one, five, fifteen];
            }
        }
    }
    [0.0, 0.0, 0.0]
}

pub fn totalmem() -> u64 {
    meminfo_kb("MemTotal").map(|kb| kb * 1024).unwrap_or(0)
}

pub fn freemem() -> u64 {
    meminfo_kb("MemAvailable")
        .or_else(|| meminfo_kb("MemFree"))
        .map(|kb| kb * 1024)
        .unwrap_or(0)
}

pub fn network_interfaces(
) -> NodeResult<std::collections::BTreeMap<String, Vec<NetworkInterfaceInfo>>> {
    let mut result = std::collections::BTreeMap::<String, Vec<NetworkInterfaceInfo>>::new();
    for interface in get_if_addrs::get_if_addrs()
        .map_err(|error| NodeError::new("ERR_OS_NETWORK_INTERFACES", error.to_string()))?
    {
        let (address, netmask, family, cidr, scopeid) = network_interface_parts(&interface.addr);
        let internal = interface.is_loopback();
        result
            .entry(interface.name)
            .or_default()
            .push(NetworkInterfaceInfo {
                address,
                netmask,
                family,
                mac: "00:00:00:00:00:00".to_string(),
                internal,
                cidr,
                scopeid,
            });
    }
    Ok(result)
}

fn network_interface_parts(
    addr: &get_if_addrs::IfAddr,
) -> (String, String, String, Option<String>, Option<u32>) {
    match addr {
        get_if_addrs::IfAddr::V4(value) => {
            let prefix = ipv4_prefix_len(value.netmask);
            (
                value.ip.to_string(),
                value.netmask.to_string(),
                "IPv4".to_string(),
                Some(format!("{}/{}", value.ip, prefix)),
                None,
            )
        }
        get_if_addrs::IfAddr::V6(value) => {
            let prefix = ipv6_prefix_len(value.netmask);
            (
                value.ip.to_string(),
                value.netmask.to_string(),
                "IPv6".to_string(),
                Some(format!("{}/{}", value.ip, prefix)),
                Some(0),
            )
        }
    }
}

fn ipv4_prefix_len(mask: std::net::Ipv4Addr) -> u32 {
    u32::from(mask).count_ones()
}

fn ipv6_prefix_len(mask: std::net::Ipv6Addr) -> u32 {
    u128::from(mask).count_ones()
}

pub fn constants() -> OsConstants {
    OsConstants {
        errno: errno_constants(),
        signals: signal_constants(),
        priority: PriorityConstants {
            priority_low: 19,
            priority_below_normal: 10,
            priority_normal: 0,
            priority_above_normal: -7,
            priority_high: -14,
            priority_highest: -20,
        },
        dlopen: dlopen_constants(),
        uv: BTreeMap::from([("UV_UDP_REUSEADDR", 4)]),
    }
}

pub fn errno_constant(name: &str) -> Option<i32> {
    errno_constants().get(name).copied()
}

pub fn signal_constant(name: &str) -> Option<i32> {
    signal_constants().get(name).copied()
}

pub fn priority_constant(name: &str) -> Option<i32> {
    let priority = constants().priority;
    match name {
        "PRIORITY_LOW" => Some(priority.priority_low),
        "PRIORITY_BELOW_NORMAL" => Some(priority.priority_below_normal),
        "PRIORITY_NORMAL" => Some(priority.priority_normal),
        "PRIORITY_ABOVE_NORMAL" => Some(priority.priority_above_normal),
        "PRIORITY_HIGH" => Some(priority.priority_high),
        "PRIORITY_HIGHEST" => Some(priority.priority_highest),
        _ => None,
    }
}

pub fn dlopen_constant(name: &str) -> Option<i32> {
    dlopen_constants().get(name).copied()
}

pub fn uv_constant(name: &str) -> Option<i32> {
    constants().uv.get(name).copied()
}

pub fn unavailable(message: &str) -> NodeError {
    NodeError::new("ERR_UNSUPPORTED_OPERATION", message)
}

#[cfg(unix)]
fn uid() -> Option<u32> {
    Some(unsafe { libc::getuid() })
}

#[cfg(not(unix))]
fn uid() -> Option<u32> {
    None
}

#[cfg(unix)]
fn gid() -> Option<u32> {
    Some(unsafe { libc::getgid() })
}

#[cfg(not(unix))]
fn gid() -> Option<u32> {
    None
}

