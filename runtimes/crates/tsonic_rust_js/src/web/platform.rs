#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Storage {
    entries: BTreeMap<String, String>,
}

impl Storage {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn length(&self) -> usize {
        self.entries.len()
    }

    pub fn key(&self, index: usize) -> Option<String> {
        self.entries.keys().nth(index).cloned()
    }

    pub fn get_item(&self, key: &str) -> Option<String> {
        self.entries.get(key).cloned()
    }

    pub fn set_item(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.entries.insert(key.into(), value.into());
    }

    pub fn remove_item(&mut self, key: &str) {
        self.entries.remove(key);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Navigator {
    user_agent: String,
    platform: String,
    language: String,
    languages: Vec<String>,
    hardware_concurrency: usize,
}

impl Navigator {
    pub fn new() -> Self {
        Self {
            user_agent: "TsonicRust".to_string(),
            platform: std::env::consts::OS.to_string(),
            language: "en-US".to_string(),
            languages: vec!["en-US".to_string()],
            hardware_concurrency: std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(1),
        }
    }

    pub fn user_agent(&self) -> &str {
        &self.user_agent
    }

    pub fn platform(&self) -> &str {
        &self.platform
    }

    pub fn language(&self) -> &str {
        &self.language
    }

    pub fn languages(&self) -> &[String] {
        &self.languages
    }

    pub fn hardware_concurrency(&self) -> usize {
        self.hardware_concurrency
    }
}

impl Default for Navigator {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportMeta {
    url: String,
    dirname: String,
    filename: String,
    main: bool,
}

impl ImportMeta {
    pub fn new(
        url: impl Into<String>,
        dirname: impl Into<String>,
        filename: impl Into<String>,
        main: bool,
    ) -> Self {
        Self {
            url: url.into(),
            dirname: dirname.into(),
            filename: filename.into(),
            main,
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn dirname(&self) -> &str {
        &self.dirname
    }

    pub fn filename(&self) -> &str {
        &self.filename
    }

    pub fn main(&self) -> bool {
        self.main
    }

    pub fn resolve(&self, specifier: &str) -> String {
        if specifier.starts_with("node:")
            || specifier.starts_with("file:")
            || specifier.starts_with("http://")
            || specifier.starts_with("https://")
        {
            return specifier.to_string();
        }
        if specifier.starts_with('/') {
            return format!("file://{specifier}");
        }
        let base = self.dirname.trim_end_matches('/');
        format!("file://{base}/{specifier}")
    }
}

fn normalize_header_name(key: impl AsRef<str>) -> String {
    key.as_ref().trim().to_ascii_lowercase()
}

fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn dom_exception_code(name: &str) -> u16 {
    match name {
        "IndexSizeError" => DomException::INDEX_SIZE_ERR,
        "DOMStringSizeError" => DomException::DOMSTRING_SIZE_ERR,
        "HierarchyRequestError" => DomException::HIERARCHY_REQUEST_ERR,
        "WrongDocumentError" => DomException::WRONG_DOCUMENT_ERR,
        "InvalidCharacterError" => DomException::INVALID_CHARACTER_ERR,
        "NoDataAllowedError" => DomException::NO_DATA_ALLOWED_ERR,
        "NoModificationAllowedError" => DomException::NO_MODIFICATION_ALLOWED_ERR,
        "NotFoundError" => DomException::NOT_FOUND_ERR,
        "NotSupportedError" => DomException::NOT_SUPPORTED_ERR,
        "InUseAttributeError" => DomException::INUSE_ATTRIBUTE_ERR,
        "InvalidStateError" => DomException::INVALID_STATE_ERR,
        "SyntaxError" => DomException::SYNTAX_ERR,
        "InvalidModificationError" => DomException::INVALID_MODIFICATION_ERR,
        "NamespaceError" => DomException::NAMESPACE_ERR,
        "InvalidAccessError" => DomException::INVALID_ACCESS_ERR,
        "ValidationError" => DomException::VALIDATION_ERR,
        "TypeMismatchError" => DomException::TYPE_MISMATCH_ERR,
        "SecurityError" => DomException::SECURITY_ERR,
        "NetworkError" => DomException::NETWORK_ERR,
        "AbortError" => DomException::ABORT_ERR,
        "URLMismatchError" => DomException::URL_MISMATCH_ERR,
        "QuotaExceededError" => DomException::QUOTA_EXCEEDED_ERR,
        "TimeoutError" => DomException::TIMEOUT_ERR,
        "InvalidNodeTypeError" => DomException::INVALID_NODE_TYPE_ERR,
        "DataCloneError" => DomException::DATA_CLONE_ERR,
        _ => 0,
    }
}
