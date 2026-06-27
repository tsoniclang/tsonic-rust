//! Dense-array helpers and dense/static statics.

pub mod dense;
pub mod statics;

pub use dense::{
    at, clear as dense_clear, concat, copy_within, entries, fill, from_iter, includes, index_of,
    join, keys, last_index_of, of, pop, push, reverse, shift, slice, splice, unshift, values,
};
pub use statics::{from_string, is_array};
