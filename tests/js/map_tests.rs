use tsonic_js::JsMap;

#[test]
fn map_preserves_insertion_order_and_updates_existing_key() {
    let mut map = JsMap::new();
    map.set("a".to_string(), 1);
    map.set("b".to_string(), 2);
    map.set("a".to_string(), 3);

    assert_eq!(map.len(), 2);
    assert_eq!(map.get(&"a".to_string()), Some(&3));
    assert_eq!(map.keys(), vec![&"a".to_string(), &"b".to_string()]);
    assert!(map.delete(&"b".to_string()));
    assert!(!map.has(&"b".to_string()));
}

#[test]
fn map_uses_same_value_zero_for_nan() {
    let mut map = JsMap::new();
    map.set(f64::NAN, "nan");
    assert_eq!(map.get(&f64::NAN), Some(&"nan"));
    map.set(-0.0, "zero");
    assert_eq!(map.get(&0.0), Some(&"zero"));
}
