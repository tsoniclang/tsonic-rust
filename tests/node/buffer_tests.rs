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

#[test]
fn buffer_common_mutation_search_and_predicates() {
    assert!(tsonic_node::buffer::is_encoding("utf8"));
    assert!(tsonic_node::buffer::is_encoding("base64url"));
    assert!(!tsonic_node::buffer::is_encoding("made-up"));

    let empty = Buffer::alloc(0);
    assert_eq!(empty.len(), 0);
    assert!(empty.is_empty());

    let mut buffer = Buffer::alloc_unsafe(8);
    assert_eq!(buffer.len(), 8);
    assert!(!buffer.is_empty());
    assert!(tsonic_node::buffer::is_buffer(&buffer));
    buffer.fill(b'a', 0, None).unwrap();
    assert_eq!(buffer.get(0), Some(b'a'));
    assert_eq!(buffer.get(99), None);
    buffer.write_uint8(b'b', 1).unwrap();
    buffer.write_int8(-1, 2).unwrap();
    assert_eq!(buffer.read_uint8(1).unwrap(), b'b');
    assert_eq!(buffer.read_int8(2).unwrap(), -1);
    assert!(buffer.includes(b"ab", 0));
    assert_eq!(buffer.index_of(&[b'b', 255], 0), Some(1));
    assert_eq!(buffer.last_index_of(b"a", None), Some(7));

    let mut target = Buffer::alloc(4);
    assert_eq!(buffer.copy(&mut target, 1, 0, Some(3)).unwrap(), 3);
    assert_eq!(target.as_bytes(), vec![0, b'a', b'b', 255]);

    let mut subarray = buffer.subarray(1, Some(3));
    subarray.set(0, b'c').unwrap();
    assert_eq!(buffer.get(1), Some(b'c'));
}

#[test]
fn buffer_numeric_read_write_matrix() {
    let mut buffer = Buffer::alloc(32);
    buffer.write_uint16_le(0x1234, 0).unwrap();
    buffer.write_uint16_be(0x5678, 2).unwrap();
    buffer.write_int16_le(-1234, 4).unwrap();
    buffer.write_int16_be(-2345, 6).unwrap();
    buffer.write_int32_le(-123_456, 8).unwrap();
    buffer.write_int32_be(-654_321, 12).unwrap();
    buffer.write_float_le(12.5, 16).unwrap();
    buffer.write_float_be(-2.25, 20).unwrap();
    buffer.write_double_le(1234.5, 24).unwrap();

    assert_eq!(buffer.read_uint16_le(0).unwrap(), 0x1234);
    assert_eq!(buffer.read_uint16_be(2).unwrap(), 0x5678);
    assert_eq!(buffer.read_int16_le(4).unwrap(), -1234);
    assert_eq!(buffer.read_int16_be(6).unwrap(), -2345);
    assert_eq!(buffer.read_int32_le(8).unwrap(), -123_456);
    assert_eq!(buffer.read_int32_be(12).unwrap(), -654_321);
    assert_eq!(buffer.read_float_le(16).unwrap(), 12.5);
    assert_eq!(buffer.read_float_be(20).unwrap(), -2.25);
    assert_eq!(buffer.read_double_le(24).unwrap(), 1234.5);

    let mut big = Buffer::alloc(8);
    big.write_double_be(-0.5, 0).unwrap();
    assert_eq!(big.read_double_be(0).unwrap(), -0.5);
}

#[test]
fn buffer_variable_width_integer_matrix() {
    let mut buffer = Buffer::alloc(16);
    buffer.write_uint_le(0x01_02_03_04_05_06, 0, 6).unwrap();
    assert_eq!(buffer.as_bytes()[..6], [0x06, 0x05, 0x04, 0x03, 0x02, 0x01]);
    assert_eq!(buffer.read_uint_le(0, 6).unwrap(), 0x01_02_03_04_05_06);
    assert_eq!(buffer.read_uint_be(0, 6).unwrap(), 0x06_05_04_03_02_01);

    buffer.write_uint_be(0x0a_0b_0c, 6, 3).unwrap();
    assert_eq!(buffer.as_bytes()[6..9], [0x0a, 0x0b, 0x0c]);
    assert_eq!(buffer.read_uint_be(6, 3).unwrap(), 0x0a_0b_0c);
    assert_eq!(buffer.read_uint_le(6, 3).unwrap(), 0x0c_0b_0a);

    buffer.write_int_le(-2, 9, 2).unwrap();
    assert_eq!(buffer.as_bytes()[9..11], [0xfe, 0xff]);
    assert_eq!(buffer.read_int_le(9, 2).unwrap(), -2);
    assert_eq!(buffer.read_uint_le(9, 2).unwrap(), 65_534);

    buffer.write_int_be(-128, 11, 1).unwrap();
    assert_eq!(buffer.read_int_be(11, 1).unwrap(), -128);
    assert_eq!(buffer.read_uint_be(11, 1).unwrap(), 128);

    assert!(buffer.read_uint_le(0, 0).is_err());
    assert!(buffer.read_uint_le(0, 7).is_err());
    assert!(buffer.write_uint_le(256, 0, 1).is_err());
    assert!(buffer.write_int_be(128, 0, 1).is_err());
    assert!(buffer.write_int_be(-129, 0, 1).is_err());
}
