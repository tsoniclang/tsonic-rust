use tsonic_js::typed_array::{byte_length, len, Int16Array, Uint8Array};

#[test]
fn typed_array_get_set_fill_and_slice() {
    let mut values = Int16Array::from_vec(vec![1, 2, 3, 4]);
    assert_eq!(len(&values), 4);
    assert_eq!(byte_length(&values), 8);
    assert_eq!(values.get(2), Some(3));
    values.set_index(1, 9);
    values.fill(7, -2, None);
    assert_eq!(values.get(1), Some(9));
    assert_eq!(values.get(2), Some(7));

    let copy = values.slice(1, Some(3));
    values.set_index(1, 100);
    assert_eq!(copy.get(0), Some(9));
}

#[test]
fn typed_array_subarray_is_shared_view() {
    let values = Uint8Array::from_vec(vec![1, 2, 3, 4]);
    let mut view = values.subarray(1, Some(3));
    view.set_index(0, 99);
    assert_eq!(values.get(1), Some(99));
}
