use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timeout {
    id: u64,
    active: bool,
}

impl Timeout {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn has_ref(&self) -> bool {
        self.active
    }

    pub fn unref(&mut self) -> &mut Self {
        self.active = false;
        self
    }

    pub fn r#ref(&mut self) -> &mut Self {
        self.active = true;
        self
    }
}

pub fn set_timeout(callback: impl FnOnce(), delay_ms: u64) -> Timeout {
    if delay_ms > 0 {
        thread::sleep(Duration::from_millis(delay_ms));
    }
    callback();
    Timeout {
        id: NEXT_ID.fetch_add(1, Ordering::SeqCst),
        active: true,
    }
}

pub fn set_immediate(callback: impl FnOnce()) -> Timeout {
    set_timeout(callback, 0)
}

pub fn clear_timeout(timeout: &mut Timeout) {
    timeout.active = false;
}

pub mod promises {
    use super::{set_timeout, Timeout};

    pub fn set_timeout_value<T>(delay_ms: u64, value: T) -> (Timeout, T) {
        let timeout = set_timeout(|| {}, delay_ms);
        (timeout, value)
    }
}
