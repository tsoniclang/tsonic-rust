use tsonic_js::JsValue;
use tsonic_node::{assert, module, perf_hooks, querystring, string_decoder, tty};

#[test]
fn assert_and_perf_hooks_are_closed_runtime_helpers() {
    assert::ok(true, None).unwrap();
    assert::strict_equal(&1, &1, None).unwrap();
    assert::not_strict_equal(&1, &2, None).unwrap();
    assert::deep_strict_equal(&JsValue::Null, &JsValue::Null, None).unwrap();
    assert::not_deep_strict_equal(&JsValue::Null, &JsValue::Undefined, None).unwrap();
    assert!(assert::ok(false, Some("no")).is_err());
    assert!(perf_hooks::performance_now() >= 0.0);
    assert_eq!(perf_hooks::time_origin(), 0.0);
    perf_hooks::clear_marks(None);
    perf_hooks::clear_measures(None);
    perf_hooks::mark("start");
    perf_hooks::mark("end");
    let measure = perf_hooks::measure("duration", Some("start"), Some("end"));
    assert_eq!(measure.name, "duration");
    assert!(measure.duration >= 0.0);
    assert_eq!(
        perf_hooks::get_entries_by_name("duration"),
        vec!["duration".to_string()]
    );
    perf_hooks::clear_marks(Some("start"));
    assert!(perf_hooks::get_entries_by_name("start").is_empty());
}

#[test]
fn querystring_and_string_decoder_use_existing_closed_parsers() {
    let params = querystring::parse("a=1&a=2");
    assert_eq!(params.get_all("a"), vec!["1".to_string(), "2".to_string()]);
    assert_eq!(querystring::stringify(&params), "a=1&a=2");
    assert_eq!(querystring::escape("hello world/%"), "hello+world%2F%25");
    assert_eq!(querystring::unescape("hello+world%2F%25"), "hello world/%");
    assert_eq!(
        querystring::unescape_buffer("hello%20world"),
        b"hello world".to_vec()
    );

    let decoder = string_decoder::StringDecoder::new(Some("utf8"));
    assert_eq!(decoder.write(b"hi").unwrap(), "hi");
    assert_eq!(decoder.end(None).unwrap(), "");
}

#[test]
fn module_helpers_cover_safe_common_node_shapes() {
    assert!(module::is_builtin("fs"));
    assert!(module::is_builtin("node:fs/promises"));
    assert!(module::builtin_modules().contains(&"http2"));
    module::sync_builtin_esm_exports();

    let require = module::create_require("/repo/app");
    assert_eq!(require.resolve("./mod.js"), "/repo/app/./mod.js");
    assert_eq!(require.resolve("node:fs"), "node:fs");
}

#[test]
fn tty_is_explicitly_non_interactive_by_default() {
    assert!(!tty::isatty(1));
}
