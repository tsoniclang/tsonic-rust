use super::Readable;
use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};
use tsonic_js::json;
use tsonic_js::web::{Blob, BlobPart};
use tsonic_js::{ArrayBuffer, JsValue};

pub fn buffer(readable: &mut Readable) -> NodeResult<Buffer> {
    let mut chunks = Vec::new();
    while let Some(chunk) = readable.read() {
        chunks.push(chunk);
    }
    Ok(Buffer::concat(&chunks))
}

pub fn text(readable: &mut Readable, encoding: Option<&str>) -> NodeResult<String> {
    buffer(readable)?.to_string(encoding)
}

pub fn array_buffer(readable: &mut Readable) -> NodeResult<ArrayBuffer> {
    Ok(ArrayBuffer::from_bytes(
        buffer(readable)?.as_bytes().to_vec(),
    ))
}

pub fn blob(readable: &mut Readable, content_type: impl Into<String>) -> NodeResult<Blob> {
    Ok(Blob::new(
        &[BlobPart::Bytes(buffer(readable)?.as_bytes().to_vec())],
        content_type,
    ))
}

pub fn json(readable: &mut Readable, encoding: Option<&str>) -> NodeResult<JsValue> {
    json::parse(&text(readable, encoding)?)
        .map_err(|error| NodeError::new("ERR_INVALID_JSON", error.to_string()))
}
