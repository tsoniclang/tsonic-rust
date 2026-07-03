//! Fixture capability crate proving non-Node installed capabilities.

pub fn serve(port: i32) -> String {
    format!("superbunapi:{port}")
}
