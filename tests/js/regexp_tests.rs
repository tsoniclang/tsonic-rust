use tsonic_js::regexp::JsRegExp;

#[test]
fn regexp_literal_test_and_exec() {
    let mut re = JsRegExp::new("bc", "").unwrap();
    assert!(re.test("abcd"));
    let found = re.exec("abcd").unwrap();
    assert_eq!(found.match_text, "bc");
    assert_eq!(found.index, 1);
}

#[test]
fn regexp_global_updates_last_index() {
    let mut re = JsRegExp::new("a", "g").unwrap();
    assert!(re.test("a-a"));
    assert_eq!(re.last_index(), 1);
    assert!(re.test("a-a"));
    assert_eq!(re.last_index(), 3);
    assert!(!re.test("a-a"));
    assert_eq!(re.last_index(), 0);
}

#[test]
fn regexp_subset_rejects_unsupported_patterns() {
    assert!(JsRegExp::new("\\d+", "").is_err());
    assert!(JsRegExp::new("a", "gg").is_err());
}
