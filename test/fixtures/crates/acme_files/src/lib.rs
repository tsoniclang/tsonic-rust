//! Deterministic fake provider crate for Rust target tests.

pub fn read_text(path: String) -> String {
    format!("content:{path}")
}

pub fn drain_runtime() {}
