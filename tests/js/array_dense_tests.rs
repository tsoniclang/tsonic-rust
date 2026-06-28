use tsonic_js::array::{dense, statics};

#[test]
fn dense_builders_and_length_ops() {
    let mut xs = dense::from_iter([1, 2, 3]);
    assert_eq!(dense::concat(&[&[1, 2], &[3, 4]],), [1, 2, 3, 4]);
    assert_eq!(xs.len(), 3);
    assert_eq!(dense::push(&mut xs, 4), 4);
    assert_eq!(xs, vec![1, 2, 3, 4]);
    assert_eq!(dense::pop(&mut xs), Some(4));
    assert_eq!(xs, vec![1, 2, 3]);
    assert_eq!(dense::unshift(&mut xs, 0), 4);
    assert_eq!(xs, vec![0, 1, 2, 3]);
    assert_eq!(dense::shift(&mut xs), Some(0));
    assert_eq!(xs, vec![1, 2, 3]);
}

#[test]
fn access_and_search() {
    let xs = vec![1, 2, 3];
    assert_eq!(dense::at(&xs, -1), Some(&3));
    assert_eq!(dense::at(&xs, 99), None);
    assert!(dense::includes(&[1.0, f64::NAN], &f64::NAN, 0));
    let values = vec![1.0, f64::NAN, 2.0, f64::NAN];
    assert!(dense::includes(&values, &f64::NAN, 0));
    assert_eq!(dense::index_of(&xs, &2, 0), 1);
    assert_eq!(dense::last_index_of(&values, &f64::NAN, None), -1);
}

#[test]
fn slicing_and_joining() {
    let xs = vec![1, 2, 3, 4];
    assert_eq!(dense::slice(&xs, -3, Some(3)), vec![2, 3]);
    assert_eq!(dense::slice(&xs, 1, None), vec![2, 3, 4]);
    assert_eq!(dense::slice(&xs, 3, Some(1)), Vec::<i32>::new());
    assert_eq!(dense::join(&xs, "-"), "1-2-3-4");
}

#[test]
fn mutating_dense_helpers() {
    let mut xs = vec![1, 2, 3, 4];
    dense::fill(&mut xs, 7, 1, Some(3));
    assert_eq!(xs, vec![1, 7, 7, 4]);
    dense::fill(&mut xs, 9, -2, Some(10));
    assert_eq!(xs, vec![1, 7, 9, 9]);

    let mut copy = vec![1, 2, 3];
    dense::copy_within(&mut copy, -3, 1, Some(3));
    assert_eq!(copy, vec![2, 3, 3]);

    let mut copy = vec![1, 2, 3, 4, 5];
    dense::copy_within(&mut copy, 0, 3, None);
    assert_eq!(copy, vec![4, 5, 3, 4, 5]);
    dense::copy_within(&mut copy, 10, 0, Some(1));
    assert_eq!(copy, vec![4, 5, 3, 4, 5]);

    dense::reverse(&mut copy[..]);
    assert_eq!(copy, vec![5, 4, 3, 5, 4]);

    let mut spliced = vec![1, 2, 3, 4];
    let removed = dense::splice(&mut spliced, 1, 2, vec![9, 10]);
    assert_eq!(removed, vec![2, 3]);
    assert_eq!(spliced, vec![1, 9, 10, 4]);

    let mut clamped = vec![1, 2, 3];
    assert_eq!(
        dense::splice(&mut clamped, 99, 100, vec![7]),
        Vec::<i32>::new()
    );
    assert_eq!(clamped, vec![1, 2, 3, 7]);
    assert_eq!(
        dense::splice(&mut clamped, -1, 10, Vec::<i32>::new()),
        vec![7]
    );
    assert_eq!(clamped, vec![1, 2, 3]);
    assert_eq!(
        dense::splice(&mut clamped, -10, 10, Vec::<i32>::new()),
        vec![1, 2, 3]
    );
    assert!(clamped.is_empty());
}

#[test]
fn iter_helpers_and_clear() {
    let xs = vec![10, 20, 30];
    assert_eq!(dense::keys(&xs), vec![0, 1, 2]);
    assert_eq!(
        dense::values(&xs).into_iter().cloned().collect::<Vec<_>>(),
        vec![10, 20, 30]
    );
    assert_eq!(dense::entries(&xs), vec![(0, &10), (1, &20), (2, &30)]);

    let mut clear = vec![1, 2, 3];
    dense::clear(&mut clear);
    assert!(clear.is_empty());
}

#[test]
fn array_statics_from_string_and_branding() {
    assert_eq!(statics::from_string("abc"), vec!["a", "b", "c"]);
    assert_eq!(statics::from_string("😀"), vec!["😀"]);
    let dense: Vec<f64> = Vec::new();
    let not_dense: i32 = 42;
    assert!(statics::is_array(&dense));
    assert!(statics::is_array(&[1, 2, 3] as &[i32]));
    assert!(!statics::is_array(&not_dense));
}

#[test]
fn callback_copying_sort_and_flat_helpers() {
    let xs = vec![3, 1, 2];
    assert_eq!(dense::map(&xs, |value| value * 2), vec![6, 2, 4]);
    assert_eq!(dense::filter(&xs, |value| *value > 1), vec![3, 2]);
    assert_eq!(dense::reduce(&xs, 0, |sum, value| sum + value), 6);
    assert!(dense::some(&xs, |value| *value == 2));
    assert!(dense::every(&xs, |value| *value > 0));
    assert_eq!(dense::find(&xs, |value| *value == 1), Some(&1));

    let mut sorted = vec![10, 2, 1];
    dense::sort_by_js_string(&mut sorted);
    assert_eq!(sorted, vec![1, 10, 2]);
    assert_eq!(dense::to_reversed(&xs), vec![2, 1, 3]);
    assert_eq!(dense::to_sorted_by_js_string(&[10, 2, 1]), vec![1, 10, 2]);
    assert_eq!(dense::to_spliced(&xs, 1, 1, vec![9, 8]), vec![3, 9, 8, 2]);
    assert_eq!(dense::with(&xs, -1, 9), Some(vec![3, 1, 9]));
    assert_eq!(dense::flat_one(&[vec![1, 2], vec![3]]), vec![1, 2, 3]);
    assert_eq!(
        dense::flat_map_one(&[1, 2], |value| vec![*value, *value + 10]),
        vec![1, 11, 2, 12]
    );
}
