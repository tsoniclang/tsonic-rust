use tsonic_js::JsValue;
use tsonic_node::util;

#[test]
fn util_format_and_inspect_closed_values() {
    let output = util::format(
        "%s:%d:%j:%%",
        &[
            JsValue::String("n".to_string()),
            JsValue::Number(3.0),
            JsValue::Bool(true),
        ],
    );
    assert_eq!(output, "\"n\":3:true:%");
    assert_eq!(util::inspect(&JsValue::Null), "null");
    assert!(util::is_deep_strict_equal(&JsValue::Null, &JsValue::Null));
}
