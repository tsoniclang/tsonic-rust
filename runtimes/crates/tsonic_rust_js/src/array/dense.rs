//! Dense-array helpers for static-native semantics.
//!
//! These helpers are intentionally minimal and should only be used when the compiler has selected
//! dense static-native array semantics.

use crate::equality::{JsSameValueZero, JsStrictEqual};

/// Constructs a dense vector from an iterator.
pub fn from_iter<T, I>(items: I) -> Vec<T>
where
    I: IntoIterator<Item = T>,
{
    items.into_iter().collect()
}

/// Returns a dense vector with the same elements.
pub fn of<T>(items: Vec<T>) -> Vec<T> {
    items
}

/// Concatenates slice chunks into one dense vector.
pub fn concat<T: Clone>(chunks: &[&[T]]) -> Vec<T> {
    let total: usize = chunks.iter().map(|chunk| chunk.len()).sum();
    let mut out = Vec::with_capacity(total);
    for chunk in chunks {
        out.extend_from_slice(chunk);
    }
    out
}

/// Pushes an item and returns the new length.
pub fn push<T>(array: &mut Vec<T>, item: T) -> usize {
    array.push(item);
    array.len()
}

/// Pops the last item.
pub fn pop<T>(array: &mut Vec<T>) -> Option<T> {
    array.pop()
}

/// Shifts the first item and removes it from the front.
pub fn shift<T>(array: &mut Vec<T>) -> Option<T> {
    if array.is_empty() {
        return None;
    }
    Some(array.remove(0))
}

/// Unshifts an item to the front and returns the new length.
pub fn unshift<T>(array: &mut Vec<T>, item: T) -> usize {
    array.insert(0, item);
    array.len()
}

/// Accesses element by UTF-16 style index normalized from array semantics.
pub fn at<T>(array: &[T], index: isize) -> Option<&T> {
    if array.is_empty() {
        return None;
    }
    let normalized = normalize_index(array.len(), index)?;
    array.get(normalized)
}

/// Implements `includes` with SameValueZero semantics.
pub fn includes<T>(array: &[T], value: &T, from_index: isize) -> bool
where
    T: JsSameValueZero,
{
    if from_index >= array.len() as isize {
        return false;
    }
    let start = normalize_from_index(array.len(), from_index);
    array[start..]
        .iter()
        .any(|item| item.same_value_zero(value))
}

/// Implements strict `indexOf` with strict equality and JS-`fromIndex` normalization.
pub fn index_of<T>(array: &[T], value: &T, from_index: isize) -> isize
where
    T: JsStrictEqual,
{
    if array.is_empty() {
        return -1;
    }
    let start = normalize_from_index(array.len(), from_index);
    for (idx, item) in array[start..].iter().enumerate() {
        if item.strict_equal(value) {
            return (start + idx) as isize;
        }
    }
    -1
}

/// Implements strict `lastIndexOf` with strict equality semantics.
pub fn last_index_of<T>(array: &[T], value: &T, from_index: Option<isize>) -> isize
where
    T: JsStrictEqual,
{
    if array.is_empty() {
        return -1;
    }
    let start =
        normalize_last_index_start(array.len(), from_index.unwrap_or(array.len() as isize - 1));
    let mut i = start;
    loop {
        if array[i].strict_equal(value) {
            return i as isize;
        }
        if i == 0 {
            break;
        }
        i -= 1;
    }
    -1
}

/// Slices a dense array by index.
pub fn slice<T: Clone>(array: &[T], start: isize, end: Option<isize>) -> Vec<T> {
    let start = normalize_slice_index(array.len(), start);
    let end = normalize_slice_end(array.len(), end.unwrap_or(array.len() as isize));
    if start > end {
        return Vec::new();
    }
    array[start..end].to_vec()
}

/// Joins a dense array with separator, delegating conversion through a minimal string contract.
pub fn join<T>(array: &[T], separator: &str) -> String
where
    T: crate::string::JsToString,
{
    if array.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    let mut first = true;
    for item in array {
        if !first {
            out.push_str(separator);
        }
        first = false;
        out.push_str(&item.to_js_string());
    }
    out
}

/// Fills a dense sub-range with a cloned value.
pub fn fill<T: Clone>(array: &mut [T], value: T, start: isize, end: Option<isize>) {
    let len = array.len();
    let start = normalize_fill_index(len, start);
    let end = normalize_fill_index(len, end.unwrap_or(len as isize));
    if start >= end {
        return;
    }
    for item in array.iter_mut().take(end).skip(start) {
        *item = value.clone();
    }
}

/// Implements copyWithin over dense arrays with overlap-safe copy direction.
pub fn copy_within<T: Clone>(array: &mut [T], target: isize, start: isize, end: Option<isize>) {
    let len = array.len();
    if len == 0 {
        return;
    }
    let to = normalize_copy_index(len, target);
    if to >= len {
        return;
    }

    let from_start = normalize_copy_index(len, start);
    let from_end = normalize_copy_index(len, end.unwrap_or(len as isize));
    if from_end < from_start {
        return;
    }

    let count = (from_end - from_start).min(len - to);
    if count == 0 {
        return;
    }

    if to <= from_start {
        for i in 0..count {
            array[to + i] = array[from_start + i].clone();
        }
    } else {
        for offset in (0..count).rev() {
            array[to + offset] = array[from_start + offset].clone();
        }
    }
}

/// Reverses in place.
pub fn reverse<T>(array: &mut [T]) {
    array.reverse();
}

/// Removes/inserts elements and returns removed values.
pub fn splice<T>(array: &mut Vec<T>, start: isize, delete_count: usize, items: Vec<T>) -> Vec<T> {
    if array.is_empty() {
        if !items.is_empty() {
            array.extend(items);
        }
        return Vec::new();
    }

    let start = normalize_slice_index(array.len(), start);
    let max_delete = array.len().saturating_sub(start);
    let delete_count = delete_count.min(max_delete);
    let removed = array.drain(start..start + delete_count).collect::<Vec<_>>();
    array.splice(start..start, items);
    removed
}

pub fn keys<T>(array: &[T]) -> Vec<usize> {
    (0..array.len()).collect()
}

pub fn values<T>(array: &[T]) -> Vec<&T> {
    array.iter().collect()
}

pub fn entries<T>(array: &[T]) -> Vec<(usize, &T)> {
    array.iter().enumerate().collect()
}

pub fn clear<T>(array: &mut Vec<T>) {
    array.clear();
}

pub fn sort_by_js_string<T>(array: &mut [T])
where
    T: crate::string::JsToString,
{
    array.sort_by_key(|item| item.to_js_string());
}

pub fn sort_by<T, F>(array: &mut [T], compare: F)
where
    F: FnMut(&T, &T) -> std::cmp::Ordering,
{
    array.sort_by(compare);
}

pub fn to_sorted_by_js_string<T>(array: &[T]) -> Vec<T>
where
    T: Clone + crate::string::JsToString,
{
    let mut out = array.to_vec();
    sort_by_js_string(&mut out);
    out
}

pub fn to_reversed<T: Clone>(array: &[T]) -> Vec<T> {
    let mut out = array.to_vec();
    out.reverse();
    out
}

pub fn to_spliced<T: Clone>(
    array: &[T],
    start: isize,
    delete_count: usize,
    items: Vec<T>,
) -> Vec<T> {
    let mut out = array.to_vec();
    splice(&mut out, start, delete_count, items);
    out
}

pub fn with<T: Clone>(array: &[T], index: isize, value: T) -> Option<Vec<T>> {
    let index = normalize_index(array.len(), index)?;
    let mut out = array.to_vec();
    out[index] = value;
    Some(out)
}

pub fn map<T, U, F>(array: &[T], mapper: F) -> Vec<U>
where
    F: FnMut(&T) -> U,
{
    array.iter().map(mapper).collect()
}

pub fn filter<T, F>(array: &[T], mut predicate: F) -> Vec<T>
where
    T: Clone,
    F: FnMut(&T) -> bool,
{
    array
        .iter()
        .filter(|item| predicate(item))
        .cloned()
        .collect()
}

pub fn reduce<T, U, F>(array: &[T], initial: U, reducer: F) -> U
where
    F: FnMut(U, &T) -> U,
{
    array.iter().fold(initial, reducer)
}

pub fn some<T, F>(array: &[T], predicate: F) -> bool
where
    F: FnMut(&T) -> bool,
{
    array.iter().any(predicate)
}

pub fn every<T, F>(array: &[T], predicate: F) -> bool
where
    F: FnMut(&T) -> bool,
{
    array.iter().all(predicate)
}

pub fn find<T, F>(array: &[T], mut predicate: F) -> Option<&T>
where
    F: FnMut(&T) -> bool,
{
    array.iter().find(|item| predicate(item))
}

pub fn for_each<T, F>(array: &[T], callback: F)
where
    F: FnMut(&T),
{
    array.iter().for_each(callback);
}

pub fn flat_one<T: Clone>(array: &[Vec<T>]) -> Vec<T> {
    array.iter().flat_map(|item| item.iter().cloned()).collect()
}

pub fn flat_map_one<T, U, F>(array: &[T], mut mapper: F) -> Vec<U>
where
    U: Clone,
    F: FnMut(&T) -> Vec<U>,
{
    array.iter().flat_map(&mut mapper).collect()
}

fn normalize_index(len: usize, index: isize) -> Option<usize> {
    if len == 0 {
        return None;
    }
    let normalized = if index < 0 {
        len as isize + index
    } else {
        index
    };
    if normalized >= 0 && normalized < len as isize {
        Some(normalized as usize)
    } else {
        None
    }
}

fn normalize_from_index(len: usize, from_index: isize) -> usize {
    if len == 0 {
        return 0;
    }

    let max = len as isize;
    let normalized = if from_index < 0 {
        max + from_index
    } else {
        from_index
    };
    let clamped = normalized.max(0).min(max);

    clamped as usize
}

fn normalize_slice_index(len: usize, index: isize) -> usize {
    if len == 0 {
        return 0;
    }
    let max = len as isize;
    let mut normalized = if index < 0 { max + index } else { index };
    normalized = normalized.max(0);
    if normalized > max {
        max as usize
    } else {
        normalized as usize
    }
}

fn normalize_slice_end(len: usize, index: isize) -> usize {
    if len == 0 {
        return 0;
    }
    let max = len as isize;
    let normalized = if index < 0 { max + index } else { index };
    let clamped = normalized.max(0).min(max);
    clamped as usize
}

fn normalize_fill_index(len: usize, index: isize) -> usize {
    if len == 0 {
        return 0;
    }
    let max = len as isize;
    let normalized = if index < 0 { max + index } else { index };
    let clamped = normalized.max(0).min(max);
    clamped as usize
}

fn normalize_last_index_start(len: usize, index: isize) -> usize {
    if len == 0 {
        return 0;
    }
    let max = len as isize - 1;
    let normalized = if index < 0 { max + 1 + index } else { index };
    let clamped = normalized.max(0).min(max);
    clamped as usize
}

fn normalize_copy_index(len: usize, index: isize) -> usize {
    if len == 0 {
        return 0;
    }
    let max = len as isize;
    let normalized = if index < 0 { max + index } else { index };
    if normalized < 0 {
        0
    } else if normalized > max {
        max as usize
    } else {
        normalized as usize
    }
}
