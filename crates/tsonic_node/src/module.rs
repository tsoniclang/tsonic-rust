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
        "console",
        "crypto",
        "diagnostics_channel",
        "dns",
        "events",
        "fs",
        "fs/promises",
        "http",
        "net",
        "os",
        "path",
        "process",
        "querystring",
        "stream",
        "string_decoder",
        "timers",
        "url",
        "util",
    ]
}

pub fn create_require(base: impl Into<String>) -> Require {
    Require { base: base.into() }
}
