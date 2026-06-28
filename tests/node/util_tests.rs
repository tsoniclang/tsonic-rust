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
    assert_eq!(util::inspect(&JsValue::Null), "null");
    assert_eq!(
        util::inspect_with_options(&JsValue::Null, &JsValue::Null),
        "null"
    );
    assert!(util::is_deep_strict_equal(&JsValue::Null, &JsValue::Null));
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

    let decoder = util::TextDecoder::new(Some("utf-8"));
    assert_eq!(decoder.encoding(), "utf-8");
    assert!(!decoder.fatal());
    assert!(!decoder.ignore_bom());
    assert_eq!(decoder.decode("hé".as_bytes()), "hé");

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
    assert_eq!(util::promisify(2), 2);
    assert_eq!(util::callbackify(3), 3);
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
    assert_eq!(util::style_text("red", "x"), "\u{1b}[31mx\u{1b}[0m");
    assert_eq!(util::style_text("unknown", "x"), "x");
    assert_eq!(util::get_system_error_name(2), "ENOENT");
    assert_eq!(util::get_system_error_message(13), "permission denied");

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
}
