//! Equality helpers for JS-compatible comparison behavior.

/// JS SameValueZero comparison.
pub trait JsSameValueZero<Rhs = Self> {
    fn same_value_zero(&self, other: &Rhs) -> bool;
}

/// JS strict equality comparison.
pub trait JsStrictEqual<Rhs = Self> {
    fn strict_equal(&self, other: &Rhs) -> bool;
}

pub fn same_value_zero_f64(left: f64, right: f64) -> bool {
    if left.is_nan() && right.is_nan() {
        return true;
    }
    left == right
}

pub fn strict_equal_f64(left: f64, right: f64) -> bool {
    if left.is_nan() || right.is_nan() {
        return false;
    }
    left == right
}

impl JsSameValueZero for f64 {
    fn same_value_zero(&self, other: &Self) -> bool {
        same_value_zero_f64(*self, *other)
    }
}

impl JsStrictEqual for f64 {
    fn strict_equal(&self, other: &Self) -> bool {
        strict_equal_f64(*self, *other)
    }
}

impl<T> JsSameValueZero for T
where
    T: PartialEq,
{
    fn same_value_zero(&self, other: &Self) -> bool {
        self == other
    }
}

impl<T> JsStrictEqual for T
where
    T: PartialEq,
{
    fn strict_equal(&self, other: &Self) -> bool {
        self == other
    }
}
