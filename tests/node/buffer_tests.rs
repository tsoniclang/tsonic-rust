use tsonic_node::buffer::Buffer;

#[test]
fn buffer_encodings_and_views() {
    let buffer = Buffer::from_string("6869", Some("hex")).unwrap();
    assert_eq!(buffer.to_string(Some("utf8")).unwrap(), "hi");
    assert_eq!(buffer.to_string(Some("base64")).unwrap(), "aGk=");
    assert_eq!(Buffer::byte_length("aGk=", Some("base64")).unwrap(), 2);

    let mut view = buffer.slice(1, None);
    view.set(0, b'o').unwrap();
    assert_eq!(buffer.to_string(Some("utf8")).unwrap(), "ho");
}

#[test]
fn buffer_compare_equals_concat_and_json() {
    let one = Buffer::from_bytes(vec![1, 2]);
    let two = Buffer::from_bytes(vec![3]);
    let concat = Buffer::concat(&[one.clone(), two.clone()]);
    assert_eq!(concat.as_bytes(), vec![1, 2, 3]);
    assert!(one.equals(&Buffer::from_bytes(vec![1, 2])));
    assert_eq!(one.compare(&two), -1);
    assert!(matches!(concat.to_json(), tsonic_js::JsValue::Object(_)));
}

#[test]
fn buffer_integer_and_extended_encoding_helpers() {
    let latin = Buffer::from_string("é", Some("latin1")).unwrap();
    assert_eq!(latin.as_bytes(), vec![233]);
    assert_eq!(latin.to_string(Some("latin1")).unwrap(), "é");

    let utf16 = Buffer::from_string("AZ", Some("utf16le")).unwrap();
    assert_eq!(utf16.as_bytes(), vec![65, 0, 90, 0]);
    assert_eq!(utf16.to_string(Some("utf16le")).unwrap(), "AZ");

    let base64url = Buffer::from_string("aGk", Some("base64url")).unwrap();
    assert_eq!(base64url.to_string(Some("utf8")).unwrap(), "hi");

    let mut buffer = Buffer::alloc(4);
    buffer.write_uint32_be(0x01020304, 0).unwrap();
    assert_eq!(buffer.read_uint32_be(0).unwrap(), 0x01020304);
    assert_eq!(buffer.read_uint32_le(0).unwrap(), 0x04030201);
    assert!(buffer.write_uint32_le(1, 2).is_err());
}
