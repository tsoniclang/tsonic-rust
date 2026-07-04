//! Minimal UTC-only Date carrier.

use crate::errors::{range_error, JsResult};

const MS_PER_DAY: i64 = 86_400_000;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JsDate {
    millis: f64,
}

impl JsDate {
    pub fn now() -> f64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as f64)
            .unwrap_or(0.0)
    }

    pub fn from_millis(millis: f64) -> Self {
        Self { millis }
    }

    /// Mirrors `Date.parse` over the ISO 8601 subset Node accepts
    /// deterministically: `YYYY-MM-DD` (UTC midnight) and
    /// `YYYY-MM-DDTHH:mm:ss(.sss)?(Z|±HH:MM)`. Returns milliseconds since the
    /// epoch, or NaN for anything else. Rejected (NaN): surrounding
    /// whitespace, extended/negative years, missing seconds, date-times
    /// without a timezone designator (Node treats those as local time),
    /// out-of-range fields (including days past the month's end), and every
    /// non-ISO legacy format.
    pub fn parse(value: &str) -> f64 {
        parse_timestamp(value).unwrap_or(f64::NAN)
    }

    /// Mirrors `Date.UTC(year, month, day, hours, minutes, seconds, ms)`:
    /// arguments are truncated to integers with JS overflow carry (month 12
    /// rolls into the next year, day 0 into the previous month, ...), years
    /// 0..=99 map to 1900..=1999, and the result is clipped to the JS time
    /// range (±8.64e15 ms); NaN for non-finite arguments or out-of-range
    /// results.
    pub fn utc(
        year: f64,
        month: f64,
        day: f64,
        hours: f64,
        minutes: f64,
        seconds: f64,
        ms: f64,
    ) -> f64 {
        if ![year, month, day, hours, minutes, seconds, ms]
            .iter()
            .all(|value| value.is_finite())
        {
            return f64::NAN;
        }
        let year = year.trunc();
        let year = if (0.0..=99.0).contains(&year) {
            1900.0 + year
        } else {
            year
        };
        // Same year/month domain as the major engines; anything beyond is far
        // outside the ±8.64e15 ms time range once combined with in-range
        // day/time arguments.
        if year.abs() > 1_000_000.0 || month.trunc().abs() > 10_000_000.0 {
            return f64::NAN;
        }
        let total_months = year as i64 * 12 + month.trunc() as i64;
        let civil_year = total_months.div_euclid(12) as i32;
        let civil_month = total_months.rem_euclid(12) as u32 + 1;
        let day_number = days_from_civil(civil_year, civil_month, 1) as f64;
        let millis = (day_number + day.trunc() - 1.0) * MS_PER_DAY as f64
            + hours.trunc() * 3_600_000.0
            + minutes.trunc() * 60_000.0
            + seconds.trunc() * 1_000.0
            + ms.trunc();
        if millis.abs() > 8.64e15 {
            f64::NAN
        } else {
            millis
        }
    }

    pub fn get_time(&self) -> f64 {
        self.millis
    }

    pub fn value_of(&self) -> f64 {
        self.millis
    }

    pub fn to_iso_string(&self) -> JsResult<String> {
        if !self.millis.is_finite() {
            return Err(range_error("Invalid Date"));
        }
        let millis = self.millis.trunc() as i64;
        let days = millis.div_euclid(MS_PER_DAY);
        let ms_in_day = millis.rem_euclid(MS_PER_DAY);
        let (year, month, day) = civil_from_days(days);
        let hour = ms_in_day / 3_600_000;
        let minute = (ms_in_day % 3_600_000) / 60_000;
        let second = (ms_in_day % 60_000) / 1_000;
        let milli = ms_in_day % 1_000;
        Ok(format!(
            "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z"
        ))
    }

    /// Mirrors `Date.prototype.toJSON`: the `to_iso_string` text, or the
    /// literal `"null"` for an invalid date (JSON.stringify serializes an
    /// invalid date as `null`).
    pub fn to_json(&self) -> String {
        self.to_iso_string().unwrap_or_else(|_| "null".to_string())
    }

    pub fn get_utc_full_year(&self) -> JsResult<i32> {
        let (year, _, _, _, _, _, _) = self.utc_parts()?;
        Ok(year)
    }

    pub fn get_utc_month(&self) -> JsResult<u32> {
        let (_, month, _, _, _, _, _) = self.utc_parts()?;
        Ok(month - 1)
    }

    pub fn get_utc_date(&self) -> JsResult<u32> {
        let (_, _, day, _, _, _, _) = self.utc_parts()?;
        Ok(day)
    }

    pub fn get_utc_hours(&self) -> JsResult<i64> {
        let (_, _, _, hour, _, _, _) = self.utc_parts()?;
        Ok(hour)
    }

    pub fn get_utc_minutes(&self) -> JsResult<i64> {
        let (_, _, _, _, minute, _, _) = self.utc_parts()?;
        Ok(minute)
    }

    pub fn get_utc_seconds(&self) -> JsResult<i64> {
        let (_, _, _, _, _, second, _) = self.utc_parts()?;
        Ok(second)
    }

    pub fn get_utc_milliseconds(&self) -> JsResult<i64> {
        let (_, _, _, _, _, _, milli) = self.utc_parts()?;
        Ok(milli)
    }

    fn utc_parts(&self) -> JsResult<(i32, u32, u32, i64, i64, i64, i64)> {
        if !self.millis.is_finite() {
            return Err(range_error("Invalid Date"));
        }
        let millis = self.millis.trunc() as i64;
        let days = millis.div_euclid(MS_PER_DAY);
        let ms_in_day = millis.rem_euclid(MS_PER_DAY);
        let (year, month, day) = civil_from_days(days);
        let hour = ms_in_day / 3_600_000;
        let minute = (ms_in_day % 3_600_000) / 60_000;
        let second = (ms_in_day % 60_000) / 1_000;
        let milli = ms_in_day % 1_000;
        Ok((year, month, day, hour, minute, second, milli))
    }
}

fn parse_timestamp(text: &str) -> Option<f64> {
    let (date, time) = match text.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (text, None),
    };
    let (year, month, day) = parse_date_fields(date)?;
    let time_millis = match time {
        Some(time) => parse_time_with_offset(time)?,
        None => 0,
    };
    Some((days_from_civil(year, month, day) * MS_PER_DAY + time_millis) as f64)
}

/// Strict `YYYY-MM-DD` with calendar-aware day validation.
fn parse_date_fields(text: &str) -> Option<(i32, u32, u32)> {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year = parse_digits(&text[0..4])? as i32;
    let month = parse_digits(&text[5..7])? as u32;
    let day = parse_digits(&text[8..10])? as u32;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    Some((year, month, day))
}

/// Strict `HH:mm:ss(.s{1,3})?` followed by `Z` or `±HH:MM`; returns the UTC
/// millisecond offset from midnight of the date part (negative offsets from
/// positive timezones included).
fn parse_time_with_offset(text: &str) -> Option<i64> {
    let (time, offset_millis) = if let Some(time) = text.strip_suffix('Z') {
        (time, 0_i64)
    } else {
        let split_at = text.len().checked_sub(6)?;
        let offset = text.get(split_at..)?;
        let sign = match offset.as_bytes()[0] {
            b'+' => 1_i64,
            b'-' => -1_i64,
            _ => return None,
        };
        if offset.as_bytes()[3] != b':' {
            return None;
        }
        let hours = parse_digits(&offset[1..3])? as i64;
        let minutes = parse_digits(&offset[4..6])? as i64;
        if hours > 23 || minutes > 59 {
            return None;
        }
        (
            &text[..split_at],
            sign * (hours * 3_600_000 + minutes * 60_000),
        )
    };

    let bytes = time.as_bytes();
    if bytes.len() < 8 || bytes[2] != b':' || bytes[5] != b':' {
        return None;
    }
    let hour = parse_digits(&time[0..2])? as i64;
    let minute = parse_digits(&time[3..5])? as i64;
    let second = parse_digits(&time[6..8])? as i64;
    let milli = match &time[8..] {
        "" => 0_i64,
        fraction => {
            let digits = fraction.strip_prefix('.')?;
            if digits.is_empty() || digits.len() > 3 {
                return None;
            }
            let mut padded = digits.to_string();
            while padded.len() < 3 {
                padded.push('0');
            }
            parse_digits(&padded)? as i64
        }
    };
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    Some(hour * 3_600_000 + minute * 60_000 + second * 1_000 + milli - offset_millis)
}

fn parse_digits(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse::<u64>().ok()
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
                29
            } else {
                28
            }
        }
    }
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - i32::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = month as i32;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    i64::from(era * 146_097 + doe - 719_468)
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    (year as i32, month as u32, day as u32)
}
