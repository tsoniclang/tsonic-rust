//! Dense-array helpers and dense/static statics.

pub mod dense;
pub mod statics;

pub use dense::{
    at,
    clear as dense_clear,
    copy_within,
    concat,
    from_iter,
    index_of,
    includes,
    join,
    keys,
    last_index_of,
    of,
    pop,
    push,
    reverse,
    shift,
    splice,
    slice,
    unshift,
    values,
    fill,
    entries,
};
pub use statics::{from_string, is_array};
