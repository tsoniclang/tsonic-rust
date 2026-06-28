use tsonic_js::string;
use tsonic_runtime::JsErrorKind;

#[test]
fn utf16_length_and_indexes() {
    assert_eq!(string::js_len("abc"), 3);
    assert_eq!(string::js_len("😀"), 2);
    assert_eq!(string::char_at("abc", 5), "");
    assert_eq!(string::at("abc", 1).as_deref(), Some("b"));
    assert_eq!(string::at("abc", -1).as_deref(), Some("c"));
    assert_eq!(string::at("abc", 9), None);
}

#[test]
fn utf16_code_units_and_points() {
    assert_eq!(string::char_code_at("😀", 0), Some(0xD83D as f64));
    assert_eq!(string::char_code_at("😀", 1), Some(0xDE00 as f64));
    assert_eq!(string::code_point_at("😀", 0), Some(0x1F600));
    assert_eq!(string::code_point_at("😀", 1), Some(0xDE00));
}

#[test]
fn slice_and_substring_behavior() {
    assert_eq!(string::slice("javascript", 1, Some(3)), "av");
    assert_eq!(string::slice("javascript", -3, None), "ipt");
    assert_eq!(string::substring("abc", 2, Some(0)), "ab");
    assert_eq!(string::slice("abc", 2, Some(1)), "");
    assert_eq!(string::substr("javascript", 4, Some(6)), "script");
    assert_eq!(string::substr("javascript", -6, Some(3)), "scr");
}

#[test]
fn search_and_replace() {
    assert!(string::includes("array", "ra", 0));
    assert!(!string::includes("array", "RA", 0));
    assert!(string::starts_with("array", "ar", 0));
    assert!(string::starts_with("array", "ar", -5));
    assert!(string::starts_with("array", "", 3));
    assert!(string::ends_with("array", "ay", None));
    assert_eq!(string::replace("hello", "ll", "yy"), "heyyo");
}

#[test]
fn split_and_repeat_and_trim() {
    assert_eq!(string::split("a,b,c", ",", None), vec!["a", "b", "c"]);
    assert_eq!(string::split("abc", "", Some(2)), vec!["a", "b"]);
    assert_eq!(string::split("a,,c", ",", None), vec!["a", "", "c"]);
    assert_eq!(string::repeat("x", 3).as_deref(), Ok("xxx"));
    assert_eq!(
        string::repeat("x", -1).unwrap_err().kind(),
        JsErrorKind::RangeError
    );
    assert_eq!(string::trim("  hi  "), "hi");
}

#[test]
fn pad_helpers_and_case() {
    assert_eq!(string::pad_start("5", 3, "0"), "005");
    assert_eq!(string::pad_end("5", 3, "0"), "500");
    assert_eq!(string::to_lower_case("AbC"), "abc");
    assert_eq!(string::to_upper_case("AbC"), "ABC");
}

#[test]
fn constructors() {
    assert_eq!(string::from_char_code(&[0x41, 0x42]), "AB");
    assert_eq!(string::from_code_point(&[0x1f600]).as_deref(), Ok("😀"));
    assert_eq!(
        string::from_code_point(&[0xD800]).unwrap_err().kind(),
        JsErrorKind::RangeError
    );
}

#[test]
fn search_edge_cases() {
    assert_eq!(string::index_of("abc", "", 10), 3);
    assert_eq!(string::index_of("abc", "z", -10), -1);
    assert_eq!(string::last_index_of("banana", "ana", Some(-1)), -1);
    assert_eq!(string::last_index_of("banana", "ana", Some(-10)), -1);
    assert!(string::includes("", "", 0));
    assert!(!string::includes("a", "a", 1));
}

#[test]
fn conversion_helpers() {
    assert_eq!(string::to_lower_case("HELLO"), "hello");
    assert_eq!(string::to_upper_case("hello"), "HELLO");
    assert_eq!(string::char_at("😀", 5), "");
    assert_eq!(string::at("😀", 1).as_deref(), Some("\u{FFFD}"));
    assert_eq!(string::code_point_at("😀", 0), Some(0x1f600));
    assert_eq!(string::code_point_at("😀", 1), Some(0xDE00));
}
