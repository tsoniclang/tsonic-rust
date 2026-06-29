fn split_diff_units(value: &str) -> Vec<&str> {
    if value.contains('\n') {
        value.lines().collect()
    } else if value.is_empty() {
        Vec::new()
    } else {
        vec![value]
    }
}

fn next_arg<'a>(args: &'a [JsValue], index: &mut usize) -> &'a JsValue {
    let value = args.get(*index).unwrap_or(&JsValue::Undefined);
    *index += 1;
    value
}

fn set_parsed_arg(result: &mut ParseArgsResult, name: &str, value: String, multiple: bool) {
    if multiple {
        if let Some((_, values)) = result.values.iter_mut().find(|(key, _)| key == name) {
            values.push(value);
        } else {
            result.values.push((name.to_string(), vec![value]));
        }
    } else if let Some((_, values)) = result.values.iter_mut().find(|(key, _)| key == name) {
        *values = vec![value];
    } else {
        result.values.push((name.to_string(), vec![value]));
    }
}

fn format_number(value: &JsValue) -> String {
    match value {
        JsValue::Number(value) => value.to_string(),
        _ => "NaN".to_string(),
    }
}
