use tsonic_js::{abi, data_view::DataView, wrappers, JsValue};

#[test]
fn coercive_number_globals_follow_closed_value_rules() {
    assert!(abi::is_nan(&JsValue::Undefined));
    assert!(!abi::is_nan(&JsValue::String(" 42 ".to_string())));
    assert!(abi::is_finite(&JsValue::Bool(true)));
    assert_eq!(abi::to_number(&JsValue::Null), 0.0);
}

#[test]
fn uri_helpers_encode_and_decode_utf8() {
    assert_eq!(abi::encode_uri_component("a b/😀"), "a%20b%2F%F0%9F%98%80");
    assert_eq!(abi::encode_uri("https://x/a b"), "https://x/a%20b");
    assert_eq!(
        abi::decode_uri_component("a%20b%2F%F0%9F%98%80").unwrap(),
        "a b/😀"
    );
    assert_eq!(
        abi::decode_uri_component("%zz").unwrap_err().kind(),
        tsonic_runtime::JsErrorKind::URIError
    );
}

#[test]
fn js_error_subtypes_and_string_raw_are_available() {
    assert_eq!(
        tsonic_js::reference_error("missing").kind(),
        tsonic_runtime::JsErrorKind::ReferenceError
    );
    assert_eq!(
        tsonic_js::eval_error("eval").kind(),
        tsonic_runtime::JsErrorKind::EvalError
    );
    assert_eq!(
        tsonic_js::aggregate_error("many").kind(),
        tsonic_runtime::JsErrorKind::AggregateError
    );
    assert_eq!(tsonic_js::string::raw(&["a", "c"], &["b"]), "abc");
}

#[test]
fn dataview_reads_and_writes_endian_values() {
    let mut view = DataView::new(abi::ArrayBuffer::new(16));
    view.set_uint8(0, 255).unwrap();
    assert_eq!(view.get_uint8(0).unwrap(), 255);
    view.set_int32(1, 0x01020304, false).unwrap();
    assert_eq!(view.get_int32(1, false).unwrap(), 0x01020304);
    assert_eq!(view.get_int32(1, true).unwrap(), 0x04030201);
    view.set_float64(8, 1.5, true).unwrap();
    assert_eq!(view.get_float64(8, true).unwrap(), 1.5);
    assert!(view.get_uint8(100).is_err());
}

#[test]
fn primitive_wrapper_objects_are_closed_value_boxes() {
    assert!(wrappers::BooleanObject(true).value_of());
    assert_eq!(wrappers::StringObject("x".to_string()).value_of(), "x");
    assert_eq!(wrappers::NumberObject(1.5).value_of(), 1.5);
}
