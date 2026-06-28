use tsonic_js::{console, JsValue};

#[test]
fn console_formats_to_injectable_writer() {
    let args = [JsValue::String("x".to_string()), JsValue::Number(1.0)];
    assert_eq!(console::format_args(&args), "\"x\" 1");

    let mut out = Vec::new();
    console::log_to(&mut out, &args).unwrap();
    assert_eq!(String::from_utf8(out).unwrap(), "\"x\" 1\n");

    let mut err = Vec::new();
    console::error_to(&mut err, &[JsValue::Bool(false)]).unwrap();
    assert_eq!(String::from_utf8(err).unwrap(), "false\n");
}
