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
