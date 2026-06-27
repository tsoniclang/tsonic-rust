#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedPath {
    pub root: String,
    pub dir: String,
    pub base: String,
    pub ext: String,
    pub name: String,
}

pub fn sep() -> &'static str {
    "/"
}

pub fn delimiter() -> &'static str {
    ":"
}

pub fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
}

pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let absolute = is_absolute(path);
    let trailing = path.ends_with('/');
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|last| *last != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            part => parts.push(part),
        }
    }
    let mut out = parts.join("/");
    if absolute {
        out.insert(0, '/');
    }
    if out.is_empty() {
        out = if absolute {
            "/".to_string()
        } else {
            ".".to_string()
        };
    } else if trailing && out != "/" {
        out.push('/');
    }
    out
}

pub fn join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .copied()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    normalize(&joined)
}

pub fn dirname(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(index) => trimmed[..index].to_string(),
        None => ".".to_string(),
    }
}

pub fn basename(path: &str, suffix: Option<&str>) -> String {
    let trimmed = path.trim_end_matches('/');
    let mut base = trimmed.rsplit('/').next().unwrap_or("").to_string();
    if let Some(suffix) = suffix {
        if !suffix.is_empty() && base.ends_with(suffix) {
            base.truncate(base.len() - suffix.len());
        }
    }
    base
}

pub fn extname(path: &str) -> String {
    let base = basename(path, None);
    match base.rfind('.') {
        Some(0) | None => String::new(),
        Some(index) => base[index..].to_string(),
    }
}

pub fn relative(from: &str, to: &str) -> String {
    let from = normalize(from);
    let to = normalize(to);
    if from == to {
        return String::new();
    }
    let from_parts = split_clean(&from);
    let to_parts = split_clean(&to);
    let common = from_parts
        .iter()
        .zip(to_parts.iter())
        .take_while(|(left, right)| left == right)
        .count();
    let mut out = vec![".."; from_parts.len().saturating_sub(common)];
    out.extend(to_parts[common..].iter().copied());
    if out.is_empty() {
        String::new()
    } else {
        out.join("/")
    }
}

pub fn parse(path: &str) -> ParsedPath {
    let root = if is_absolute(path) { "/" } else { "" }.to_string();
    let dir = dirname(path);
    let base = basename(path, None);
    let ext = extname(path);
    let name = if ext.is_empty() {
        base.clone()
    } else {
        base[..base.len() - ext.len()].to_string()
    };
    ParsedPath {
        root,
        dir,
        base,
        ext,
        name,
    }
}

pub fn format(path: &ParsedPath) -> String {
    if !path.dir.is_empty() && path.dir != "." {
        return format!("{}/{}", path.dir.trim_end_matches('/'), path.base);
    }
    format!("{}{}", path.root, path.base)
}

fn split_clean(path: &str) -> Vec<&str> {
    path.split('/').filter(|part| !part.is_empty()).collect()
}
