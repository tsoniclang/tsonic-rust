use tsonic_js::{json, JsObject, JsValue};

#[test]
fn json_parse_and_stringify_closed_values() {
    let value = json::parse(r#"{"a":1,"b":[true,null]}"#).unwrap();
    let JsValue::Object(object) = value else {
        panic!("expected object");
    };
    assert_eq!(object.get("a"), JsValue::Number(1.0));

    let text = json::stringify(&JsValue::Object(object)).unwrap();
    assert_eq!(text, r#"{"a":1,"b":[true,null]}"#);
}

#[test]
fn json_omits_undefined_object_fields_and_nulls_array_slots() {
    let object =
        JsObject::from_pairs([("keep", JsValue::Number(1.0)), ("skip", JsValue::Undefined)]);
    assert_eq!(
        json::stringify(&JsValue::Object(object)).unwrap(),
        r#"{"keep":1}"#
    );
    assert_eq!(
        json::stringify(&JsValue::from(vec![JsValue::Undefined])).unwrap(),
        "[null]"
    );
}

#[test]
fn json_rejects_invalid_input() {
    assert!(json::parse("{").is_err());
}
