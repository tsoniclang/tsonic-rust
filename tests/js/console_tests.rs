use tsonic_js::{console, JsValue};

#[test]
fn console_formats_to_injectable_writer() {
    let args = [JsValue::String("x".to_string()), JsValue::Number(1.0)];
    assert_eq!(console::format_args(&args), "\"x\" 1");

    let mut out = Vec::new();
    console::log_to(&mut out, &args).unwrap();
    assert_eq!(String::from_utf8(out).unwrap(), "\"x\" 1\n");

    let mut err = Vec::new();
    console::error_to(&mut err, &[JsValue::Bool(false)]).unwrap();
    assert_eq!(String::from_utf8(err).unwrap(), "false\n");

    let mut trace = Vec::new();
    console::trace_to(&mut trace, &[JsValue::String("here".to_string())]).unwrap();
    assert_eq!(String::from_utf8(trace).unwrap(), "Trace: \"here\"\n");
}

#[test]
fn console_instance_tracks_counts_timers_and_groups() {
    let mut console = console::Console::new();
    let mut out = Vec::new();

    assert_eq!(console.count_to(&mut out, Some("items")).unwrap(), 1);
    assert_eq!(console.count_to(&mut out, Some("items")).unwrap(), 2);
    console.count_reset(Some("items"));
    assert_eq!(console.count_to(&mut out, Some("items")).unwrap(), 1);
    assert_eq!(
        String::from_utf8(out).unwrap(),
        "items: 1\nitems: 2\nitems: 1\n"
    );

    let mut grouped = Vec::new();
    console
        .group_to(&mut grouped, &[JsValue::String("group".to_string())])
        .unwrap();
    console
        .log_to(&mut grouped, &[JsValue::Number(1.0)])
        .unwrap();
    console.group_end();
    assert_eq!(String::from_utf8(grouped).unwrap(), "\"group\"\n  1\n");

    console.time(Some("load"));
    let mut timing = Vec::new();
    assert!(console
        .time_log_to(
            &mut timing,
            Some("load"),
            &[JsValue::String("phase".to_string())]
        )
        .unwrap()
        .is_some());
    assert!(console
        .time_end_to(&mut timing, Some("load"))
        .unwrap()
        .is_some());
    let timing = String::from_utf8(timing).unwrap();
    assert!(timing.contains("load: "));
    assert!(timing.contains("phase"));
}
