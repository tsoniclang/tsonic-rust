//! Closed JS runtime value carrier.

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

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
    Object(Rc<RefCell<JsObject>>),
    Array(Rc<RefCell<JsArray<JsValue>>>),
}

impl JsValue {
    pub const fn undefined() -> Self {
        Self::Undefined
    }

    pub const fn null() -> Self {
        Self::Null
    }

    /// Wraps an object payload in a fresh reference-identity handle.
    pub fn object(object: JsObject) -> Self {
        Self::Object(Rc::new(RefCell::new(object)))
    }

    /// Wraps an array payload in a fresh reference-identity handle.
    pub fn array(values: JsArray<JsValue>) -> Self {
        Self::Array(Rc::new(RefCell::new(values)))
    }

    /// Returns the object handle when the value is an object.
    pub fn as_object(&self) -> Option<&Rc<RefCell<JsObject>>> {
        match self {
            Self::Object(object) => Some(object),
            _ => None,
        }
    }

    /// Returns the array handle when the value is an array.
    pub fn as_array(&self) -> Option<&Rc<RefCell<JsArray<JsValue>>>> {
        match self {
            Self::Array(values) => Some(values),
            _ => None,
        }
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
            Self::Object(value) => value.borrow().inspect(),
            Self::Array(values) => {
                let values = values.borrow();
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
            (Self::Object(left), Self::Object(right)) => Rc::ptr_eq(left, right),
            (Self::Array(left), Self::Array(right)) => Rc::ptr_eq(left, right),
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
            (Self::Object(left), Self::Object(right)) => Rc::ptr_eq(left, right),
            (Self::Array(left), Self::Array(right)) => Rc::ptr_eq(left, right),
            _ => false,
        }
    }
}

impl From<Vec<JsValue>> for JsValue {
    fn from(values: Vec<JsValue>) -> Self {
        Self::array(JsArray::from_dense(values))
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
