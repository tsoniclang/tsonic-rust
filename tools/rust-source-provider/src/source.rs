use rustc_span::{Span, source_map::SourceMap};
use serde::Serialize;

#[derive(Clone, Copy, Serialize)]
pub struct SourceRange {
    pub start: u32,
    pub end: u32,
}

pub fn source_range(map: &SourceMap, span: Span) -> Result<SourceRange, String> {
    if span.is_dummy() {
        return Err("An authored native token has no source position.".to_owned());
    }
    let start = map.lookup_byte_offset(span.lo());
    if !start.sf.contains(span.hi()) {
        return Err("A native source span crosses source-file boundaries.".to_owned());
    }
    Ok(SourceRange {
        start: start.sf.original_relative_byte_pos(span.lo()).0,
        end: start.sf.original_relative_byte_pos(span.hi()).0,
    })
}
