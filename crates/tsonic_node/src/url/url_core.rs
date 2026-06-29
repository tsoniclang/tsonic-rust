use crate::error::{NodeError, NodeResult};
use crate::punycode;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Url {
    href: String,
    protocol: String,
    username: String,
    password: String,
    host: String,
    hostname: String,
    port: String,
    pathname: String,
    search: String,
    hash: String,
}

impl Url {
    pub fn parse(input: &str, base: Option<&str>) -> NodeResult<Self> {
        let input = if input.contains("://") {
            input.to_string()
        } else if let Some(base) = base {
            join_base(base, input)
        } else {
            return Err(NodeError::new(
                "ERR_INVALID_URL",
                "relative URL without base",
            ));
        };
        parse_absolute_url(&input)
    }

    pub fn href(&self) -> String {
        self.href.clone()
    }

    pub fn protocol(&self) -> String {
        self.protocol.clone()
    }

    pub fn username(&self) -> String {
        self.username.clone()
    }

    pub fn password(&self) -> String {
        self.password.clone()
    }

    pub fn host(&self) -> String {
        self.host.clone()
    }

    pub fn hostname(&self) -> String {
        self.hostname.clone()
    }

    pub fn port(&self) -> String {
        self.port.clone()
    }

    pub fn pathname(&self) -> String {
        self.pathname.clone()
    }

    pub fn search(&self) -> String {
        self.search.clone()
    }

    pub fn hash(&self) -> String {
        self.hash.clone()
    }

    pub fn origin(&self) -> String {
        if self.protocol == "file:" {
            "null".to_string()
        } else {
            format!("{}//{}", self.protocol, self.host)
        }
    }

    pub fn search_params(&self) -> NodeResult<UrlSearchParams> {
        UrlSearchParams::new(Some(self.search.strip_prefix('?').unwrap_or(&self.search)))
    }

    pub fn to_json(&self) -> String {
        self.href()
    }

    pub fn set_hash(&mut self, value: &str) {
        self.hash = if value.is_empty() || value.starts_with('#') {
            value.to_string()
        } else {
            format!("#{value}")
        };
        self.rebuild_href();
    }

    pub fn set_search(&mut self, value: &str) {
        self.search = if value.is_empty() || value.starts_with('?') {
            value.to_string()
        } else {
            format!("?{value}")
        };
        self.rebuild_href();
    }

    pub fn set_pathname(&mut self, value: &str) {
        self.pathname = if value.starts_with('/') {
            value.to_string()
        } else {
            format!("/{value}")
        };
        self.rebuild_href();
    }

    fn rebuild_href(&mut self) {
        self.href = format!(
            "{}//{}{}{}{}",
            self.protocol, self.host, self.pathname, self.search, self.hash
        );
    }
}

impl std::fmt::Display for Url {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.href)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyUrlObject {
    pub href: String,
    pub protocol: String,
    pub slashes: bool,
    pub auth: String,
    pub host: String,
    pub port: String,
    pub hostname: String,
    pub hash: String,
    pub search: String,
    pub query: String,
    pub pathname: String,
    pub path: String,
}

pub type UrlObject = LegacyUrlObject;
pub type UrlWithStringQuery = LegacyUrlObject;
pub type UrlWithParsedQuery = LegacyUrlObject;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct UrlFormatOptions {
    pub auth: Option<bool>,
    pub fragment: Option<bool>,
    pub search: Option<bool>,
    pub unicode: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FileUrlToPathOptions {
    pub windows: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PathToFileUrlOptions {
    pub windows: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpOptions {
    pub protocol: String,
    pub hostname: String,
    pub port: Option<u16>,
    pub path: String,
    pub auth: String,
}

pub fn can_parse(input: &str, base: Option<&str>) -> bool {
    Url::parse(input, base).is_ok()
}

pub fn parse(
    input: &str,
    parse_query_string: bool,
    slashes_denote_host: bool,
) -> NodeResult<LegacyUrlObject> {
    let url = if input.contains("://") {
        Url::parse(input, None)?
    } else if slashes_denote_host && input.starts_with("//") {
        Url::parse(&format!("http:{input}"), None)?
    } else {
        Url::parse(input, Some("http://localhost"))?
    };
    let query = url
        .search
        .strip_prefix('?')
        .unwrap_or(&url.search)
        .to_string();
    let auth = match (url.username.is_empty(), url.password.is_empty()) {
        (true, _) => String::new(),
        (false, true) => url.username.clone(),
        (false, false) => format!("{}:{}", url.username, url.password),
    };
    let query_value = if parse_query_string {
        UrlSearchParams::new(Some(&query))?.to_string()
    } else {
        query
    };
    Ok(LegacyUrlObject {
        href: url.href.clone(),
        protocol: url.protocol.clone(),
        slashes: true,
        auth,
        host: url.host.clone(),
        port: url.port.clone(),
        hostname: url.hostname.clone(),
        hash: url.hash.clone(),
        search: url.search.clone(),
        query: query_value,
        pathname: url.pathname.clone(),
        path: format!("{}{}", url.pathname, url.search),
    })
}

pub fn format(value: &LegacyUrlObject) -> String {
    let mut result = String::new();
    result.push_str(&value.protocol);
    if value.slashes {
        result.push_str("//");
    }
    if !value.auth.is_empty() {
        result.push_str(&value.auth);
        result.push('@');
    }
    result.push_str(&value.host);
    result.push_str(&value.pathname);
    result.push_str(&value.search);
    result.push_str(&value.hash);
    result
}

pub fn resolve(from: &str, to: &str) -> NodeResult<String> {
    Ok(Url::parse(to, Some(from))?.href())
}

pub fn domain_to_ascii(domain: &str) -> String {
    punycode::to_ascii(domain)
}

pub fn domain_to_unicode(domain: &str) -> String {
    punycode::to_unicode(domain)
}

pub fn url_to_http_options(url: &Url) -> HttpOptions {
    HttpOptions {
        protocol: url.protocol(),
        hostname: url.hostname(),
        port: url.port().parse::<u16>().ok(),
        path: format!("{}{}", url.pathname(), url.search()),
        auth: match (url.username.is_empty(), url.password.is_empty()) {
            (true, _) => String::new(),
            (false, true) => url.username.clone(),
            (false, false) => format!("{}:{}", url.username, url.password),
        },
    }
}

pub fn path_to_file_url(path: &str) -> Url {
    let mut pathname = path.replace('\\', "/");
    if !pathname.starts_with('/') {
        pathname = format!("/{pathname}");
    }
    Url::parse(&format!("file://{pathname}"), None).unwrap()
}

pub fn file_url_to_path(url: &Url) -> NodeResult<String> {
    if url.protocol() != "file:" {
        return Err(NodeError::new(
            "ERR_INVALID_URL_SCHEME",
            "expected file: URL",
        ));
    }
    Ok(url.pathname())
}
