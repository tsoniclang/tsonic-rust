//! Dense-array static constructors and brand checks for stage-1 closure.

/// Stage-1 dense helper to represent `Array.from` over strings.
///
/// This keeps a closed behavior with no iterator callbacks.
/// Code-point semantics are used (`.chars()`), not UTF-16 unit splitting.
pub fn from_string(value: &str) -> Vec<String> {
    value.chars().map(|ch| ch.to_string()).collect()
}

/// Temporary compile-time array identity helper for Packet D.
///
/// Packet F will replace this API to operate on `JsValue` carriers.
pub fn is_array<T>(value: &T) -> bool
where
    T: ArrayBrand + ?Sized,
{
    value.is_array_brand()
}

pub fn is_array_value(value: &crate::value::JsValue) -> bool {
    matches!(value, crate::value::JsValue::Array(_))
}

/// Marker trait for known array-like values in Packet D scope.
pub trait ArrayBrand {
    fn is_array_brand(&self) -> bool;
}

impl<T> ArrayBrand for Vec<T> {
    fn is_array_brand(&self) -> bool {
        true
    }
}

impl<T> ArrayBrand for [T] {
    fn is_array_brand(&self) -> bool {
        true
    }
}

impl<T> ArrayBrand for super::JsArray<T> {
    fn is_array_brand(&self) -> bool {
        true
    }
}

impl ArrayBrand for i32 {
    fn is_array_brand(&self) -> bool {
        false
    }
}
