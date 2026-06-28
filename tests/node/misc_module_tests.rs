use std::collections::BTreeMap;
use tsonic_js::JsValue;
use tsonic_node::{assert, module, perf_hooks, querystring, string_decoder, tty};

#[test]
fn assert_and_perf_hooks_are_closed_runtime_helpers() {
    assert::ok(true, None).unwrap();
    assert::equal(&1, &1, None).unwrap();
    assert::not_equal(&1, &2, None).unwrap();
    assert::strict_equal(&1, &1, None).unwrap();
    assert::not_strict_equal(&1, &2, None).unwrap();
    assert::deep_equal(&JsValue::Null, &JsValue::Null, None).unwrap();
    assert::deep_strict_equal(&JsValue::Null, &JsValue::Null, None).unwrap();
    assert::not_deep_equal(&JsValue::Null, &JsValue::Undefined, None).unwrap();
    assert::not_deep_strict_equal(&JsValue::Null, &JsValue::Undefined, None).unwrap();
    assert::throws(
        || Err(tsonic_node::error::NodeError::new("E", "boom")),
        None,
    )
    .unwrap();
    assert::does_not_throw(|| Ok(()), None).unwrap();
    assert::rejects(
        || Err(tsonic_node::error::NodeError::new("E", "boom")),
        None,
    )
    .unwrap();
    assert::does_not_reject(|| Ok(()), None).unwrap();
    assert::match_string("hello world", "world", None).unwrap();
    assert::does_not_match_string("hello world", "mars", None).unwrap();
    assert::if_error(None).unwrap();
    assert!(assert::fail(Some("explicit")).is_err());
    assert!(assert::ok(false, Some("no")).is_err());
    let assertion_error = assert::AssertionError::new(assert::AssertionErrorOptions {
        message: None,
        actual: Some(JsValue::Number(1.0)),
        expected: Some(JsValue::Number(2.0)),
        operator: Some("strictEqual".to_string()),
        diff: Some(assert::AssertionDiff::Simple),
    });
    assert_eq!(assertion_error.code, "ERR_ASSERTION");
    assert!(assertion_error.generated_message);
    assert_eq!(assertion_error.operator, "strictEqual");
    assert!(assertion_error.message.contains("strictEqual"));
    assert_eq!(
        assertion_error.clone().into_node_error().code(),
        "ERR_ASSERTION"
    );
    assert!(perf_hooks::performance_now() >= 0.0);
    assert_eq!(perf_hooks::time_origin(), 0.0);
    perf_hooks::clear_marks(None);
    perf_hooks::clear_measures(None);
    perf_hooks::mark("start");
    perf_hooks::mark("end");
    let detailed = perf_hooks::mark_with_detail("detail", Some("payload".to_string()));
    assert_eq!(detailed.detail, Some("payload".to_string()));
    let measure = perf_hooks::measure("duration", Some("start"), Some("end"));
    assert_eq!(measure.name, "duration");
    assert!(measure.duration >= 0.0);
    assert_eq!(measure.detail, None);
    assert_eq!(
        perf_hooks::get_entries_by_name("duration"),
        vec!["duration".to_string()]
    );
    assert_eq!(
        perf_hooks::get_entries_by_type("mark")
            .iter()
            .filter(|entry| entry.name == "start")
            .count(),
        1
    );
    assert_eq!(
        perf_hooks::get_entries_by_name_entries("duration", Some("measure"))[0].entry_type,
        "measure"
    );
    let observed = std::sync::Arc::new(std::sync::Mutex::new(0_usize));
    let observed_ref = std::sync::Arc::clone(&observed);
    let mut observer = perf_hooks::PerformanceObserver::new(move |list| {
        *observed_ref.lock().unwrap() = list.get_entries_by_type("measure").len();
    });
    assert_eq!(
        perf_hooks::PerformanceObserver::supported_entry_types(),
        &["mark", "measure"]
    );
    observer.observe(&["measure"], true);
    assert!(*observed.lock().unwrap() >= 1);
    assert!(!observer.take_records().is_empty());
    observer.disconnect();
    assert!(!observer.connected());
    perf_hooks::clear_marks(Some("start"));
    assert!(perf_hooks::get_entries_by_name("start").is_empty());
    let entries = perf_hooks::get_entries();
    assert!(!entries.is_empty());
    assert!(entries[0].to_json().iter().any(|(name, _)| name == "name"));
    perf_hooks::set_resource_timing_buffer_size(128);
    perf_hooks::clear_resource_timings(None);
    let resource = perf_hooks::PerformanceResourceTiming::new(
        "https://example.test/app.js",
        "fetch",
        1.0,
        3.0,
    );
    let resource = perf_hooks::add_resource_timing(resource);
    assert_eq!(resource.to_entry().entry_type, "resource");
    assert!(resource
        .to_json()
        .iter()
        .any(|(name, _)| name == "initiatorType"));
    assert_eq!(
        perf_hooks::get_entries_by_type("resource")[0].name,
        "https://example.test/app.js"
    );
    perf_hooks::clear_resource_timings(Some("https://example.test/app.js"));
    assert!(perf_hooks::get_entries_by_type("resource").is_empty());
    let utilization = perf_hooks::event_loop_utilization(None);
    assert!(utilization.utilization >= 0.0);
    let delta = perf_hooks::event_loop_utilization(Some(utilization));
    assert!(delta.active >= 0.0);

    let mut histogram = perf_hooks::create_histogram();
    histogram.record(10);
    histogram.record(30);
    assert_eq!(histogram.count(), 2);
    assert_eq!(histogram.min(), 10);
    assert!(histogram.max() >= 30);
    assert!(histogram.mean() >= 10.0);
    assert!(histogram.stddev() >= 0.0);
    assert!(histogram.percentile(50.0) >= 10);
    histogram.record_delta();
    assert_eq!(histogram.count(), 3);
    let mut other = perf_hooks::Histogram::new();
    other.record(100);
    histogram.add(&other);
    assert!(histogram.max() >= 100);
    assert!(histogram.disable());
    histogram.record(200);
    assert!(!histogram.enable());
    histogram.reset();
    assert_eq!(histogram.count(), 0);
    let gc_major = perf_hooks::CONSTANTS.node_performance_gc_major;
    assert!(gc_major > 0);
    let timing = perf_hooks::node_timing();
    assert!(timing.loop_exit >= timing.node_start);
    let (value, entry) = perf_hooks::timerify("work", || 42);
    assert_eq!(value, 42);
    assert_eq!(entry.entry_type, "function");
}

#[test]
fn querystring_and_string_decoder_use_existing_closed_parsers() {
    let params = querystring::parse("a=1&a=2");
    assert_eq!(params.get_all("a"), vec!["1".to_string(), "2".to_string()]);
    assert_eq!(querystring::stringify(&params), "a=1&a=2");
    let parsed = querystring::parse_with_options(
        "a:1;b:2;c:3",
        ";",
        ":",
        querystring::ParseOptions {
            decode_uri_component: querystring::unescape,
            max_keys: 2,
        },
    );
    assert_eq!(parsed.get("a"), Some("1".to_string()));
    assert_eq!(parsed.get("b"), Some("2".to_string()));
    assert_eq!(parsed.get("c"), None);
    let mut records = BTreeMap::new();
    records.insert("hello world".to_string(), "x/y".to_string());
    records.insert("z".to_string(), "last".to_string());
    assert_eq!(
        querystring::stringify_records_with_options(
            &records,
            ";",
            ":",
            querystring::StringifyOptions {
                encode_uri_component: querystring::escape,
            },
        ),
        "hello+world:x%2Fy;z:last"
    );
    assert_eq!(querystring::escape("hello world/%"), "hello+world%2F%25");
    assert_eq!(querystring::unescape("hello+world%2F%25"), "hello world/%");
    assert_eq!(
        querystring::unescape_buffer("hello%20world"),
        b"hello world".to_vec()
    );

    let mut decoder = string_decoder::StringDecoder::new(Some("utf8"));
    assert_eq!(decoder.encoding(), "utf8");
    assert_eq!(decoder.write(b"hi").unwrap(), "hi");
    assert_eq!(decoder.write(&[0xE2]).unwrap(), "");
    assert_eq!(decoder.pending_len(), 1);
    assert_eq!(decoder.write(&[0x82, 0xAC]).unwrap(), "€");
    assert_eq!(decoder.pending_len(), 0);
    assert_eq!(decoder.write(&[0xF0, 0x9F]).unwrap(), "");
    assert_eq!(decoder.end(None).unwrap(), "�");
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

    let payload = module::SourceMapPayload::new(
        3,
        vec!["src/main.ts".to_string()],
        vec!["main".to_string()],
        "",
    );
    let source_map = module::SourceMap::with_decoded_mappings(
        payload.clone(),
        Some(module::SourceMapConstructorOptions::new(Some(vec![12, 20]))),
        vec![module::SourceMapping {
            generated_line: 2,
            generated_column: 4,
            original_source: "src/main.ts".to_string(),
            original_line: 1,
            original_column: 3,
            name: Some("main".to_string()),
        }],
    );
    assert_eq!(source_map.payload(), &payload);
    assert_eq!(source_map.line_lengths(), Some(&[12, 20][..]));
    assert_eq!(
        source_map.find_origin(2, 4),
        Some(module::SourceOrigin {
            file_name: "src/main.ts".to_string(),
            line_number: 1,
            column_number: 3,
        })
    );
    assert_eq!(
        module::set_source_maps_support(true, true),
        module::SourceMapsSupport {
            node_modules: true,
            generated_code: true,
        }
    );
    assert!(module::get_source_maps_support().generated_code);
    let stripped = module::strip_type_script_types(
        "type T = number;\nconst x: number = 1;\nfunction f(y: string) { return y as const; }",
        Some(module::StripTypeScriptTypesOptions {
            mode: module::StripTypeScriptMode::Transform,
            source_map: true,
            source_url: Some("input.ts".to_string()),
        }),
    );
    assert!(!stripped.contains("type T"));
    assert!(stripped.contains("const x= 1;"));
    assert!(stripped.contains("function f(y)"));
    assert!(stripped.contains("sourceURL=input.ts"));
}

#[test]
fn tty_is_explicitly_non_interactive_by_default() {
    assert!(!tty::isatty(1));
    let mut input = tty::ReadStream::new(0);
    assert_eq!(input.fd(), 0);
    assert!(!input.is_tty());
    assert!(!input.is_raw());
    input.set_raw_mode(true);
    assert!(input.is_raw());

    let mut output = tty::WriteStream::with_size(1, 120, 40);
    assert_eq!(output.fd(), 1);
    assert!(!output.is_tty());
    assert_eq!(output.columns(), 120);
    assert_eq!(output.rows(), 40);
    output.set_window_size(100, 30);
    assert_eq!(output.get_window_size(), (100, 30));
    assert_eq!(output.get_color_depth(), 1);
    assert!(!output.has_colors());
    output.set_color_depth(8);
    assert_eq!(output.get_color_depth(), 8);
    assert!(output.has_colors());
    let callback_called = std::cell::Cell::new(false);
    assert!(output.clear_line_with_callback(|| callback_called.set(true)));
    assert!(callback_called.get());
    assert!(output.clear_screen_down());
    assert!(output.cursor_to(5, Some(6)));
    assert_eq!(output.cursor(), (5, 6));
    assert!(output.move_cursor(1, -2));
    assert_eq!(output.cursor(), (6, 4));
}
