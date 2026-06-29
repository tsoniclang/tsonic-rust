use std::cell::RefCell;
use std::rc::Rc;

use tsonic_js::object::JsObject;
use tsonic_js::value::JsValue;
pub use tsonic_js::web::{Blob, BlobPart, File};

use crate::error::{NodeError, NodeResult};

pub const INSPECT_MAX_BYTES: usize = 50;
pub const K_MAX_LENGTH: usize = isize::MAX as usize;
pub const K_STRING_MAX_LENGTH: usize = i32::MAX as usize;
pub const MAX_LENGTH: usize = K_MAX_LENGTH;
pub const MAX_STRING_LENGTH: usize = K_STRING_MAX_LENGTH;
pub const DEFAULT_POOL_SIZE: usize = 8 * 1024;

pub mod constants {
    pub const MAX_LENGTH: usize = super::MAX_LENGTH;
    pub const MAX_STRING_LENGTH: usize = super::MAX_STRING_LENGTH;
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BlobPropertyBag {
    pub endings: Option<String>,
    pub content_type: Option<String>,
}

pub type BlobOptions = BlobPropertyBag;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FilePropertyBag {
    pub endings: Option<String>,
    pub content_type: Option<String>,
    pub last_modified: Option<i64>,
}

pub type FileOptions = FilePropertyBag;
pub type BlobPartCarrier = BlobPart;

#[derive(Debug, Clone)]
pub struct Buffer {
    storage: Rc<RefCell<Vec<u8>>>,
    offset: usize,
    len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BufferValue {
    Byte(u8),
    Bytes(Vec<u8>),
    Text {
        value: String,
        encoding: Option<String>,
    },
}

impl BufferValue {
    pub fn byte(value: u8) -> Self {
        Self::Byte(value)
    }

    pub fn bytes(value: impl Into<Vec<u8>>) -> Self {
        Self::Bytes(value.into())
    }

    pub fn text(value: impl Into<String>, encoding: Option<&str>) -> Self {
        Self::Text {
            value: value.into(),
            encoding: encoding.map(str::to_string),
        }
    }

    fn into_bytes(self) -> NodeResult<Vec<u8>> {
        match self {
            Self::Byte(value) => Ok(vec![value]),
            Self::Bytes(value) => Ok(value),
            Self::Text { value, encoding } => encode_string(&value, encoding.as_deref()),
        }
    }
}

impl PartialEq for Buffer {
    fn eq(&self, other: &Self) -> bool {
        self.to_vec() == other.to_vec()
    }
}

impl Eq for Buffer {}

