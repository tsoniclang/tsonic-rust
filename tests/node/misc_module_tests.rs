use tsonic_js::JsValue;
use tsonic_node::{assert, perf_hooks, querystring, string_decoder, tty};

#[test]
fn assert_and_perf_hooks_are_closed_runtime_helpers() {
    assert::ok(true, None).unwrap();
    assert::strict_equal(&1, &1, None).unwrap();
    assert::not_strict_equal(&1, &2, None).unwrap();
    assert::deep_strict_equal(&JsValue::Null, &JsValue::Null, None).unwrap();
    assert::not_deep_strict_equal(&JsValue::Null, &JsValue::Undefined, None).unwrap();
    assert!(assert::ok(false, Some("no")).is_err());
    assert!(perf_hooks::performance_now() >= 0.0);
}

#[test]
fn querystring_and_string_decoder_use_existing_closed_parsers() {
    let params = querystring::parse("a=1&a=2");
    assert_eq!(params.get_all("a"), vec!["1".to_string(), "2".to_string()]);
    assert_eq!(querystring::stringify(&params), "a=1&a=2");

    let decoder = string_decoder::StringDecoder::new(Some("utf8"));
    assert_eq!(decoder.write(b"hi").unwrap(), "hi");
    assert_eq!(decoder.end(None).unwrap(), "");
}

#[test]
fn tty_is_explicitly_non_interactive_by_default() {
    assert!(!tty::isatty(1));
}
