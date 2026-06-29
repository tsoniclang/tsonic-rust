use tsonic_js::date::JsDate;

#[test]
fn date_epoch_and_iso_roundtrip() {
    let date = JsDate::from_millis(0.0);
    assert_eq!(date.get_time(), 0.0);
    assert_eq!(date.value_of(), 0.0);
    assert_eq!(date.to_iso_string().unwrap(), "1970-01-01T00:00:00.000Z");
    assert_eq!(date.to_json().unwrap(), "1970-01-01T00:00:00.000Z");
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
    assert_eq!(date.get_utc_full_year().unwrap(), 2020);
    assert_eq!(date.get_utc_month().unwrap(), 1);
    assert_eq!(date.get_utc_date().unwrap(), 29);
    assert_eq!(date.get_utc_hours().unwrap(), 12);
    assert_eq!(date.get_utc_minutes().unwrap(), 34);
    assert_eq!(date.get_utc_seconds().unwrap(), 56);
    assert_eq!(date.get_utc_milliseconds().unwrap(), 789);
    assert!(JsDate::parse("not a date").is_err());
}

#[test]
fn date_supports_numeric_parse_and_now() {
    let parsed = JsDate::parse("1234").unwrap();
    assert_eq!(parsed.get_time(), 1234.0);

    let before = JsDate::now();
    let after = JsDate::now();
    assert!(before.is_finite());
    assert!(after >= before);
}
