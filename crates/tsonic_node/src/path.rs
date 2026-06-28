use crate::error::{NodeError, NodeResult};

pub use crate::path_posix::ParsedPath;

#[cfg(windows)]
pub fn sep() -> &'static str {
    crate::path_win32::sep()
}

#[cfg(not(windows))]
pub fn sep() -> &'static str {
    crate::path_posix::sep()
}

#[cfg(windows)]
pub fn delimiter() -> &'static str {
    crate::path_win32::delimiter()
}

#[cfg(not(windows))]
pub fn delimiter() -> &'static str {
    crate::path_posix::delimiter()
}

pub fn is_absolute(path: &str) -> bool {
    platform().is_absolute(path)
}

pub fn normalize(path: &str) -> String {
    platform().normalize(path)
}

pub fn join(parts: &[&str]) -> String {
    platform().join(parts)
}

pub fn resolve(parts: &[&str]) -> NodeResult<String> {
    let mut segments = Vec::new();
    for part in parts {
        if !part.is_empty() {
            segments.push(*part);
        }
    }
    let joined = if segments.iter().any(|part| is_absolute(part)) {
        join(&segments)
    } else {
        let cwd =
            std::env::current_dir().map_err(|error| NodeError::new("ENOENT", error.to_string()))?;
        let cwd = cwd.to_string_lossy().to_string();
        let mut with_cwd = vec![cwd.as_str()];
        with_cwd.extend(segments);
        join(&with_cwd)
    };
    Ok(normalize(&joined))
}

pub fn dirname(path: &str) -> String {
    platform().dirname(path)
}

pub fn basename(path: &str, suffix: Option<&str>) -> String {
    platform().basename(path, suffix)
}

pub fn extname(path: &str) -> String {
    platform().extname(path)
}

pub fn relative(from: &str, to: &str) -> String {
    platform().relative(from, to)
}

pub fn parse(path: &str) -> ParsedPath {
    platform().parse(path)
}

pub fn format(path: &ParsedPath) -> String {
    platform().format(path)
}

pub mod posix {
    pub use crate::path_posix::{
        basename, delimiter, dirname, extname, format, is_absolute, join, normalize, parse,
        relative, sep, ParsedPath,
    };
}

pub mod win32 {
    pub use crate::path_win32::{
        basename, delimiter, dirname, extname, format, is_absolute, join, normalize, parse,
        relative, sep, ParsedPath,
    };
}

struct Platform;

fn platform() -> Platform {
    Platform
}

impl Platform {
    #[cfg(windows)]
    fn is_absolute(&self, path: &str) -> bool {
        crate::path_win32::is_absolute(path)
    }
    #[cfg(not(windows))]
    fn is_absolute(&self, path: &str) -> bool {
        crate::path_posix::is_absolute(path)
    }
    #[cfg(windows)]
    fn normalize(&self, path: &str) -> String {
        crate::path_win32::normalize(path)
    }
    #[cfg(not(windows))]
    fn normalize(&self, path: &str) -> String {
        crate::path_posix::normalize(path)
    }
    #[cfg(windows)]
    fn join(&self, parts: &[&str]) -> String {
        crate::path_win32::join(parts)
    }
    #[cfg(not(windows))]
    fn join(&self, parts: &[&str]) -> String {
        crate::path_posix::join(parts)
    }
    #[cfg(windows)]
    fn dirname(&self, path: &str) -> String {
        crate::path_win32::dirname(path)
    }
    #[cfg(not(windows))]
    fn dirname(&self, path: &str) -> String {
        crate::path_posix::dirname(path)
    }
    #[cfg(windows)]
    fn basename(&self, path: &str, suffix: Option<&str>) -> String {
        crate::path_win32::basename(path, suffix)
    }
    #[cfg(not(windows))]
    fn basename(&self, path: &str, suffix: Option<&str>) -> String {
        crate::path_posix::basename(path, suffix)
    }
    #[cfg(windows)]
    fn extname(&self, path: &str) -> String {
        crate::path_win32::extname(path)
    }
    #[cfg(not(windows))]
    fn extname(&self, path: &str) -> String {
        crate::path_posix::extname(path)
    }
    #[cfg(windows)]
    fn relative(&self, from: &str, to: &str) -> String {
        crate::path_win32::relative(from, to)
    }
    #[cfg(not(windows))]
    fn relative(&self, from: &str, to: &str) -> String {
        crate::path_posix::relative(from, to)
    }
    #[cfg(windows)]
    fn parse(&self, path: &str) -> ParsedPath {
        crate::path_win32::parse(path)
    }
    #[cfg(not(windows))]
    fn parse(&self, path: &str) -> ParsedPath {
        crate::path_posix::parse(path)
    }
    #[cfg(windows)]
    fn format(&self, path: &ParsedPath) -> String {
        crate::path_win32::format(path)
    }
    #[cfg(not(windows))]
    fn format(&self, path: &ParsedPath) -> String {
        crate::path_posix::format(path)
    }
}
