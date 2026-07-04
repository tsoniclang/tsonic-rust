//! Fixture capability with a fallible property and a formatter carrier.

use tsonic_rust_runtime::{JsError, JsErrorKind, TsonicResult};

pub struct Sink {
    entries: i32,
}

pub fn open_sink() -> Sink {
    Sink { entries: 0 }
}

impl Sink {
    pub fn path(&self) -> TsonicResult<String> {
        if self.entries < 0 {
            return Err(JsError::new(JsErrorKind::Error, "sink detached").into());
        }
        Ok(String::from("/var/log/acme.log"))
    }

    pub fn write(&mut self, line: &str) -> i32 {
        let _ = line;
        self.entries += 1;
        self.entries
    }
}

// Capability APIs keep their authored casing: rows reference this name
// verbatim through metadata, never through local-name recasing.
#[allow(non_snake_case)]
pub fn openSinkNamed(name: &str) -> Sink {
    let _ = name;
    Sink { entries: 0 }
}
