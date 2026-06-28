use tsonic_js as js;
use tsonic_node as node;
use tsonic_runtime as rt;

fn generated_read_config(root: &str) -> rt::TsonicResult<js::abi::JsValue> {
    let path = node::abi::path_join(&[root, "config.json"]);
    let text = node::abi::fs_read_file_sync_string(&path, "utf8")?;
    Ok(js::abi::json_parse(&text)?)
}

fn generated_hash_hex(value: &str) -> rt::TsonicResult<String> {
    let mut hash = node::abi::Hash::create("sha256")?;
    hash.update_string(value, Some("utf8"))?;
    Ok(hash.digest_string("hex")?)
}

#[test]
fn generated_shape_uses_unified_result_and_narrow_helpers() {
    let root = std::env::current_dir()
        .unwrap()
        .join(".temp")
        .join("generated-shape");
    let root_text = root.to_string_lossy().to_string();
    node::abi::fs_mkdir_sync(&root_text, true).unwrap();
    let path = root.join("config.json");
    node::abi::fs_write_file_sync_string(&path.to_string_lossy(), r#"{"ok":true}"#, "utf8")
        .unwrap();

    let value = generated_read_config(&root_text).unwrap();
    let js::abi::JsValue::Object(object) = value else {
        panic!("expected object");
    };
    assert_eq!(object.get("ok"), js::abi::JsValue::Bool(true));
    node::abi::fs_rm_sync(&root_text, true, true).unwrap();
}

#[test]
fn generated_shape_can_mix_node_and_js_errors_with_question_mark() {
    assert_eq!(
        generated_hash_hex("abc").unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );

    let error = generated_read_config("/definitely/missing/tsonic/config/root").unwrap_err();
    assert!(matches!(error, rt::TsonicError::Node { .. }));
}
