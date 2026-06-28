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
    assert!(tsonic_node::buffer::is_utf8("ok".as_bytes()));
    assert!(tsonic_node::buffer::is_ascii(b"ascii"));
    assert!(!tsonic_node::buffer::is_ascii("é".as_bytes()));
    assert!(tsonic_node::buffer::resolve_object_url("blob:n/a").is_none());
}

#[test]
fn buffer_compare_equals_concat_and_json() {
    let one = Buffer::from_bytes(vec![1, 2]);
    let two = Buffer::from_bytes(vec![3]);
    let concat = Buffer::concat(&[one.clone(), two.clone()]);
    assert_eq!(concat.as_bytes(), vec![1, 2, 3]);
    let padded = Buffer::concat_with_total_length(&[one.clone(), two.clone()], 5);
    assert_eq!(padded.as_bytes(), vec![1, 2, 3, 0, 0]);
    assert!(one.equals(&Buffer::from_bytes(vec![1, 2])));
    assert_eq!(one.compare(&two), -1);
    assert_eq!(tsonic_node::buffer::compare(&one, &two), -1);
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
    let slow = Buffer::alloc_unsafe_slow(2);
    assert_eq!(slow.as_bytes(), vec![0, 0]);
    assert_eq!(Buffer::of(&[1, 2, 3]).as_bytes(), vec![1, 2, 3]);
    assert_eq!(Buffer::from_array_like(&[4, 5]).as_bytes(), vec![4, 5]);
    assert_eq!(
        Buffer::copy_bytes_from(&[9, 8, 7, 6], 1, Some(2))
            .unwrap()
            .as_bytes(),
        vec![8, 7]
    );
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

    let mut writable = Buffer::alloc(5);
    assert_eq!(
        writable.write("hello", 0, Some(4), Some("utf8")).unwrap(),
        4
    );
    assert_eq!(writable.to_string(Some("utf8")).unwrap(), "hell\0");
    writable.reverse();
    assert_eq!(writable.as_bytes(), vec![0, b'l', b'l', b'e', b'h']);

    let mut swap = Buffer::from_bytes(vec![1, 2, 3, 4, 5, 6, 7, 8]);
    swap.swap16().unwrap();
    assert_eq!(swap.as_bytes(), vec![2, 1, 4, 3, 6, 5, 8, 7]);
    swap.swap32().unwrap();
    assert_eq!(swap.as_bytes(), vec![3, 4, 1, 2, 7, 8, 5, 6]);
    swap.swap64().unwrap();
    assert_eq!(swap.as_bytes(), vec![6, 5, 8, 7, 2, 1, 4, 3]);
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
    big.write_big_uint64_le(0x0102_0304_0506_0708, 0).unwrap();
    assert_eq!(big.read_big_uint64_le(0).unwrap(), 0x0102_0304_0506_0708);
    big.write_big_uint64_be(0x0102_0304_0506_0708, 0).unwrap();
    assert_eq!(big.read_big_uint64_be(0).unwrap(), 0x0102_0304_0506_0708);
    big.write_big_int64_le(-42, 0).unwrap();
    assert_eq!(big.read_big_int64_le(0).unwrap(), -42);
    big.write_big_int64_be(-43, 0).unwrap();
    assert_eq!(big.read_big_int64_be(0).unwrap(), -43);
}

#[test]
fn buffer_blob_file_and_constants_are_closed_carriers() {
    assert_eq!(tsonic_node::buffer::INSPECT_MAX_BYTES, 50);
    assert_eq!(
        tsonic_node::buffer::constants::MAX_STRING_LENGTH,
        tsonic_node::buffer::MAX_STRING_LENGTH
    );
    assert_eq!(tsonic_node::buffer::DEFAULT_POOL_SIZE, 8192);

    let blob_options = tsonic_node::buffer::BlobPropertyBag {
        endings: Some("transparent".to_string()),
        content_type: Some("text/plain".to_string()),
    };
    assert_eq!(blob_options.content_type.as_deref(), Some("text/plain"));
    let blob = tsonic_node::buffer::Blob::new(
        &[tsonic_node::buffer::BlobPart::Text("blob".to_string())],
        blob_options.content_type.clone().unwrap(),
    );
    assert_eq!(blob.size(), 4);
    assert_eq!(blob.content_type(), "text/plain");
    assert_eq!(blob.text().unwrap(), "blob");
    assert_eq!(blob.bytes(), b"blob");
    assert_eq!(blob.slice(1, Some(3), "text/plain").text().unwrap(), "lo");
    assert_eq!(tsonic_node::buffer::blob_size(&blob), 4);
    assert_eq!(tsonic_node::buffer::blob_type(&blob), "text/plain");
    assert_eq!(tsonic_node::buffer::blob_text(&blob).unwrap(), "blob");
    assert_eq!(
        tsonic_node::buffer::blob_array_buffer(&blob).as_bytes(),
        b"blob"
    );
    assert_eq!(tsonic_node::buffer::blob_bytes(&blob), b"blob");
    assert_eq!(
        tsonic_node::buffer::blob_slice(&blob, 1, Some(3), "text/plain")
            .text()
            .unwrap(),
        "lo"
    );
    assert_eq!(
        tsonic_node::buffer::blob_stream(&blob).chunks()[0].as_bytes(),
        b"blob"
    );

    let file_options = tsonic_node::buffer::FilePropertyBag {
        endings: Some("native".to_string()),
        content_type: Some("text/plain".to_string()),
        last_modified: Some(123),
    };
    let file = tsonic_node::buffer::File::new(
        &[tsonic_node::buffer::BlobPart::Text("file".to_string())],
        "a.txt",
        file_options.content_type.clone().unwrap(),
        file_options.last_modified.unwrap(),
    );
    assert_eq!(file.name(), "a.txt");
    assert_eq!(file.last_modified(), 123);
    assert_eq!(file.content_type(), "text/plain");
    assert_eq!(file.text().unwrap(), "file");
    assert_eq!(file.array_buffer().byte_length(), 4);
    assert_eq!(tsonic_node::buffer::file_name(&file), "a.txt");
    assert_eq!(tsonic_node::buffer::file_last_modified(&file), 123);
    assert_eq!(tsonic_node::buffer::file_webkit_relative_path(&file), "");
    assert_eq!(tsonic_node::buffer::file_size(&file), 4);
    assert_eq!(tsonic_node::buffer::file_type(&file), "text/plain");
    assert_eq!(tsonic_node::buffer::file_text(&file).unwrap(), "file");
    assert_eq!(
        tsonic_node::buffer::file_array_buffer(&file).as_bytes(),
        b"file"
    );
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
