use tsonic_js::array::JsArray;

#[test]
fn sparse_array_length_delete_and_holes() {
    let mut xs = JsArray::from_dense(vec![1, 2]);
    xs.set_len(5);
    assert_eq!(xs.len(), 5);
    assert!(xs.has_index(1));
    assert!(!xs.has_index(3));
    assert!(xs.delete_at(1));
    assert_eq!(xs.len(), 5);
    assert!(!xs.has_index(1));
    assert_eq!(xs.get(1), None);
}

#[test]
fn sparse_array_mutation_helpers_preserve_holes() {
    let mut xs = JsArray::with_length(4);
    xs.set(0, 1);
    xs.set(2, 3);
    xs.fill(9, 1, Some(3));
    assert_eq!(xs.values(), vec![Some(&1), Some(&9), Some(&9), None]);

    xs.delete_at(1);
    xs.copy_within(2, 0, Some(2));
    assert_eq!(xs.values(), vec![Some(&1), None, Some(&1), None]);

    xs.reverse();
    assert_eq!(xs.values(), vec![None, Some(&1), None, Some(&1)]);
}

#[test]
fn sparse_array_splice_shift_unshift_and_entries() {
    let mut xs = JsArray::from_dense(vec![1, 2, 3]);
    let removed = xs.splice(1, 1, vec![9, 10]);
    assert_eq!(removed, vec![Some(2)]);
    assert_eq!(xs.values(), vec![Some(&1), Some(&9), Some(&10), Some(&3)]);
    assert_eq!(xs.shift(), Some(1));
    assert_eq!(xs.unshift(0), 4);
    assert_eq!(xs.pop(), Some(3));
    assert_eq!(xs.keys(), vec![0, 1, 2]);
    assert_eq!(
        xs.entries(),
        vec![(0, Some(&0)), (1, Some(&9)), (2, Some(&10))]
    );
}
