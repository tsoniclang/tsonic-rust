use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timeout {
    id: u64,
    active: bool,
    delay_ms: u64,
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

    pub fn refresh(&mut self) -> &mut Self {
        self.active = true;
        self
    }

    pub fn close(&mut self) -> &mut Self {
        self.active = false;
        self
    }

    pub fn delay_ms(&self) -> u64 {
        self.delay_ms
    }

    pub fn on_timeout(&self, callback: impl FnOnce()) {
        callback();
    }

    pub fn on_immediate(&self, callback: impl FnOnce()) {
        callback();
    }
}

pub type Immediate = Timeout;
pub type Timer = Timeout;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimerOptions {
    pub r#ref: bool,
    pub signal_aborted: bool,
}

impl Default for TimerOptions {
    fn default() -> Self {
        Self {
            r#ref: true,
            signal_aborted: false,
        }
    }
}

pub fn set_timeout(callback: impl FnOnce(), delay_ms: u64) -> Timeout {
    set_timeout_with_options(callback, delay_ms, TimerOptions::default())
}

pub fn set_timeout_with_options(
    callback: impl FnOnce(),
    delay_ms: u64,
    options: TimerOptions,
) -> Timeout {
    if delay_ms > 0 {
        thread::sleep(Duration::from_millis(delay_ms));
    }
    if !options.signal_aborted {
        callback();
    }
    Timeout {
        id: NEXT_ID.fetch_add(1, Ordering::SeqCst),
        active: options.r#ref && !options.signal_aborted,
        delay_ms,
    }
}

pub fn set_immediate(callback: impl FnOnce()) -> Timeout {
    set_immediate_with_options(callback, TimerOptions::default())
}

pub fn set_immediate_with_options(callback: impl FnOnce(), options: TimerOptions) -> Timeout {
    set_timeout_with_options(callback, 0, options)
}

pub fn set_interval(callback: impl FnMut(), delay_ms: u64) -> Timeout {
    set_interval_with_options(callback, delay_ms, TimerOptions::default())
}

pub fn set_interval_with_options(
    mut callback: impl FnMut(),
    delay_ms: u64,
    options: TimerOptions,
) -> Timeout {
    if delay_ms > 0 {
        thread::sleep(Duration::from_millis(delay_ms));
    }
    if !options.signal_aborted {
        callback();
    }
    Timeout {
        id: NEXT_ID.fetch_add(1, Ordering::SeqCst),
        active: options.r#ref && !options.signal_aborted,
        delay_ms,
    }
}

pub fn clear_timeout(timeout: &mut Timeout) {
    timeout.active = false;
}

pub fn clear_immediate(timeout: &mut Timeout) {
    clear_timeout(timeout);
}

pub fn clear_interval(timeout: &mut Timeout) {
    clear_timeout(timeout);
}

pub mod promises {
    use super::{set_timeout_with_options, Timeout, TimerOptions};

    pub fn set_timeout_value<T>(delay_ms: u64, value: T) -> (Timeout, T) {
        set_timeout_value_with_options(delay_ms, value, TimerOptions::default())
    }

    pub fn set_timeout_value_with_options<T>(
        delay_ms: u64,
        value: T,
        options: TimerOptions,
    ) -> (Timeout, T) {
        let timeout = set_timeout_with_options(|| {}, delay_ms, options);
        (timeout, value)
    }

    pub fn set_immediate_value<T>(value: T) -> (Timeout, T) {
        set_timeout_value(0, value)
    }

    pub fn set_immediate_value_with_options<T>(value: T, options: TimerOptions) -> (Timeout, T) {
        set_timeout_value_with_options(0, value, options)
    }

    pub fn set_interval_values<T: Clone>(
        delay_ms: u64,
        value: T,
        count: usize,
    ) -> (Timeout, Vec<T>) {
        set_interval_values_with_options(delay_ms, value, count, TimerOptions::default())
    }

    pub fn set_interval_values_with_options<T: Clone>(
        delay_ms: u64,
        value: T,
        count: usize,
        options: TimerOptions,
    ) -> (Timeout, Vec<T>) {
        let timeout = set_timeout_with_options(|| {}, delay_ms, options);
        (timeout, vec![value; count])
    }

    pub mod scheduler {
        pub fn wait(delay_ms: u64) {
            if delay_ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            }
        }

        pub fn yield_now() {
            std::thread::yield_now();
        }
    }
}
