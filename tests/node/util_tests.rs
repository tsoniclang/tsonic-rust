use tsonic_js::date::JsDate;
use tsonic_js::regexp::JsRegExp;
use tsonic_js::web::{AbortController, AbortSignal};
use tsonic_js::JsValue;
use tsonic_js::{ArrayBuffer, Uint8Array};
use tsonic_node::util;

#[test]
fn util_format_and_inspect_closed_values() {
    let output = util::format(
        "%s:%d:%j:%%",
        &[
            JsValue::String("n".to_string()),
            JsValue::Number(3.0),
            JsValue::Bool(true),
        ],
    );
    assert_eq!(output, "\"n\":3:true:%");
    assert_eq!(
        util::format_with_options(&JsValue::Null, "%s", &[JsValue::String("x".to_string())]),
        "\"x\""
    );
    let mut options = util::InspectOptions {
        numeric_separator: true,
        ..util::InspectOptions::default()
    };
    assert_eq!(
        util::format_with_inspect_options(&options, "%d", &[JsValue::Number(1000.0)]),
        "1_000"
    );
    assert_eq!(util::inspect(&JsValue::Null), "null");
    assert_eq!(util::inspect_custom_symbol(), "nodejs.util.inspect.custom");
    assert_eq!(
        util::promisify_custom_symbol(),
        "nodejs.util.promisify.custom"
    );
    assert_eq!(
        util::inspect_with_options(&JsValue::Null, &JsValue::Null),
        "null"
    );
    options.max_string_length = Some(3);
    options.numeric_separator = false;
    assert_eq!(
        util::inspect_with_struct_options(&JsValue::String("abcdef".to_string()), &options),
        "\"ab..."
    );
    assert!(options.custom_inspect);
    assert!(!options.show_proxy);
    assert_eq!(options.max_array_length, Some(100));
    assert_eq!(options.getters, None);
    assert_eq!(
        util::inspect_default_options(),
        util::default_inspect_options()
    );
    assert_eq!(
        util::inspect_context().stylize("x", "red"),
        "\u{1b}[31mx\u{1b}[0m"
    );
    let styles = util::inspect_styles();
    assert!(styles
        .iter()
        .any(|entry| entry.kind == "number" && entry.style == "yellow"));
    let colors = util::inspect_colors();
    assert!(colors
        .iter()
        .any(|entry| entry.style == "cyan" && entry.open == 36 && entry.close == 39));
    let diff = util::diff("a\nb", "a\nc");
    assert_eq!(diff[0].operation, 0);
    assert_eq!(diff[1].operation, -1);
    assert_eq!(diff[2].operation, 1);
    assert!(util::is_deep_strict_equal(&JsValue::Null, &JsValue::Null));
    assert!(util::is_deep_strict_equal_with_options(
        &JsValue::Null,
        &JsValue::Null,
        util::IsDeepStrictEqualOptions {
            skip_prototype: true,
        }
    ));
    assert!(util::types::is_string(&JsValue::String("x".to_string())));
    assert!(util::types::is_number(&JsValue::Number(1.0)));
    assert!(util::types::is_boolean(&JsValue::Bool(true)));
    assert!(util::types::is_null(&JsValue::Null));
    assert!(util::types::is_undefined(&JsValue::Undefined));
    assert!(util::types::is_null_or_undefined(&JsValue::Undefined));
    assert!(!util::types::is_any_array_buffer(&JsValue::Null));
}

#[test]
fn util_text_codecs_control_helpers_and_runtime_predicates() {
    let encoder = util::TextEncoder::new();
    assert_eq!(encoder.encoding(), "utf-8");
    assert_eq!(encoder.encode("hé"), "hé".as_bytes());
    let mut encoded = [0_u8; 4];
    let encode_result = encoder.encode_into("rust", &mut encoded);
    assert_eq!(encode_result.read, 4);
    assert_eq!(encode_result.written, 4);
    assert_eq!(&encoded, b"rust");

    let decoder = util::TextDecoder::new(Some("utf-8"));
    assert_eq!(decoder.encoding(), "utf-8");
    assert!(!decoder.fatal());
    assert!(!decoder.ignore_bom());
    assert_eq!(decoder.decode("hé".as_bytes()), "hé");
    let decoder = util::TextDecoder::new_with_options(Some("utf-8"), true, true);
    assert!(decoder.fatal());
    assert!(decoder.ignore_bom());
    let decoder = util::TextDecoder::new_from_options(
        Some("utf-8"),
        util::TextDecoderOptions {
            fatal: false,
            ignore_bom: true,
        },
    );
    assert_eq!(
        decoder.decode_with_options("ok".as_bytes(), util::TextDecodeOptions { stream: true }),
        "ok"
    );
    assert!(decoder.ignore_bom());

    assert_eq!(
        util::strip_vt_control_characters("\u{1b}[31mred\u{1b}[0m"),
        "red"
    );
    assert_eq!(util::to_usv_string("ok"), "ok");
    assert_eq!(
        util::inherits("Child", "Parent"),
        ("Child".to_string(), "Parent".to_string())
    );
    assert_eq!(util::deprecate(1, "deprecated"), 1);
    assert_eq!(
        util::deprecate_with_options(
            1,
            "deprecated",
            util::DeprecateOptions {
                modify_prototype: true,
            },
        ),
        1
    );
    assert_eq!(util::promisify(2), 2);
    assert_eq!(util::callbackify(3), 3);
    let legacy = util::CustomPromisifyLegacy { __promisify__: 4 };
    assert_eq!(legacy.__promisify__, 4);
    let symbol = util::CustomPromisifySymbol { custom: 5 };
    assert_eq!(symbol.custom, 5);
    let controller = AbortController::new();
    assert!(!util::aborted(&controller.signal()));
    controller.abort(JsValue::String("stop".to_string()));
    assert!(util::aborted(&controller.signal()));
    assert!(util::transferable_abort_signal(&controller.signal()).aborted());
    assert!(!util::transferable_abort_controller().signal().aborted());
    assert!(util::aborted(&AbortSignal::abort(JsValue::Bool(true))));
    let sites = util::get_call_sites();
    assert_eq!(sites[0].get_function_name(), Some("getCallSites"));
    assert_eq!(sites[0].get_line_number(), Some(1));
    assert!(!sites[0].is_eval());
    assert!(!sites[0].is_native());
    let site_objects =
        util::get_call_sites_with_options(util::GetCallSitesOptions { source_map: true });
    assert_eq!(site_objects[0].function_name, "getCallSites");
    assert_eq!(site_objects[0].line_number, 1);
    assert_eq!(util::style_text("red", "x"), "\u{1b}[31mx\u{1b}[0m");
    assert_eq!(
        util::style_text_with_options(
            "green",
            "x",
            &util::StyleTextOptions {
                stream: Some("stderr".to_string()),
                validate_stream: true,
            },
        ),
        "\u{1b}[32mx\u{1b}[0m"
    );
    assert_eq!(util::style_text("unknown", "x"), "x");
    assert_eq!(util::get_system_error_name(2), "ENOENT");
    assert_eq!(util::get_system_error_message(13), "permission denied");
    let error_map = util::get_system_error_map();
    assert!(error_map.iter().any(|entry| entry.code == 17
        && entry.name == "EEXIST"
        && entry.message == "file already exists"));
    assert_eq!(
        util::convert_process_signal_to_exit_code("SIGTERM"),
        Some(143)
    );
    assert_eq!(util::convert_process_signal_to_exit_code("NOPE"), None);
    util::set_trace_sigint(true);

    let logger = util::debuglog("http", &["HTTP"]);
    assert!(logger.enabled());
    assert_eq!(logger.log("listening"), Some("HTTP listening".to_string()));

    let buffer = ArrayBuffer::new(4);
    let typed = Uint8Array::from_vec(vec![1, 2, 3]);
    let date = JsDate::from_millis(0.0);
    let regexp = JsRegExp::new("abc", "").unwrap();
    assert!(util::types::is_array_buffer(&buffer));
    assert!(util::types::is_array_buffer_view(&typed));
    assert!(util::types::is_typed_array(&typed));
    assert!(util::types::is_uint8_array(&typed));
    assert!(util::types::is_date(&date));
    assert!(util::types::is_reg_exp(&regexp));
    assert!(!util::types::is_promise(&JsValue::Null));
    assert!(!util::types::is_native_error(&JsValue::Null));
    assert!(!util::types::is_proxy(&JsValue::Null));
    assert!(util::types::is_boolean_object(&JsValue::Bool(true)));
    assert!(util::types::is_number_object(&JsValue::Number(1.0)));
    assert!(util::types::is_string_object(&JsValue::String(
        "x".to_string()
    )));
    assert!(util::types::is_boxed_primitive(&JsValue::String(
        "x".to_string()
    )));
    assert!(!util::types::is_big_int_object(&JsValue::Null));
    assert!(!util::types::is_symbol_object(&JsValue::Null));
    assert!(!util::types::is_map_iterator(&JsValue::Null));
    assert!(!util::types::is_set_iterator(&JsValue::Null));
    assert!(!util::types::is_weak_map(&JsValue::Null));
    assert!(!util::types::is_weak_set(&JsValue::Null));
    assert!(!util::types::is_generator_object(&JsValue::Null));
    assert!(!util::types::is_generator_function(&JsValue::Null));
    assert!(!util::types::is_async_function(&JsValue::Null));
    assert!(!util::types::is_module_namespace_object(&JsValue::Null));
    assert!(!util::types::is_external(&JsValue::Null));
    assert!(!util::types::is_crypto_key(&JsValue::Null));
    assert!(!util::types::is_key_object(&JsValue::Null));
}

#[test]
fn util_mime_and_parse_args_cover_common_tooling_shapes() {
    let mut mime = util::MIMEType::new("Text/HTML; Charset=utf-8").unwrap();
    assert_eq!(mime.essence(), "text/html");
    assert_eq!(mime.r#type(), "text");
    assert_eq!(mime.subtype(), "html");
    assert_eq!(mime.params().get("charset"), Some("utf-8"));
    mime.params_mut().set("boundary", "abc");
    assert!(mime.to_string().contains("boundary=abc"));
    assert_eq!(mime.to_string_value(), mime.to_string());
    assert_eq!(
        mime.params().to_string_value(),
        "charset=utf-8;boundary=abc"
    );
    assert_eq!(
        mime.params()
            .entries()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect::<Vec<_>>(),
        vec![
            ("charset".to_string(), "utf-8".to_string()),
            ("boundary".to_string(), "abc".to_string()),
        ]
    );
    assert_eq!(
        mime.params()
            .keys()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        vec!["charset".to_string(), "boundary".to_string()]
    );
    assert_eq!(
        mime.params()
            .values()
            .map(ToString::to_string)
            .collect::<Vec<_>>(),
        vec!["utf-8".to_string(), "abc".to_string()]
    );
    mime.params_mut().delete("charset");
    assert!(!mime.params().has("charset"));

    let parsed = util::parse_args(util::ParseArgsConfig {
        args: vec![
            "--name".to_string(),
            "app".to_string(),
            "-v".to_string(),
            "src/index.ts".to_string(),
            "--tag=one".to_string(),
            "--tag=two".to_string(),
        ],
        options: vec![
            (
                "name".to_string(),
                util::ParseArgsOptionDescriptor {
                    option_type: util::ParseArgsOptionType::String,
                    short: None,
                    multiple: false,
                    default: None,
                },
            ),
            (
                "verbose".to_string(),
                util::ParseArgsOptionDescriptor {
                    option_type: util::ParseArgsOptionType::Boolean,
                    short: Some('v'),
                    multiple: false,
                    default: None,
                },
            ),
            (
                "tag".to_string(),
                util::ParseArgsOptionDescriptor {
                    option_type: util::ParseArgsOptionType::String,
                    short: None,
                    multiple: true,
                    default: None,
                },
            ),
        ],
        allow_positionals: true,
        allow_negative: false,
        strict: false,
        tokens: true,
    });
    assert_eq!(
        parsed.values,
        vec![
            ("name".to_string(), vec!["app".to_string()]),
            ("verbose".to_string(), vec!["true".to_string()]),
            (
                "tag".to_string(),
                vec!["one".to_string(), "two".to_string()]
            ),
        ]
    );
    assert_eq!(parsed.positionals, vec!["src/index.ts".to_string()]);
    assert_eq!(
        parsed
            .tokens
            .iter()
            .map(|token| (token.kind.as_str(), token.raw_name.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("option", "--name"),
            ("option", "-v"),
            ("positional", "src/index.ts"),
            ("option", "--tag"),
            ("option", "--tag"),
        ]
    );
    assert!(parsed.tokens[3].inline_value);

    let tokens = util::parse_args_tokens(util::ParseArgsConfig {
        args: vec!["--unknown".to_string()],
        options: Vec::new(),
        allow_positionals: true,
        allow_negative: false,
        strict: true,
        tokens: false,
    });
    assert_eq!(tokens[0].kind, "unknown-option");
    assert_eq!(tokens[0].name.as_deref(), Some("unknown"));

    let env = util::parse_env(
        r#"
        # comment
        A=1
        export B="two words"
        C='literal\ntext'
        D=plain # trailing comment
        E="line\nbreak"
        1BAD=ignored
        "#,
    );
    assert_eq!(env.get("A"), Some(&"1".to_string()));
    assert_eq!(env.get("B"), Some(&"two words".to_string()));
    assert_eq!(env.get("C"), Some(&"literal\\ntext".to_string()));
    assert_eq!(env.get("D"), Some(&"plain".to_string()));
    assert_eq!(env.get("E"), Some(&"line\nbreak".to_string()));
    assert!(!env.contains_key("1BAD"));
}
