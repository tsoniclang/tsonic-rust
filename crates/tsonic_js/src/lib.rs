//! JS-facing closed APIs.

pub mod array;
pub mod array_buffer;
pub mod console;
pub mod date;
pub mod equality;
pub mod errors;
pub mod json;
pub mod map;
pub mod math;
pub mod number;
pub mod object;
pub mod regexp;
pub mod set;
pub mod string;
pub mod typed_array;
pub mod value;

pub use array::{JsArray, JsSlot};
pub use array_buffer::ArrayBuffer;
pub use errors::{range_error, syntax_error, type_error, unsupported, JsResult};
pub use map::JsMap;
pub use object::{JsObject, JsPropertyValue};
pub use set::JsSet;
pub use tsonic_runtime::{JsError, JsErrorKind};
pub use typed_array::{
    Float32Array, Float64Array, Int16Array, Int32Array, Int8Array, TypedArrayKind, Uint16Array,
    Uint32Array, Uint8Array, Uint8ClampedArray,
};
pub use value::JsValue;
