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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UrlSearchParams {
    entries: Vec<(String, String)>,
}

impl UrlSearchParams {
    pub fn new(input: Option<&str>) -> NodeResult<Self> {
        let mut params = Self::default();
        if let Some(input) = input {
            let input = input.strip_prefix('?').unwrap_or(input);
            if !input.is_empty() {
                for part in input.split('&') {
                    let (key, value) = part.split_once('=').unwrap_or((part, ""));
                    params.append(&percent_decode(key), &percent_decode(value));
                }
            }
        }
        Ok(params)
    }

    pub fn get(&self, name: &str) -> Option<String> {
        self.entries
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    }

    pub fn get_all(&self, name: &str) -> Vec<String> {
        self.entries
            .iter()
            .filter(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn has(&self, name: &str) -> bool {
        self.entries.iter().any(|(key, _)| key == name)
    }

    pub fn size(&self) -> usize {
        self.entries.len()
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.iter().map(|(key, _)| key.clone()).collect()
    }

    pub fn values(&self) -> Vec<String> {
        self.entries
            .iter()
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn entries(&self) -> Vec<(String, String)> {
        self.entries.clone()
    }

    pub fn sort(&mut self) {
        self.entries.sort_by(|left, right| left.0.cmp(&right.0));
    }

    pub fn for_each(&self, mut callback: impl FnMut(&str, &str)) {
        for (key, value) in &self.entries {
            callback(value, key);
        }
    }

    pub fn from_records(records: &BTreeMap<String, String>) -> Self {
        Self {
            entries: records
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        }
    }

    pub fn append(&mut self, name: &str, value: &str) {
        self.entries.push((name.to_string(), value.to_string()));
    }

    pub fn set(&mut self, name: &str, value: &str) {
        self.delete(name);
        self.append(name, value);
    }

    pub fn delete(&mut self, name: &str) {
        self.entries.retain(|(key, _)| key != name);
    }
}

impl std::fmt::Display for UrlSearchParams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let body = self
            .entries
            .iter()
            .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        write!(f, "{body}")
    }
}

fn parse_absolute_url(input: &str) -> NodeResult<Url> {
    let (protocol_raw, rest) = input
        .split_once("://")
        .ok_or_else(|| NodeError::new("ERR_INVALID_URL", "missing URL protocol"))?;
    let protocol = format!("{protocol_raw}:");
    let (without_hash, hash) = split_marker(rest, '#');
    let (without_search, search) = split_marker(without_hash, '?');
    let (authority, pathname) = match without_search.find('/') {
        Some(index) => (&without_search[..index], &without_search[index..]),
        None => (without_search, "/"),
    };
    let (userinfo, host_part) = authority
        .rsplit_once('@')
        .map(|(user, host)| (Some(user), host))
        .unwrap_or((None, authority));
    let (username, password) = userinfo
        .map(|user| {
            user.split_once(':')
                .map(|(name, pass)| (percent_decode(name), percent_decode(pass)))
                .unwrap_or_else(|| (percent_decode(user), String::new()))
        })
        .unwrap_or_default();
    let (hostname, port) = host_part
        .rsplit_once(':')
        .filter(|(_, port)| port.chars().all(|ch| ch.is_ascii_digit()))
        .map(|(host, port)| (host.to_string(), port.to_string()))
        .unwrap_or_else(|| (host_part.to_string(), String::new()));
    let host = if port.is_empty() {
        hostname.clone()
    } else {
        format!("{hostname}:{port}")
    };
    let href = format!("{}//{}{}{}{}", protocol, authority, pathname, search, hash);
    Ok(Url {
        href,
        protocol,
        username,
        password,
        host,
        hostname,
        port,
        pathname: pathname.to_string(),
        search,
        hash,
    })
}

fn split_marker(value: &str, marker: char) -> (&str, String) {
    match value.find(marker) {
        Some(index) => (&value[..index], value[index..].to_string()),
        None => (value, String::new()),
    }
}

fn join_base(base: &str, input: &str) -> String {
    if input.starts_with('/') {
        if let Some(index) = base.find("://") {
            let rest = &base[index + 3..];
            let authority_end = rest
                .find('/')
                .map(|pos| index + 3 + pos)
                .unwrap_or(base.len());
            return format!("{}{}", &base[..authority_end], input);
        }
    }
    let prefix = base.rsplit_once('/').map(|(dir, _)| dir).unwrap_or(base);
    format!("{prefix}/{input}")
}

pub(crate) fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                if let (Some(high), Some(low)) =
                    (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
                {
                    output.push((high << 4) | low);
                    index += 3;
                } else {
                    output.push(bytes[index]);
                    index += 1;
                }
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

pub(crate) fn percent_encode(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char)
            }
            b' ' => output.push('+'),
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
