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
