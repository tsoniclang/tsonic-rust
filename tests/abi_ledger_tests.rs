use tsonic_js as js;
use tsonic_node as node;
use tsonic_runtime as rt;

#[test]
fn js_backend_legal_abi_paths_are_emit_ready() {
    let mut dense = vec![1_i32, 2_i32];
    assert_eq!(js::abi::array_dense_push(&mut dense, 3), 3);
    assert_eq!(js::abi::array_dense_at(&dense, -1), Some(&3));
    assert!(js::abi::array_dense_includes(&dense, &2, 0));
    assert_eq!(js::abi::array_dense_index_of(&dense, &3, 0), 2);
    assert_eq!(js::abi::array_dense_join(&dense, ","), "1,2,3");

    let mut out = Vec::new();
    js::abi::console_log_to(&mut out, &[js::abi::JsValue::String("ok".to_string())]).unwrap();
    assert_eq!(String::from_utf8(out).unwrap(), "\"ok\"\n");

    let parsed = js::abi::json_parse(r#"{"ok":true}"#).unwrap();
    let text = js::abi::json_stringify(&parsed).unwrap();
    assert_eq!(text, r#"{"ok":true}"#);

    let mut map = js::abi::JsMap::<f64, &str>::new();
    map.set(f64::NAN, "nan");
    assert_eq!(map.get(&f64::NAN), Some(&"nan"));

    let mut set = js::abi::JsSet::<f64>::new();
    set.add(f64::NAN);
    assert!(set.has(&f64::NAN));

    assert_eq!(
        js::abi::JsDate::from_millis(0.0).to_iso_string().unwrap(),
        "1970-01-01T00:00:00.000Z"
    );
    assert!(js::abi::JsRegExp::new("abc", "").unwrap().test("abc"));

    let buffer = js::abi::ArrayBuffer::new(4);
    assert_eq!(buffer.byte_length(), 4);
    let mut typed = js::abi::Uint8Array::from_vec(vec![1, 2, 3]);
    typed.set_index(1, 9);
    assert_eq!(typed.get(1), Some(9));
}

#[test]
fn node_backend_legal_abi_paths_are_emit_ready() {
    assert_eq!(node::abi::path_join(&["a", "b"]), "a/b");
    assert_eq!(
        node::abi::path_basename("/tmp/file.txt", Some(".txt")),
        "file"
    );
    assert!(!node::abi::os_platform().is_empty());
    assert!(!node::abi::process_arch().is_empty());

    let mut buffer = node::abi::Buffer::from_string("abc", Some("utf8")).unwrap();
    assert_eq!(buffer.len(), 3);
    buffer.set(0, b'z').unwrap();
    assert_eq!(buffer.to_string(Some("utf8")).unwrap(), "zbc");

    let url = node::abi::Url::parse("https://example.test/a?x=1", None).unwrap();
    assert_eq!(url.hostname(), "example.test");
    let mut params = node::abi::UrlSearchParams::new(Some("x=1")).unwrap();
    params.append("x", "2");
    assert_eq!(params.get_all("x"), vec!["1".to_string(), "2".to_string()]);

    assert_eq!(
        node::abi::util_format(
            "%s:%d",
            &[
                js::abi::JsValue::String("x".to_string()),
                js::abi::JsValue::Number(7.0)
            ]
        ),
        "\"x\":7"
    );

    let mut hash = node::abi::Hash::create("sha256").unwrap();
    hash.update_string("abc", Some("utf8")).unwrap();
    assert_eq!(
        hash.digest_string("hex").unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );

    fn returns_unified_result() -> rt::TsonicResult<()> {
        let _ = js::abi::json_parse("{")?;
        Ok(())
    }
    assert!(matches!(
        returns_unified_result(),
        Err(rt::TsonicError::Js { .. })
    ));
}
