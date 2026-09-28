//! Assertion helper crate so generated binaries can prove behavior without
//! any JS surface dependency.

pub fn check(condition: bool) {
    assert!(condition, "acme_testing::check failed");
}

pub fn fail(message: String) -> ! {
    panic!("{message}");
}

#[macro_export]
macro_rules! sum_pair {
    ($left:expr, $right:expr) => {
        $left + $right
    };
}

#[macro_export]
macro_rules! repeat_sum {
    ($value:expr; $count:expr) => {{
        let value = $value;
        let count = $count;
        vec![value; count].into_iter().sum::<i32>()
    }};
}

#[macro_export]
macro_rules! discard {
    ($($input:tt)*) => { 31_i32 };
}

#[macro_export]
macro_rules! string_value {
    () => { "payload" };
}

#[macro_export]
macro_rules! twice {
    ($input:expr) => { ($input) + ($input) };
}

#[macro_export]
macro_rules! initialize {
    ($target:ident, $value:expr) => { $target = $value };
}

#[macro_export]
macro_rules! initialize_when {
    ($condition:expr, $target:ident, $value:expr) => {
        if $condition { $target = $value; }
    };
}

#[macro_export]
macro_rules! leave {
    ($value:expr) => { return $value };
}

#[macro_export]
macro_rules! selected {
    ($left:expr, $right:expr) => { $left + $right };
}

pub fn selected(left: i32, right: i32) -> i32 {
    left - right
}

pub struct OwnedValue {
    pub value: i32,
}

impl OwnedValue {
    pub fn new(value: i32) -> Self {
        Self { value }
    }
}

#[macro_export]
macro_rules! borrow {
    ($value:expr) => { &$value };
}

#[macro_export]
macro_rules! consume {
    ($value:expr) => { $crate::consume_owned($value) };
}

pub fn consume_owned(value: OwnedValue) -> i32 {
    value.value
}
