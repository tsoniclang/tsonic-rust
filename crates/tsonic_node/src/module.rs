#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Require {
    base: String,
}

impl Require {
    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn resolve(&self, specifier: &str) -> String {
        if specifier.starts_with("./") || specifier.starts_with("../") {
            format!("{}/{}", self.base.trim_end_matches('/'), specifier)
        } else {
            specifier.to_string()
        }
    }
}

pub fn builtin_modules() -> Vec<&'static str> {
    vec![
        "assert",
        "async_hooks",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "events",
        "fs",
        "fs/promises",
        "http",
        "http2",
        "https",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "sqlite",
        "stream",
        "string_decoder",
        "timers",
        "timers/promises",
        "tls",
        "tty",
        "url",
        "util",
        "worker_threads",
        "zlib",
    ]
}

pub fn create_require(base: impl Into<String>) -> Require {
    Require { base: base.into() }
}

pub fn is_builtin(specifier: &str) -> bool {
    let normalized = specifier.strip_prefix("node:").unwrap_or(specifier);
    builtin_modules().contains(&normalized)
}

pub fn sync_builtin_esm_exports() {}

pub fn find_package_json(specifier: &str, base: Option<&str>) -> Option<String> {
    let mut directory = std::path::PathBuf::from(base.unwrap_or("."));
    if directory.is_file() {
        directory.pop();
    }
    loop {
        let candidate = directory.join(specifier).join("package.json");
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
        let direct = directory.join("package.json");
        if specifier == "." && direct.is_file() {
            return Some(direct.to_string_lossy().into_owned());
        }
        if !directory.pop() {
            return None;
        }
    }
}
