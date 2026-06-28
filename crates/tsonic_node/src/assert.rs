use crate::error::{NodeError, NodeResult};
use tsonic_js::value::JsValue;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssertionDiff {
    Simple,
    Full,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssertionErrorOptions {
    pub message: Option<String>,
    pub actual: Option<JsValue>,
    pub expected: Option<JsValue>,
    pub operator: Option<String>,
    pub diff: Option<AssertionDiff>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssertionError {
    pub code: &'static str,
    pub message: String,
    pub actual: Option<JsValue>,
    pub expected: Option<JsValue>,
    pub operator: String,
    pub generated_message: bool,
    pub diff: Option<AssertionDiff>,
}

impl AssertionError {
    pub fn new(options: AssertionErrorOptions) -> Self {
        let operator = options.operator.unwrap_or_else(|| "fail".to_string());
        let generated_message = options.message.is_none();
        let message = options.message.unwrap_or_else(|| {
            default_assertion_message(
                options.actual.as_ref(),
                options.expected.as_ref(),
                &operator,
            )
        });
        Self {
            code: "ERR_ASSERTION",
            message,
            actual: options.actual,
            expected: options.expected,
            operator,
            generated_message,
            diff: options.diff,
        }
    }

    pub fn into_node_error(self) -> NodeError {
        NodeError::new(self.code, self.message)
    }
}

impl std::fmt::Display for AssertionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AssertionError {}

pub fn fail(message: Option<&str>) -> NodeResult<()> {
    Err(assertion_error(message.unwrap_or("Failed")))
}

pub fn ok(value: bool, message: Option<&str>) -> NodeResult<()> {
    if value {
        Ok(())
    } else {
        Err(assertion_error(message.unwrap_or("assertion failed")))
    }
}

pub fn equal<T>(left: &T, right: &T, message: Option<&str>) -> NodeResult<()>
where
    T: PartialEq + std::fmt::Debug,
{
    strict_equal(left, right, message)
}

pub fn not_equal<T>(left: &T, right: &T, message: Option<&str>) -> NodeResult<()>
where
    T: PartialEq + std::fmt::Debug,
{
    not_strict_equal(left, right, message)
}

pub fn strict_equal<T>(left: &T, right: &T, message: Option<&str>) -> NodeResult<()>
where
    T: PartialEq + std::fmt::Debug,
{
    if left == right {
        Ok(())
    } else {
        Err(assertion_error(
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("expected {left:?} to strictly equal {right:?}")),
        ))
    }
}

pub fn not_strict_equal<T>(left: &T, right: &T, message: Option<&str>) -> NodeResult<()>
where
    T: PartialEq + std::fmt::Debug,
{
    if left != right {
        Ok(())
    } else {
        Err(assertion_error(
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("expected {left:?} to not strictly equal {right:?}")),
        ))
    }
}

pub fn deep_equal(left: &JsValue, right: &JsValue, message: Option<&str>) -> NodeResult<()> {
    deep_strict_equal(left, right, message)
}

pub fn not_deep_equal(left: &JsValue, right: &JsValue, message: Option<&str>) -> NodeResult<()> {
    not_deep_strict_equal(left, right, message)
}

pub fn deep_strict_equal(left: &JsValue, right: &JsValue, message: Option<&str>) -> NodeResult<()> {
    if left == right {
        Ok(())
    } else {
        Err(assertion_error(
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("expected {left} to deeply strictly equal {right}")),
        ))
    }
}

pub fn not_deep_strict_equal(
    left: &JsValue,
    right: &JsValue,
    message: Option<&str>,
) -> NodeResult<()> {
    if left != right {
        Ok(())
    } else {
        Err(assertion_error(
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("expected {left} to not deeply strictly equal {right}")),
        ))
    }
}

pub fn if_error(value: Option<&NodeError>) -> NodeResult<()> {
    match value {
        Some(error) => Err(assertion_error(format!(
            "ifError got unwanted exception: {error}"
        ))),
        None => Ok(()),
    }
}

pub fn throws(callback: impl FnOnce() -> NodeResult<()>, message: Option<&str>) -> NodeResult<()> {
    match callback() {
        Ok(()) => Err(assertion_error(
            message.unwrap_or("Missing expected exception"),
        )),
        Err(_) => Ok(()),
    }
}

pub fn does_not_throw(
    callback: impl FnOnce() -> NodeResult<()>,
    message: Option<&str>,
) -> NodeResult<()> {
    match callback() {
        Ok(()) => Ok(()),
        Err(error) => Err(assertion_error(
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("Got unwanted exception: {error}")),
        )),
    }
}

pub fn rejects(callback: impl FnOnce() -> NodeResult<()>, message: Option<&str>) -> NodeResult<()> {
    throws(callback, message)
}

pub fn does_not_reject(
    callback: impl FnOnce() -> NodeResult<()>,
    message: Option<&str>,
) -> NodeResult<()> {
    does_not_throw(callback, message)
}

pub fn match_string(actual: &str, pattern: &str, message: Option<&str>) -> NodeResult<()> {
    if actual.contains(pattern) {
        Ok(())
    } else {
        Err(assertion_error(
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("expected `{actual}` to match `{pattern}`")),
        ))
    }
}

pub fn does_not_match_string(actual: &str, pattern: &str, message: Option<&str>) -> NodeResult<()> {
    if actual.contains(pattern) {
        Err(assertion_error(
            message
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("expected `{actual}` to not match `{pattern}`")),
        ))
    } else {
        Ok(())
    }
}

fn assertion_error(message: impl Into<String>) -> NodeError {
    AssertionError::new(AssertionErrorOptions {
        message: Some(message.into()),
        actual: None,
        expected: None,
        operator: Some("fail".to_string()),
        diff: None,
    })
    .into_node_error()
}

fn default_assertion_message(
    actual: Option<&JsValue>,
    expected: Option<&JsValue>,
    operator: &str,
) -> String {
    match (actual, expected) {
        (Some(actual), Some(expected)) => {
            format!("Expected {actual} {operator} {expected}")
        }
        (Some(actual), None) => format!("Assertion failed for {actual}"),
        _ => "Assertion failed".to_string(),
    }
}
