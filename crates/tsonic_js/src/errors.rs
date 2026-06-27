pub use tsonic_runtime::{JsError, JsErrorKind};

pub type JsResult<T> = Result<T, JsError>;

pub fn type_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::TypeError, message)
}

pub fn range_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::RangeError, message)
}

pub fn syntax_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::SyntaxError, message)
}

pub fn unsupported(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::Unsupported, message)
}
