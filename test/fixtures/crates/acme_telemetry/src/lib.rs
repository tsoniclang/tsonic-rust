//! Fixture capability crate with async and fallible surfaces.

use tsonic_rust_runtime::{JsError, JsErrorKind, TsonicResult};

pub struct Meter {
    samples: i32,
}

pub fn create_meter(name: &str) -> TsonicResult<Meter> {
    if name.is_empty() {
        return Err(JsError::new(JsErrorKind::RangeError, "meter name is empty").into());
    }
    Ok(Meter { samples: 0 })
}

impl Meter {
    pub async fn record(&mut self, value: f64) -> TsonicResult<i32> {
        if !value.is_finite() {
            return Err(JsError::new(JsErrorKind::RangeError, "sample must be finite").into());
        }
        self.samples += 1;
        Ok(self.samples)
    }

    pub fn total(&self) -> i32 {
        self.samples
    }
}
