fn pattern_to_init(pattern: &str, base_url: Option<&str>) -> NodeResult<UrlPatternInit> {
    if pattern.contains("://") {
        let url = Url::parse(pattern, None)?;
        Ok(UrlPatternInit {
            protocol: Some(url.protocol().trim_end_matches(':').to_string()),
            username: Some(url.username()),
            password: Some(url.password()),
            hostname: Some(url.hostname()),
            port: Some(url.port()),
            pathname: Some(url.pathname()),
            search: Some(url.search().trim_start_matches('?').to_string()),
            hash: Some(url.hash().trim_start_matches('#').to_string()),
            base_url: None,
        })
    } else if pattern.starts_with('/') {
        Ok(UrlPatternInit {
            pathname: Some(pattern.to_string()),
            base_url: base_url.map(str::to_string),
            ..UrlPatternInit::default()
        })
    } else if let Some(base) = base_url {
        let url = Url::parse(pattern, Some(base))?;
        Ok(UrlPatternInit {
            protocol: Some(url.protocol().trim_end_matches(':').to_string()),
            username: Some(url.username()),
            password: Some(url.password()),
            hostname: Some(url.hostname()),
            port: Some(url.port()),
            pathname: Some(url.pathname()),
            search: Some(url.search().trim_start_matches('?').to_string()),
            hash: Some(url.hash().trim_start_matches('#').to_string()),
            base_url: Some(base.to_string()),
        })
    } else {
        Err(NodeError::new(
            "ERR_INVALID_URL_PATTERN",
            "relative URLPattern requires a base URL",
        ))
    }
}

fn normalize_pattern_component(value: Option<String>, default_value: &str) -> String {
    value
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_value.to_string())
}

fn match_component(
    pattern: &str,
    input: &str,
    ignore_case: bool,
) -> Option<UrlPatternComponentResult> {
    let pattern_cmp = comparable(pattern, ignore_case);
    let input_cmp = comparable(input, ignore_case);
    let matches = if pattern == "*" {
        true
    } else if let Some((prefix, suffix)) = pattern_cmp.split_once('*') {
        input_cmp.starts_with(prefix) && input_cmp.ends_with(suffix)
    } else {
        pattern_cmp == input_cmp
    };
    matches.then(|| UrlPatternComponentResult {
        input: input.to_string(),
        groups: BTreeMap::new(),
    })
}

fn match_path_component(
    pattern: &str,
    input: &str,
    ignore_case: bool,
) -> Option<UrlPatternComponentResult> {
    if !pattern.contains(':') {
        return match_component(pattern, input, ignore_case);
    }
    let pattern_segments = pattern.trim_matches('/').split('/').collect::<Vec<_>>();
    let input_segments = input.trim_matches('/').split('/').collect::<Vec<_>>();
    if pattern_segments.len() != input_segments.len() {
        return None;
    }
    let mut groups = BTreeMap::new();
    for (pattern, input) in pattern_segments.iter().zip(input_segments.iter()) {
        if let Some(name) = pattern.strip_prefix(':') {
            groups.insert(name.to_string(), Some((*input).to_string()));
        } else if comparable(pattern, ignore_case) != comparable(input, ignore_case) {
            return None;
        }
    }
    Some(UrlPatternComponentResult {
        input: input.to_string(),
        groups,
    })
}

fn comparable(value: &str, ignore_case: bool) -> String {
    if ignore_case {
        value.to_ascii_lowercase()
    } else {
        value.to_string()
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
