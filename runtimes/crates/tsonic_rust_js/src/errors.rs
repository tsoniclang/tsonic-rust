pub use tsonic_rust_runtime::{JsError, JsErrorKind};

pub type JsResult<T> = Result<T, JsError>;

pub fn type_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::TypeError, message)
}

pub fn aggregate_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::AggregateError, message)
}

pub fn eval_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::EvalError, message)
}

pub fn reference_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::ReferenceError, message)
}

pub fn range_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::RangeError, message)
}

pub fn syntax_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::SyntaxError, message)
}

pub fn uri_error(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::URIError, message)
}

pub fn unsupported(message: impl Into<String>) -> JsError {
    JsError::new(JsErrorKind::Unsupported, message)
}
