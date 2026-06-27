use tsonic_js::ArrayBuffer;

#[test]
fn array_buffer_slice_copies() {
    let buffer = ArrayBuffer::from_bytes(vec![1, 2, 3, 4]);
    let slice = buffer.slice(1, Some(3));
    assert_eq!(slice.as_bytes(), &[2, 3]);
    assert_eq!(buffer.byte_length(), 4);
}
