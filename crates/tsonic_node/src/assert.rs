use crate::error::{NodeError, NodeResult};
use tsonic_js::value::JsValue;

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
    NodeError::new("ERR_ASSERTION", message)
}
