use std::sync::atomic::{AtomicI32, Ordering};

use crate::error::{NodeError, NodeResult};

static EXIT_CODE: AtomicI32 = AtomicI32::new(i32::MIN);

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
