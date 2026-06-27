//! JS-facing closed APIs (Packet A scaffolding).

pub mod errors;
pub mod equality;
pub mod math;
pub mod number;
pub mod string;
pub mod array;

pub use errors::JsResult;
pub use tsonic_runtime::{JsError, JsErrorKind};
