//! JS-facing closed APIs (Packet A scaffolding).

pub mod array;
pub mod equality;
pub mod errors;
pub mod math;
pub mod number;
pub mod string;

pub use errors::JsResult;
pub use tsonic_runtime::{JsError, JsErrorKind};
