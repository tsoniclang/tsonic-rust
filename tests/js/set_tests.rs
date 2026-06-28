use tsonic_js::JsSet;

#[test]
fn set_preserves_order_and_uniqueness() {
    let mut set = JsSet::new();
    set.add("a".to_string());
    set.add("b".to_string());
    set.add("a".to_string());

    assert_eq!(set.len(), 2);
    assert_eq!(set.values(), vec![&"a".to_string(), &"b".to_string()]);
    assert!(set.delete(&"a".to_string()));
    assert!(!set.has(&"a".to_string()));
}

#[test]
fn set_uses_same_value_zero_for_nan() {
    let mut set = JsSet::new();
    set.add(f64::NAN);
    set.add(f64::NAN);
    assert_eq!(set.len(), 1);
    assert!(set.has(&f64::NAN));
}
