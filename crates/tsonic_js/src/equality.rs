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

macro_rules! impl_js_primitive_equality {
    ($($t:ty),* $(,)?) => {
        $(
            impl JsSameValueZero for $t {
                fn same_value_zero(&self, other: &Self) -> bool {
                    self == other
                }
            }

            impl JsStrictEqual for $t {
                fn strict_equal(&self, other: &Self) -> bool {
                    self == other
                }
            }
        )*
    };
}

impl_js_primitive_equality!(
    bool, i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, char, String, &str
);
