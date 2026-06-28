use tsonic_js::json;
use tsonic_js::value::JsValue;

pub fn format(format: &str, args: &[JsValue]) -> String {
    let mut out = String::new();
    let mut chars = format.chars().peekable();
    let mut arg_index = 0;
    while let Some(ch) = chars.next() {
        if ch != '%' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('%') => out.push('%'),
            Some('s') => out.push_str(&next_arg(args, &mut arg_index).inspect()),
            Some('d') => out.push_str(&format_number(next_arg(args, &mut arg_index))),
            Some('j') => {
                let value = next_arg(args, &mut arg_index);
                out.push_str(&json::stringify(value).unwrap_or_else(|_| "[Circular]".to_string()));
            }
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    for value in &args[arg_index..] {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&value.inspect());
    }
    out
}

pub fn inspect(value: &JsValue) -> String {
    value.inspect()
}

pub fn is_deep_strict_equal(left: &JsValue, right: &JsValue) -> bool {
    left == right
}

pub mod types {
    use tsonic_js::value::JsValue;

    pub fn is_boolean(value: &JsValue) -> bool {
        matches!(value, JsValue::Bool(_))
    }

    pub fn is_number(value: &JsValue) -> bool {
        matches!(value, JsValue::Number(_))
    }

    pub fn is_string(value: &JsValue) -> bool {
        matches!(value, JsValue::String(_))
    }

    pub fn is_object(value: &JsValue) -> bool {
        matches!(value, JsValue::Object(_))
    }

    pub fn is_array(value: &JsValue) -> bool {
        matches!(value, JsValue::Array(_))
    }
}

fn next_arg<'a>(args: &'a [JsValue], index: &mut usize) -> &'a JsValue {
    let value = args.get(*index).unwrap_or(&JsValue::Undefined);
    *index += 1;
    value
}

fn format_number(value: &JsValue) -> String {
    match value {
        JsValue::Number(value) => value.to_string(),
        _ => "NaN".to_string(),
    }
}
