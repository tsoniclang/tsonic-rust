//! Assertion helper crate so generated binaries can prove behavior without
//! any JS surface dependency.

pub fn check(condition: bool) {
    assert!(condition, "acme_testing::check failed");
}
