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
        clang: 0,
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

