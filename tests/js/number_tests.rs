use tsonic_js::equality::{same_value_zero_f64, strict_equal_f64};
use tsonic_js::number;

#[test]
fn parse_int_radix_examples() {
    assert_eq!(number::parse_int("ff", Some(16)), 255.0);
    assert!(number::parse_int("08", Some(10)).is_finite());
    assert!(number::parse_int("08", None).is_finite());
    assert_eq!(number::parse_int("08", None), 8.0);
    assert!(number::parse_int("xyz", None).is_nan());
    assert!(number::parse_int("2", Some(1)).is_nan());
}

#[test]
fn parse_float_prefix_parse() {
    assert_eq!(number::parse_float("  +1.5x"), 1.5);
    assert_eq!(number::parse_float("  -1.5e+2"), -150.0);
    assert_eq!(number::parse_float("1.5x"), 1.5);
    assert_eq!(number::parse_float("0x10"), 0.0);
    assert_eq!(number::parse_float("-3.25e1"), -32.5);
    assert_eq!(number::parse_float("1e"), 1.0);
    assert_eq!(number::parse_float("1e+"), 1.0);
    assert_eq!(number::parse_float("Infinityx"), f64::INFINITY);
    assert_eq!(number::parse_float("infinityx"), f64::INFINITY);
    assert!(number::parse_float("x").is_nan());
    assert!(
        number::parse_float("Infinity").is_infinite()
            && number::parse_float("Infinity").is_sign_positive()
    );
    assert!(
        number::parse_float("+Infinity").is_infinite()
            && number::parse_float("+Infinity").is_sign_positive()
    );
    assert!(
        number::parse_float("-Infinity").is_infinite()
            && number::parse_float("-Infinity").is_sign_negative()
    );
}

#[test]
fn number_predicates() {
    assert!(number::is_nan(f64::NAN));
    assert!(!number::is_nan(1.2));
    assert!(number::is_finite(0.0));
    assert!(!number::is_finite(f64::INFINITY));
    assert!(number::is_integer(42.0));
    assert!(!number::is_integer(42.5));
    assert!(!number::is_safe_integer(9_007_199_254_740_993.0));
}

#[test]
fn number_formatting_rules() {
    assert_eq!(number::to_fixed(1.2345, 2).as_deref(), Ok("1.23"));
    assert_eq!(
        number::to_fixed(1.234, 101).unwrap_err().kind(),
        tsonic_runtime::JsErrorKind::RangeError
    );
    assert_eq!(
        number::to_string_radix(255.0, Some(16)).as_deref(),
        Ok("ff")
    );
    assert_eq!(
        number::to_string_radix(255.0, Some(37)).unwrap_err().kind(),
        tsonic_runtime::JsErrorKind::RangeError
    );
    assert_eq!(
        number::to_exponential(12.5, Some(1)).as_deref(),
        Ok("1.2e1")
    );
    assert_eq!(
        number::to_precision(12.345, Some(2)).as_deref(),
        Ok("12.35")
    );
    assert_eq!(
        number::to_precision(12.345, Some(0)).unwrap_err().kind(),
        tsonic_runtime::JsErrorKind::RangeError
    );
}

#[test]
fn same_value_zero_and_strict_equal_for_nans_and_zeroes() {
    assert!(same_value_zero_f64(f64::NAN, f64::NAN));
    assert!(!strict_equal_f64(f64::NAN, f64::NAN));
    assert!(same_value_zero_f64(0.0, -0.0));
    assert!(strict_equal_f64(0.0, -0.0));
}

#[test]
fn parse_float_invalid_leading_sign_combinations() {
    assert!(number::parse_float("-").is_nan());
    assert!(number::parse_float("+").is_nan());
    assert!(number::parse_float("  +Infinity").is_infinite());
    assert!(number::parse_float("0x1.2").is_finite());
    assert_eq!(number::parse_float("0x1.2"), 0.0);
}

#[test]
fn number_to_string_radix_rules() {
    assert_eq!(number::to_string_radix(0.0, Some(16)).as_deref(), Ok("0"));
    assert_eq!(
        number::to_string_radix(-255.0, Some(16)).as_deref(),
        Ok("-ff")
    );
    assert_eq!(
        number::to_string_radix(255.0, Some(1)).unwrap_err().kind(),
        tsonic_runtime::JsErrorKind::RangeError
    );
}
