pub use crate::path_posix::ParsedPath;

pub fn sep() -> &'static str {
    "\\"
}

pub fn delimiter() -> &'static str {
    ";"
}

pub fn is_absolute(path: &str) -> bool {
    let path = path.replace('/', "\\");
    path.starts_with("\\\\") || path.starts_with('\\') || path.as_bytes().get(1) == Some(&b':')
}

pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let replaced = path.replace('\\', "/");
    crate::path_posix::normalize(&replaced).replace('/', "\\")
}

pub fn join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .copied()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\\");
    normalize(&joined)
}

pub fn dirname(path: &str) -> String {
    crate::path_posix::dirname(&path.replace('\\', "/")).replace('/', "\\")
}

pub fn basename(path: &str, suffix: Option<&str>) -> String {
    crate::path_posix::basename(&path.replace('\\', "/"), suffix)
}

pub fn extname(path: &str) -> String {
    crate::path_posix::extname(&path.replace('\\', "/"))
}

pub fn relative(from: &str, to: &str) -> String {
    crate::path_posix::relative(&from.replace('\\', "/"), &to.replace('\\', "/")).replace('/', "\\")
}

pub fn parse(path: &str) -> ParsedPath {
    let normalized = path.replace('\\', "/");
    let mut parsed = crate::path_posix::parse(&normalized);
    parsed.root = parsed.root.replace('/', "\\");
    parsed.dir = parsed.dir.replace('/', "\\");
    parsed
}

pub fn format(path: &ParsedPath) -> String {
    crate::path_posix::format(path).replace('/', "\\")
}
