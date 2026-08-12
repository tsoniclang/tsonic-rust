use std::collections::HashMap;

pub const ANSWER: i32 = 42;

pub type Pair<T> = (T, T);

pub enum Mode {
    Read,
    Write,
    Payload(i32),
}

pub enum StructuredMode {
    Named { value: i32 },
}

pub static GLOBAL_COUNT: i32 = 1;

pub struct Widget<T> {
    pub count: i32,
    value: T,
}

impl<T> Widget<T> {
    pub fn new(value: T) -> Self {
        Self { count: 1, value }
    }

    pub fn replace(&mut self, value: T) -> T {
        std::mem::replace(&mut self.value, value)
    }

    pub fn into_value(self) -> T {
        self.value
    }

    pub fn value(&self) -> &T {
        &self.value
    }
}

pub fn double(value: i32) -> i32 {
    value * 2
}

pub fn identity<T>(value: T) -> T {
    value
}

pub fn maybe_positive(value: i32) -> Option<i32> {
    (value > 0).then_some(value)
}

pub fn duplicate(value: i32) -> Vec<i32> {
    vec![value, value]
}

pub fn singleton_map(value: i32) -> HashMap<String, i32> {
    HashMap::from([(String::from("value"), value)])
}

#[cfg(feature = "extras")]
pub fn featured(value: i32) -> i32 {
    value + 100
}

pub unsafe fn dangerous(value: i32) -> i32 {
    value
}

pub unsafe fn first_byte(pointer: *const u8) -> u8 {
    unsafe { *pointer }
}

static BYTE: u8 = 23;

pub fn byte_ptr() -> *const u8 {
    &BYTE
}

pub fn mode_code(mode: Mode) -> i32 {
    match mode {
        Mode::Read => 1,
        Mode::Write => 2,
        Mode::Payload(value) => value,
    }
}

pub fn pair_sum(value: Pair<i32>) -> i32 {
    value.0 + value.1
}

pub fn sum(values: &[i32]) -> i32 {
    values.iter().sum()
}

pub fn fill(values: &mut [u8], value: u8) {
    values.fill(value);
}

pub mod math {
    pub fn triple(value: i32) -> i32 {
        value * 3
    }
}

pub mod factory {
    pub fn int_widget(value: i32) -> crate::Widget<i32> {
        crate::Widget::new(value)
    }
}
