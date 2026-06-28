use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CpuInfo {
    pub model: String,
    pub speed: u32,
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

pub fn cpus() -> Vec<CpuInfo> {
    let count = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1);
    (0..count)
        .map(|_| CpuInfo {
            model: std::env::consts::ARCH.to_string(),
            speed: 0,
        })
        .collect()
}

pub fn loadavg() -> [f64; 3] {
    [0.0, 0.0, 0.0]
}

pub fn totalmem() -> u64 {
    0
}

pub fn freemem() -> u64 {
    0
}

pub fn unavailable(message: &str) -> NodeError {
    NodeError::new("ERR_UNSUPPORTED_OPERATION", message)
}
