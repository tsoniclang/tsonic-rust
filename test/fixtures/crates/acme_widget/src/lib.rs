use std::collections::HashMap;
use std::boxed::Box;
use std::pin::Pin;
use tsonic_rust_runtime::{TsonicError, TsonicResult};

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
pub static mut MUTABLE_COUNT: i32 = 1;

pub union NumberBits {
    pub integer: u32,
    pub float: f32,
}

pub enum SimpleMode {
    Off,
    On,
}

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

    pub fn into_box_value(self: Box<Self>) -> T {
        self.value
    }

    pub fn pinned_count(self: Pin<&mut Self>) -> i32 {
        self.count
    }
}

pub trait Family {
    type Item<T>;
}

pub fn pass_family_item<F: Family, T>(value: F::Item<T>) -> F::Item<T> {
    value
}

pub trait LendingFamily {
    type Item<'a>
    where
        Self: 'a;
}

pub trait View {
    fn value(&self) -> i32;
}

pub fn pass_lending_item<'a, F>(value: F::Item<'a>) -> F::Item<'a>
where
    F: LendingFamily + 'a,
{
    value
}

pub fn choose_borrowed<'short, 'long: 'short, T: 'short + ?Sized, const N: usize>(
    short: &'short T,
    _long: &'long T,
    _witness: &[u8; N],
) -> &'short T {
    short
}

pub fn preserve_borrowed<'a, T: ?Sized + 'a>(value: &'a T) -> &'a T {
    value
}

pub fn apply_borrowed(
    callback: for<'a> fn(&'a i32) -> &'a i32,
    value: &i32,
) -> &i32 {
    callback(value)
}

pub fn inspect_view(value: &(dyn View + '_)) -> i32 {
    value.value()
}

pub fn opaque_borrow<'a>(value: &'a i32) -> impl Copy + use<'a> {
    value
}

pub trait Metric<T> {
    type Output;

    const UNIT: i32;

    fn measure(&self, scale: T) -> Self::Output;

    fn reset(&mut self, value: T);

    fn from_metric(value: T) -> Self
    where
        Self: Sized;
}

impl<T: Copy> Metric<T> for Widget<T> {
    type Output = T;

    const UNIT: i32 = 1;

    fn measure(&self, scale: T) -> Self::Output {
        let _ = &self.value;
        scale
    }

    fn reset(&mut self, value: T) {
        self.value = value;
    }

    fn from_metric(value: T) -> Self {
        Self { count: Self::UNIT, value }
    }
}

pub trait ConstantSlot {
    const SLOT: i32;
}

pub trait MethodSlot {
    fn SLOT() -> i32;
}

impl<T> ConstantSlot for Widget<T> {
    const SLOT: i32 = 1;
}

impl<T> MethodSlot for Widget<T> {
    fn SLOT() -> i32 {
        2
    }
}

pub struct CheckedWidget {
    pub value: i32,
}

impl CheckedWidget {
    pub fn new(value: i32) -> TsonicResult<Self> {
        if value < 0 {
            Err(TsonicError::unsupported("negative widget value"))
        } else {
            Ok(Self { value })
        }
    }
}

pub struct GenericFactory {
    pub value: i32,
}

impl GenericFactory {
    pub fn new<T>(_marker: T) -> Self {
        Self { value: 27 }
    }
}

pub fn double(value: i32) -> i32 {
    value * 2
}

pub fn borrowed_answer(value: &i32) -> &i32 {
    value
}

pub fn borrowed_label() -> &'static str {
    "widget"
}

pub fn borrowed_owned_string(value: &String) -> &String {
    value
}

pub fn borrowed_slice(values: &[i32]) -> &[i32] {
    values
}

pub fn checked_double(value: i32) -> TsonicResult<i32> {
    if value < 0 {
        Err(TsonicError::unsupported("negative input"))
    } else {
        Ok(value * 2)
    }
}

pub fn foreign_result(value: i32) -> Result<i32, String> {
    if value < 0 {
        Err(String::from("negative input"))
    } else {
        Ok(value)
    }
}

pub fn identity<T>(value: T) -> T {
    value
}

pub fn cloned<T: Clone>(value: &T) -> T {
    value.clone()
}

pub fn copied<T>(value: T) -> T
where
    T: Copy,
{
    value
}

pub fn integer_bits(value: u32) -> NumberBits {
    NumberBits { integer: value }
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

static INTEGER_FORMAT: &[u8] = b"%d\0";

pub fn integer_format() -> *const i8 {
    INTEGER_FORMAT.as_ptr().cast()
}

#[link(name = "c")]
unsafe extern "C" {
    #[link_name = "printf"]
    pub fn variadic_printf(format: *const i8, ...) -> i32;
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

pub fn simple_mode_code(mode: SimpleMode) -> i32 {
    match mode {
        SimpleMode::Off => 0,
        SimpleMode::On => 1,
    }
}

pub fn apply(value: i32, callback: fn(i32) -> i32) -> i32 {
    callback(value)
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
