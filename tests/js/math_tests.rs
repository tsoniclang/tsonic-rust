use tsonic_js::math;

#[test]
fn constants_are_exposed() {
    assert!(math::E > 2.0);
    assert!(math::PI > 3.0);
    assert!(math::SQRT2 > 1.0);
}

#[test]
fn math_max_min_with_empty_and_nan() {
    assert_eq!(math::max(&[]), f64::NEG_INFINITY);
    assert_eq!(math::min(&[]), f64::INFINITY);
    assert!(math::max(&[1.0, f64::NAN]).is_nan());
    assert!(math::min(&[1.0, f64::NAN]).is_nan());
    assert!(math::max(&[f64::NAN, 1.0]).is_nan());
    assert!(math::min(&[f64::NAN, 1.0]).is_nan());
    assert_eq!(math::max(&[-0.0, 0.0]), 0.0);
    assert_eq!(math::max(&[0.0, -0.0]), 0.0);
    assert_eq!(math::min(&[-0.0, 0.0]), -0.0);
    assert_eq!(math::min(&[0.0, -0.0]), -0.0);
}

#[test]
fn imul_and_clz32_and_shift_sign() {
    assert_eq!(math::imul(0x7fffffff, 2), -2);
    assert_eq!(math::clz32(1.0), 31);
    assert_eq!(math::clz32(f64::NAN), 32);
    assert_eq!(math::clz32(0.0), 32);
    assert_eq!(math::sign(-0.0), 0.0);
    assert_eq!(math::sign(-12.0), -1.0);
    let random = math::random();
    assert!((0.0..1.0).contains(&random));
}

#[test]
fn basic_math_helpers() {
    assert_eq!(math::round(1.5), 2.0);
    assert_eq!(math::round(-0.5), -0.0);
    assert_eq!(math::round(-1.5), -1.0);
    assert_eq!(math::round(-2.5), -2.0);
    assert_eq!(math::trunc(1.9), 1.0);
    assert_eq!(math::trunc(-1.9), -1.0);
    assert_eq!(math::floor(1.9), 1.0);
    assert_eq!(math::ceil(1.1), 2.0);
}
