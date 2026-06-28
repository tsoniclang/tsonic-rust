//! Closed JS runtime value carrier.

use std::fmt;

use crate::array::JsArray;
use crate::equality::{same_value_zero_f64, strict_equal_f64, JsSameValueZero, JsStrictEqual};
use crate::object::JsObject;

#[derive(Clone, Debug)]
pub enum JsValue {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Object(JsObject),
    Array(JsArray<Box<JsValue>>),
}

impl JsValue {
    pub const fn undefined() -> Self {
        Self::Undefined
    }

    pub const fn null() -> Self {
        Self::Null
    }

    pub fn is_nullish(&self) -> bool {
        matches!(self, Self::Undefined | Self::Null)
    }

    pub fn inspect(&self) -> String {
        match self {
            Self::Undefined => "undefined".to_string(),
            Self::Null => "null".to_string(),
            Self::Bool(value) => value.to_string(),
            Self::Number(value) => format_js_number(*value),
            Self::String(value) => format!("{value:?}"),
            Self::Object(value) => value.inspect(),
            Self::Array(values) => {
                let body = values
                    .values()
                    .iter()
                    .map(|value| value.map(|value| value.inspect()).unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("[{body}]")
            }
        }
    }
}

impl PartialEq for JsValue {
    fn eq(&self, other: &Self) -> bool {
        self.strict_equal(other)
    }
}

impl Eq for JsValue {}

impl JsSameValueZero for JsValue {
    fn same_value_zero(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Undefined, Self::Undefined) | (Self::Null, Self::Null) => true,
            (Self::Bool(left), Self::Bool(right)) => left == right,
            (Self::Number(left), Self::Number(right)) => same_value_zero_f64(*left, *right),
            (Self::String(left), Self::String(right)) => left == right,
            (Self::Object(left), Self::Object(right)) => left == right,
            (Self::Array(left), Self::Array(right)) => {
                left.len() == right.len()
                    && left
                        .values()
                        .iter()
                        .zip(right.values().iter())
                        .all(|(left, right)| match (left, right) {
                            (Some(left), Some(right)) => left.same_value_zero(right),
                            (None, None) => true,
                            _ => false,
                        })
            }
            _ => false,
        }
    }
}

impl JsStrictEqual for JsValue {
    fn strict_equal(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Undefined, Self::Undefined) | (Self::Null, Self::Null) => true,
            (Self::Bool(left), Self::Bool(right)) => left == right,
            (Self::Number(left), Self::Number(right)) => strict_equal_f64(*left, *right),
            (Self::String(left), Self::String(right)) => left == right,
            (Self::Object(left), Self::Object(right)) => left == right,
            (Self::Array(left), Self::Array(right)) => {
                left.len() == right.len()
                    && left
                        .values()
                        .iter()
                        .zip(right.values().iter())
                        .all(|(left, right)| match (left, right) {
                            (Some(left), Some(right)) => left == right,
                            (None, None) => true,
                            _ => false,
                        })
            }
            _ => false,
        }
    }
}

impl From<Vec<JsValue>> for JsValue {
    fn from(values: Vec<JsValue>) -> Self {
        Self::Array(JsArray::from_dense(
            values.into_iter().map(Box::new).collect(),
        ))
    }
}

impl fmt::Display for JsValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.inspect())
    }
}

fn format_js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == f64::INFINITY {
        return "Infinity".to_string();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".to_string();
    }
    if value == 0.0 && value.is_sign_negative() {
        return "-0".to_string();
    }
    let mut text = value.to_string();
    if text.ends_with(".0") {
        text.truncate(text.len() - 2);
    }
    text
}
