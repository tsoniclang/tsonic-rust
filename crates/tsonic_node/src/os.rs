use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CpuInfo {
    pub model: String,
    pub speed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkInterfaceInfo {
    pub address: String,
    pub family: String,
    pub internal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInfo {
    pub username: String,
    pub homedir: String,
    pub shell: Option<String>,
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
    UserInfo {
        username: std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_default(),
        homedir: homedir().unwrap_or_default(),
        shell: std::env::var("SHELL").ok(),
    }
}

pub fn cpus() -> Vec<CpuInfo> {
    cpuinfo().unwrap_or_else(|| {
        let count = available_parallelism();
        (0..count)
            .map(|_| CpuInfo {
                model: std::env::consts::ARCH.to_string(),
                speed: 0,
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
        let address = interface.ip();
        let internal = interface.is_loopback();
        result
            .entry(interface.name)
            .or_default()
            .push(NetworkInterfaceInfo {
                address: address.to_string(),
                family: if address.is_ipv4() { "IPv4" } else { "IPv6" }.to_string(),
                internal,
            });
    }
    Ok(result)
}

pub fn unavailable(message: &str) -> NodeError {
    NodeError::new("ERR_UNSUPPORTED_OPERATION", message)
}

#[cfg(target_os = "linux")]
fn meminfo_kb(key: &str) -> Option<u64> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    for line in meminfo.lines() {
        let (name, rest) = line.split_once(':')?;
        if name != key {
            continue;
        }
        return rest.split_whitespace().next()?.parse::<u64>().ok();
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn meminfo_kb(_key: &str) -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
fn cpuinfo() -> Option<Vec<CpuInfo>> {
    let text = std::fs::read_to_string("/proc/cpuinfo").ok()?;
    let mut values = Vec::new();
    let mut model = None::<String>;
    let mut speed = None::<u32>;

    for line in text.lines().chain(std::iter::once("")) {
        if line.trim().is_empty() {
            if model.is_some() || speed.is_some() {
                values.push(CpuInfo {
                    model: model
                        .take()
                        .unwrap_or_else(|| std::env::consts::ARCH.to_string()),
                    speed: speed.take().unwrap_or(0),
                });
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        match key {
            "model name" | "Processor" | "Hardware" if model.is_none() => {
                model = Some(value.to_string());
            }
            "cpu MHz" if speed.is_none() => {
                speed = value
                    .parse::<f64>()
                    .ok()
                    .map(|value| value.round().max(0.0) as u32);
            }
            _ => {}
        }
    }

    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

#[cfg(not(target_os = "linux"))]
fn cpuinfo() -> Option<Vec<CpuInfo>> {
    None
}
