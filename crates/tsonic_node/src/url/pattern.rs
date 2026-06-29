#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UrlPatternOptions {
    pub ignore_case: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UrlPatternInit {
    pub protocol: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub hostname: Option<String>,
    pub port: Option<String>,
    pub pathname: Option<String>,
    pub search: Option<String>,
    pub hash: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UrlPatternInput {
    Pattern(String),
    Init(UrlPatternInit),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrlPatternComponentResult {
    pub input: String,
    pub groups: BTreeMap<String, Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrlPatternResult {
    pub inputs: Vec<String>,
    pub protocol: UrlPatternComponentResult,
    pub username: UrlPatternComponentResult,
    pub password: UrlPatternComponentResult,
    pub hostname: UrlPatternComponentResult,
    pub port: UrlPatternComponentResult,
    pub pathname: UrlPatternComponentResult,
    pub search: UrlPatternComponentResult,
    pub hash: UrlPatternComponentResult,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrlPattern {
    protocol: String,
    username: String,
    password: String,
    hostname: String,
    port: String,
    pathname: String,
    search: String,
    hash: String,
    ignore_case: bool,
}

impl UrlPattern {
    pub fn new(input: UrlPatternInput, options: UrlPatternOptions) -> NodeResult<Self> {
        Self::new_with_base(input, None, options)
    }

    pub fn new_with_base(
        input: UrlPatternInput,
        base_url: Option<&str>,
        options: UrlPatternOptions,
    ) -> NodeResult<Self> {
        let mut init = match input {
            UrlPatternInput::Pattern(pattern) => pattern_to_init(&pattern, base_url)?,
            UrlPatternInput::Init(init) => init,
        };
        if init.base_url.is_none() {
            init.base_url = base_url.map(str::to_string);
        }
        Ok(Self {
            protocol: normalize_pattern_component(init.protocol, "*"),
            username: normalize_pattern_component(init.username, "*"),
            password: normalize_pattern_component(init.password, "*"),
            hostname: normalize_pattern_component(init.hostname, "*"),
            port: normalize_pattern_component(init.port, "*"),
            pathname: normalize_pattern_component(init.pathname, "*"),
            search: normalize_pattern_component(init.search, "*"),
            hash: normalize_pattern_component(init.hash, "*"),
            ignore_case: options.ignore_case,
        })
    }

    pub fn protocol(&self) -> &str {
        &self.protocol
    }

    pub fn username(&self) -> &str {
        &self.username
    }

    pub fn password(&self) -> &str {
        &self.password
    }

    pub fn hostname(&self) -> &str {
        &self.hostname
    }

    pub fn port(&self) -> &str {
        &self.port
    }

    pub fn pathname(&self) -> &str {
        &self.pathname
    }

    pub fn search(&self) -> &str {
        &self.search
    }

    pub fn hash(&self) -> &str {
        &self.hash
    }

    pub fn has_regexp_groups(&self) -> bool {
        false
    }

    pub fn test(&self, input: &str, base_url: Option<&str>) -> bool {
        self.exec(input, base_url).is_some()
    }

    pub fn exec(&self, input: &str, base_url: Option<&str>) -> Option<UrlPatternResult> {
        let url = Url::parse(input, base_url).ok()?;
        let protocol = match_component(
            &self.protocol,
            url.protocol().trim_end_matches(':'),
            self.ignore_case,
        )?;
        let username = match_component(&self.username, &url.username(), self.ignore_case)?;
        let password = match_component(&self.password, &url.password(), self.ignore_case)?;
        let hostname = match_component(&self.hostname, &url.hostname(), self.ignore_case)?;
        let port = match_component(&self.port, &url.port(), self.ignore_case)?;
        let pathname = match_path_component(&self.pathname, &url.pathname(), self.ignore_case)?;
        let search = match_component(
            &self.search,
            url.search().strip_prefix('?').unwrap_or(&url.search()),
            self.ignore_case,
        )?;
        let hash = match_component(
            &self.hash,
            url.hash().strip_prefix('#').unwrap_or(&url.hash()),
            self.ignore_case,
        )?;
        Some(UrlPatternResult {
            inputs: vec![input.to_string()],
            protocol,
            username,
            password,
            hostname,
            port,
            pathname,
            search,
            hash,
        })
    }
}

pub fn url_pattern_can_parse(input: &str, base_url: Option<&str>) -> bool {
    UrlPattern::new_with_base(
        UrlPatternInput::Pattern(input.to_string()),
        base_url,
        UrlPatternOptions::default(),
    )
    .is_ok()
}

pub fn create_object_url(_blob: &crate::buffer::Blob) -> String {
    "blob:tsonic-runtime".to_string()
}

pub fn revoke_object_url(_id: &str) {}

