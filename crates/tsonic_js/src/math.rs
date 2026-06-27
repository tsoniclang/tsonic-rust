//! Math helper module.

use tsonic_runtime::operators;

pub const E: f64 = std::f64::consts::E;
pub const LN10: f64 = std::f64::consts::LN_10;
pub const LN2: f64 = std::f64::consts::LN_2;
pub const LOG10E: f64 = std::f64::consts::LOG10_E;
pub const LOG2E: f64 = std::f64::consts::LOG2_E;
pub const PI: f64 = std::f64::consts::PI;
pub const SQRT1_2: f64 = std::f64::consts::FRAC_1_SQRT_2;
pub const SQRT2: f64 = std::f64::consts::SQRT_2;

pub fn abs(value: f64) -> f64 {
    value.abs()
}
pub fn acos(value: f64) -> f64 {
    value.acos()
}
pub fn asin(value: f64) -> f64 {
    value.asin()
}
pub fn atan(value: f64) -> f64 {
    value.atan()
}
pub fn atan2(y: f64, x: f64) -> f64 {
    y.atan2(x)
}
pub fn ceil(value: f64) -> f64 {
    value.ceil()
}
pub fn floor(value: f64) -> f64 {
    value.floor()
}
pub fn clz32(value: f64) -> i32 {
    let bits = operators::to_uint32(value);
    bits.leading_zeros() as i32
}
pub fn cos(value: f64) -> f64 {
    value.cos()
}
pub fn exp(value: f64) -> f64 {
    value.exp()
}
pub fn fround(value: f64) -> f32 {
    value as f32
}
pub fn hypot(values: &[f64]) -> f64 {
    let sum = values.iter().fold(0.0_f64, |acc, value| acc + value * value);
    sum.sqrt()
}
pub fn imul(a: i32, b: i32) -> i32 {
    a.wrapping_mul(b)
}
pub fn log(value: f64) -> f64 {
    value.ln()
}
pub fn max(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NEG_INFINITY;
    }
    let mut out = values[0];
    for value in &values[1..] {
        if value.is_nan() {
            return f64::NAN;
        }
        if *value > out || out.is_nan() {
            out = *value;
        }
    }
    out
}
pub fn min(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::INFINITY;
    }
    let mut out = values[0];
    for value in &values[1..] {
        if value.is_nan() {
            return f64::NAN;
        }
        if *value < out || out.is_nan() {
            out = *value;
        }
    }
    out
}
pub fn pow(base: f64, exponent: f64) -> f64 {
    base.powf(exponent)
}
pub fn random() -> f64 {
    // Deterministic local PRNG for Packet B; full crypto-quality source to be decided later.
    // This is intentionally basic and only intended for test-facing runtime support.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.subsec_nanos() as u64);
    ((nanos as f64) / (u64::MAX as f64)).fract()
}
pub fn round(value: f64) -> f64 {
    value.round()
}
pub fn sign(value: f64) -> f64 {
    if value.is_nan() {
        value
    } else if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        value
    }
}
pub fn sin(value: f64) -> f64 {
    value.sin()
}
pub fn sqrt(value: f64) -> f64 {
    value.sqrt()
}
pub fn tan(value: f64) -> f64 {
    value.tan()
}
pub fn trunc(value: f64) -> f64 {
    value.trunc()
}
