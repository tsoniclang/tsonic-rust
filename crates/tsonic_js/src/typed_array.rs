//! Typed array carriers with copy `slice` and shared-view `subarray`.

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

use crate::array_buffer::ArrayBuffer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypedArrayKind {
    Int8,
    Uint8,
    Uint8Clamped,
    Int16,
    Uint16,
    Int32,
    Uint32,
    Float32,
    Float64,
}

impl fmt::Display for TypedArrayKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::Int8 => "Int8",
            Self::Uint8 => "Uint8",
            Self::Uint8Clamped => "Uint8Clamped",
            Self::Int16 => "Int16",
            Self::Uint16 => "Uint16",
            Self::Int32 => "Int32",
            Self::Uint32 => "Uint32",
            Self::Float32 => "Float32",
            Self::Float64 => "Float64",
        };
        write!(f, "{name}")
    }
}

pub trait TypedElement: Copy + Default {
    const KIND: TypedArrayKind;
    const BYTES_PER_ELEMENT: usize;

    fn write_bytes(self, out: &mut [u8]);
    fn read_bytes(bytes: &[u8]) -> Self;
}

macro_rules! int_element {
    ($type:ty, $kind:expr) => {
        impl TypedElement for $type {
            const KIND: TypedArrayKind = $kind;
            const BYTES_PER_ELEMENT: usize = std::mem::size_of::<$type>();

            fn write_bytes(self, out: &mut [u8]) {
                out.copy_from_slice(&self.to_le_bytes());
            }

            fn read_bytes(bytes: &[u8]) -> Self {
                let mut slot = [0_u8; std::mem::size_of::<$type>()];
                slot.copy_from_slice(bytes);
                <$type>::from_le_bytes(slot)
            }
        }
    };
}

int_element!(i8, TypedArrayKind::Int8);
int_element!(u8, TypedArrayKind::Uint8);
int_element!(i16, TypedArrayKind::Int16);
int_element!(u16, TypedArrayKind::Uint16);
int_element!(i32, TypedArrayKind::Int32);
int_element!(u32, TypedArrayKind::Uint32);
int_element!(f32, TypedArrayKind::Float32);
int_element!(f64, TypedArrayKind::Float64);

#[derive(Debug, Clone)]
struct SharedBytes {
    bytes: Rc<RefCell<Vec<u8>>>,
    byte_offset: usize,
    len: usize,
}

#[derive(Debug, Clone)]
pub struct TypedArray<T: TypedElement> {
    shared: SharedBytes,
    _element: std::marker::PhantomData<T>,
}

pub type Int8Array = TypedArray<i8>;
pub type Uint8Array = TypedArray<u8>;
pub type Uint8ClampedArray = TypedArray<ClampedU8>;
pub type Int16Array = TypedArray<i16>;
pub type Uint16Array = TypedArray<u16>;
pub type Int32Array = TypedArray<i32>;
pub type Uint32Array = TypedArray<u32>;
pub type Float32Array = TypedArray<f32>;
pub type Float64Array = TypedArray<f64>;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ClampedU8(pub u8);

impl From<u8> for ClampedU8 {
    fn from(value: u8) -> Self {
        Self(value)
    }
}

impl TypedElement for ClampedU8 {
    const KIND: TypedArrayKind = TypedArrayKind::Uint8Clamped;
    const BYTES_PER_ELEMENT: usize = 1;

    fn write_bytes(self, out: &mut [u8]) {
        out[0] = self.0;
    }

    fn read_bytes(bytes: &[u8]) -> Self {
        Self(bytes[0])
    }
}

impl<T: TypedElement> TypedArray<T> {
    pub fn new(length: usize) -> Self {
        Self {
            shared: SharedBytes {
                bytes: Rc::new(RefCell::new(vec![0; length * T::BYTES_PER_ELEMENT])),
                byte_offset: 0,
                len: length,
            },
            _element: std::marker::PhantomData,
        }
    }

    pub fn from_vec(values: Vec<T>) -> Self {
        let mut bytes = vec![0; values.len() * T::BYTES_PER_ELEMENT];
        for (index, value) in values.into_iter().enumerate() {
            let start = index * T::BYTES_PER_ELEMENT;
            value.write_bytes(&mut bytes[start..start + T::BYTES_PER_ELEMENT]);
        }
        Self {
            shared: SharedBytes {
                bytes: Rc::new(RefCell::new(bytes)),
                byte_offset: 0,
                len: 0,
            },
            _element: std::marker::PhantomData,
        }
        .with_len_from_bytes()
    }

    pub fn from_buffer(buffer: ArrayBuffer) -> Self {
        let len = buffer.byte_length() / T::BYTES_PER_ELEMENT;
        Self {
            shared: SharedBytes {
                bytes: Rc::new(RefCell::new(buffer.as_bytes().to_vec())),
                byte_offset: 0,
                len,
            },
            _element: std::marker::PhantomData,
        }
    }

    pub fn kind(&self) -> TypedArrayKind {
        T::KIND
    }

    pub fn len(&self) -> usize {
        self.shared.len
    }

    pub fn is_empty(&self) -> bool {
        self.shared.len == 0
    }

    pub fn byte_length(&self) -> usize {
        self.shared.len * T::BYTES_PER_ELEMENT
    }

    pub fn get(&self, index: usize) -> Option<T> {
        let (start, end) = self.byte_range(index)?;
        let bytes = self.shared.bytes.borrow();
        Some(T::read_bytes(&bytes[start..end]))
    }

    pub fn set_index(&mut self, index: usize, value: T) {
        let Some((start, end)) = self.byte_range(index) else {
            return;
        };
        let mut bytes = self.shared.bytes.borrow_mut();
        value.write_bytes(&mut bytes[start..end]);
    }

    pub fn set_from_slice(&mut self, source: &[T], offset: usize) -> crate::JsResult<()> {
        if offset + source.len() > self.len() {
            return Err(crate::range_error("typed array set source out of bounds"));
        }
        for (index, value) in source.iter().copied().enumerate() {
            self.set_index(offset + index, value);
        }
        Ok(())
    }

    pub fn map<U, F>(&self, mut mapper: F) -> Vec<U>
    where
        F: FnMut(T) -> U,
    {
        (0..self.len())
            .filter_map(|index| self.get(index))
            .map(&mut mapper)
            .collect()
    }

    pub fn fill(&mut self, value: T, start: isize, end: Option<isize>) {
        let (start, end) = normalize_range(self.len(), start, end);
        for index in start..end {
            self.set_index(index, value);
        }
    }

    pub fn slice(&self, start: isize, end: Option<isize>) -> Self {
        let (start, end) = normalize_range(self.len(), start, end);
        let mut out = Self::new(end.saturating_sub(start));
        for (out_index, source_index) in (start..end).enumerate() {
            if let Some(value) = self.get(source_index) {
                out.set_index(out_index, value);
            }
        }
        out
    }

    pub fn subarray(&self, start: isize, end: Option<isize>) -> Self {
        let (start, end) = normalize_range(self.len(), start, end);
        Self {
            shared: SharedBytes {
                bytes: Rc::clone(&self.shared.bytes),
                byte_offset: self.shared.byte_offset + start * T::BYTES_PER_ELEMENT,
                len: end.saturating_sub(start),
            },
            _element: std::marker::PhantomData,
        }
    }

    fn byte_range(&self, index: usize) -> Option<(usize, usize)> {
        if index >= self.len() {
            return None;
        }
        let start = self.shared.byte_offset + index * T::BYTES_PER_ELEMENT;
        Some((start, start + T::BYTES_PER_ELEMENT))
    }

    fn with_len_from_bytes(mut self) -> Self {
        self.shared.len = self.shared.bytes.borrow().len() / T::BYTES_PER_ELEMENT;
        self
    }
}

pub trait TypedArrayLen {
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool;
    fn byte_length(&self) -> usize;
}

impl<T: TypedElement> TypedArrayLen for TypedArray<T> {
    fn len(&self) -> usize {
        self.len()
    }

    fn is_empty(&self) -> bool {
        self.is_empty()
    }

    fn byte_length(&self) -> usize {
        self.byte_length()
    }
}

pub fn len<T: TypedArrayLen>(array: &T) -> usize {
    array.len()
}

pub fn byte_length<T: TypedArrayLen>(array: &T) -> usize {
    array.byte_length()
}

fn normalize_range(len: usize, start: isize, end: Option<isize>) -> (usize, usize) {
    let start = normalize_index(len, start);
    let end = normalize_index(len, end.unwrap_or(len as isize));
    if end < start {
        (start, start)
    } else {
        (start, end)
    }
}

fn normalize_index(len: usize, index: isize) -> usize {
    let len = len as isize;
    let normalized = if index < 0 { len + index } else { index };
    normalized.clamp(0, len) as usize
}
