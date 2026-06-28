use tsonic_js::{JsObject, JsValue};

#[test]
fn object_own_properties_preserve_order() {
    let mut object = JsObject::new();
    object.set("b", JsValue::Number(2.0));
    object.set("a", JsValue::Number(1.0));
    object.set("b", JsValue::Number(3.0));

    assert_eq!(object.get("b"), JsValue::Number(3.0));
    assert_eq!(object.get("missing"), JsValue::Undefined);
    assert!(object.has_own_property("a"));
    assert_eq!(object.keys(), vec!["b", "a"]);
    assert!(object.delete("a"));
    assert_eq!(object.keys(), vec!["b"]);
}

#[test]
fn object_assign_copies_left_to_right() {
    let mut target = JsObject::from_pairs([("x", JsValue::Number(1.0))]);
    let first = JsObject::from_pairs([("x", JsValue::Number(2.0))]);
    let second = JsObject::from_pairs([("y", JsValue::Bool(true))]);
    target.assign(&[first, second]);

    assert_eq!(target.entries().len(), 2);
    assert_eq!(target.get("x"), JsValue::Number(2.0));
    assert_eq!(target.get("y"), JsValue::Bool(true));
}
