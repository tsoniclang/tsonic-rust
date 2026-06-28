use crate::error::{NodeError, NodeResult};

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

pub fn unavailable(message: &str) -> NodeError {
    NodeError::new("ERR_UNSUPPORTED_OPERATION", message)
}
