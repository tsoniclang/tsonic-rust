use std::io::{Read, Write};

use flate2::read::{DeflateDecoder, GzDecoder};
use flate2::write::{DeflateEncoder, GzEncoder};
use flate2::Compression;

use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};

pub fn gzip_sync(input: &Buffer) -> NodeResult<Buffer> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&input.as_bytes())
        .map_err(map_zlib_error)?;
    Ok(Buffer::from_bytes(
        encoder.finish().map_err(map_zlib_error)?,
    ))
}

pub fn gunzip_sync(input: &Buffer) -> NodeResult<Buffer> {
    let bytes = input.as_bytes();
    let mut decoder = GzDecoder::new(bytes.as_slice());
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).map_err(map_zlib_error)?;
    Ok(Buffer::from_bytes(output))
}

pub fn deflate_sync(input: &Buffer) -> NodeResult<Buffer> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&input.as_bytes())
        .map_err(map_zlib_error)?;
    Ok(Buffer::from_bytes(
        encoder.finish().map_err(map_zlib_error)?,
    ))
}

pub fn inflate_sync(input: &Buffer) -> NodeResult<Buffer> {
    let bytes = input.as_bytes();
    let mut decoder = DeflateDecoder::new(bytes.as_slice());
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).map_err(map_zlib_error)?;
    Ok(Buffer::from_bytes(output))
}

pub fn gzip_string_sync(input: &str, encoding: &str) -> NodeResult<Buffer> {
    gzip_sync(&Buffer::from_string(input, Some(encoding))?)
}

pub fn gunzip_string_sync(input: &Buffer, encoding: &str) -> NodeResult<String> {
    gunzip_sync(input)?.to_string(Some(encoding))
}

fn map_zlib_error(error: std::io::Error) -> NodeError {
    NodeError::new("Z_DATA_ERROR", error.to_string())
}
