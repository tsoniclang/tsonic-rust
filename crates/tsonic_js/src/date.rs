//! Minimal UTC-only Date carrier for Stage 1.

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

    pub fn parse(text: &str) -> JsResult<Self> {
        let text = text.trim();
        if let Ok(value) = text.parse::<f64>() {
            return Ok(Self::from_millis(value));
        }
        parse_iso_utc(text)
            .map(Self::from_millis)
            .ok_or_else(|| range_error("Invalid Date"))
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

    pub fn to_json(&self) -> JsResult<String> {
        self.to_iso_string()
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

fn parse_iso_utc(text: &str) -> Option<f64> {
    if !text.ends_with('Z') {
        return None;
    }
    let body = &text[..text.len() - 1];
    let (date, time) = body.split_once('T')?;
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;
    if date_parts.next().is_some() {
        return None;
    }

    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<u32>().ok()?;
    let minute = time_parts.next()?.parse::<u32>().ok()?;
    let second_part = time_parts.next()?;
    if time_parts.next().is_some() {
        return None;
    }
    let (second, milli) = match second_part.split_once('.') {
        Some((second, milli)) => {
            let mut ms = milli.chars().take(3).collect::<String>();
            while ms.len() < 3 {
                ms.push('0');
            }
            (second.parse::<u32>().ok()?, ms.parse::<u32>().ok()?)
        }
        None => (second_part.parse::<u32>().ok()?, 0),
    };
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let millis = days * MS_PER_DAY
        + i64::from(hour) * 3_600_000
        + i64::from(minute) * 60_000
        + i64::from(second) * 1_000
        + i64::from(milli);
    Some(millis as f64)
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
