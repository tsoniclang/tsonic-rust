use tsonic_js::date::JsDate;

#[test]
fn date_epoch_and_iso_roundtrip() {
    let date = JsDate::from_millis(0.0);
    assert_eq!(date.get_time(), 0.0);
    assert_eq!(date.to_iso_string().unwrap(), "1970-01-01T00:00:00.000Z");
    assert_eq!(
        JsDate::parse("1970-01-01T00:00:00.000Z")
            .unwrap()
            .get_time(),
        0.0
    );
}

#[test]
fn date_supports_common_utc_iso_values() {
    let date = JsDate::parse("2020-02-29T12:34:56.789Z").unwrap();
    assert_eq!(date.to_iso_string().unwrap(), "2020-02-29T12:34:56.789Z");
    assert!(JsDate::parse("not a date").is_err());
}
