use crate::value::JsValue;

pub fn is_nan(value: &JsValue) -> bool {
    to_number(value).is_nan()
}

pub fn is_finite(value: &JsValue) -> bool {
    to_number(value).is_finite()
}

pub fn to_number(value: &JsValue) -> f64 {
    match value {
        JsValue::Undefined => f64::NAN,
        JsValue::Null => 0.0,
        JsValue::Bool(value) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        JsValue::Number(value) => *value,
        JsValue::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        JsValue::Object(_) | JsValue::Array(_) => f64::NAN,
    }
}
