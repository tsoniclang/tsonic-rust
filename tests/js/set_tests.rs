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

#[test]
fn set_iterable_constructor_and_for_each_are_closed() {
    let set = tsonic_js::JsSet::from_values([1, 1, 2]);
    assert_eq!(set.len(), 2);
    let mut seen = Vec::new();
    set.for_each(|value, _, _| seen.push(*value));
    assert_eq!(seen, vec![1, 2]);
}
