use std::io::{Read, Write};

use flate2::read::{DeflateDecoder, GzDecoder};
use flate2::write::{DeflateEncoder, GzEncoder};
use flate2::Compression;

use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZlibOptions {
    pub flush: Option<i32>,
    pub finish_flush: Option<i32>,
    pub chunk_size: usize,
    pub window_bits: Option<i32>,
    pub level: i32,
    pub mem_level: Option<i32>,
    pub strategy: i32,
    pub max_output_length: Option<usize>,
    pub dictionary: Option<Buffer>,
    pub info: bool,
}

impl Default for ZlibOptions {
    fn default() -> Self {
        Self {
            flush: None,
            finish_flush: None,
            chunk_size: constants::Z_DEFAULT_CHUNK as usize,
            window_bits: None,
            level: constants::Z_DEFAULT_COMPRESSION,
            mem_level: None,
            strategy: constants::Z_DEFAULT_STRATEGY,
            max_output_length: None,
            dictionary: None,
            info: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BrotliOptions {
    pub flush: Option<i32>,
    pub finish_flush: Option<i32>,
    pub chunk_size: usize,
    pub params: std::collections::BTreeMap<i32, i32>,
    pub max_output_length: Option<usize>,
    pub info: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ZstdOptions {
    pub flush: Option<i32>,
    pub finish_flush: Option<i32>,
    pub chunk_size: usize,
    pub params: std::collections::BTreeMap<i32, i32>,
    pub max_output_length: Option<usize>,
    pub dictionary: Option<Buffer>,
    pub info: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZlibMode {
    Deflate,
    Inflate,
    Gzip,
    Gunzip,
    DeflateRaw,
    InflateRaw,
    Unzip,
    BrotliCompress,
    BrotliDecompress,
    ZstdCompress,
    ZstdDecompress,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Zlib {
    mode: ZlibMode,
    bytes_written: usize,
    closed: bool,
    options: ZlibOptions,
}

impl Zlib {
    pub fn new(mode: ZlibMode, options: Option<ZlibOptions>) -> Self {
        Self {
            mode,
            bytes_written: 0,
            closed: false,
            options: options.unwrap_or_default(),
        }
    }

    pub fn bytes_written(&self) -> usize {
        self.bytes_written
    }

    pub fn close(&mut self, callback: Option<impl FnOnce()>) {
        self.closed = true;
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn closed(&self) -> bool {
        self.closed
    }

    pub fn reset(&mut self) {
        self.bytes_written = 0;
        self.closed = false;
    }

    pub fn flush(&self, callback: Option<impl FnOnce()>) {
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn params(&mut self, level: i32, strategy: i32, callback: impl FnOnce()) {
        self.options.level = level;
        self.options.strategy = strategy;
        callback();
    }

    pub fn process(&mut self, input: &Buffer) -> NodeResult<Buffer> {
        self.bytes_written += input.len();
        match self.mode {
            ZlibMode::Deflate => deflate_sync_with_options(input, &self.options),
            ZlibMode::Inflate => inflate_sync(input),
            ZlibMode::Gzip => gzip_sync_with_options(input, &self.options),
            ZlibMode::Gunzip => gunzip_sync(input),
            ZlibMode::DeflateRaw => deflate_raw_sync(input),
            ZlibMode::InflateRaw => inflate_raw_sync(input),
            ZlibMode::Unzip => unzip_sync(input),
            ZlibMode::BrotliCompress => brotli_compress_sync(input),
            ZlibMode::BrotliDecompress => brotli_decompress_sync(input),
            ZlibMode::ZstdCompress | ZlibMode::ZstdDecompress => zstd_unsupported(),
        }
    }
}

pub type Deflate = Zlib;
pub type Inflate = Zlib;
pub type Gzip = Zlib;
pub type Gunzip = Zlib;
pub type DeflateRaw = Zlib;
pub type InflateRaw = Zlib;
pub type Unzip = Zlib;
pub type BrotliCompress = Zlib;
pub type BrotliDecompress = Zlib;
pub type ZstdCompress = Zlib;
pub type ZstdDecompress = Zlib;

pub fn create_deflate(options: Option<ZlibOptions>) -> Deflate {
    Zlib::new(ZlibMode::Deflate, options)
}

pub fn create_inflate(options: Option<ZlibOptions>) -> Inflate {
    Zlib::new(ZlibMode::Inflate, options)
}

pub fn create_gzip(options: Option<ZlibOptions>) -> Gzip {
    Zlib::new(ZlibMode::Gzip, options)
}

pub fn create_gunzip(options: Option<ZlibOptions>) -> Gunzip {
    Zlib::new(ZlibMode::Gunzip, options)
}

pub fn create_deflate_raw(options: Option<ZlibOptions>) -> DeflateRaw {
    Zlib::new(ZlibMode::DeflateRaw, options)
}

pub fn create_inflate_raw(options: Option<ZlibOptions>) -> InflateRaw {
    Zlib::new(ZlibMode::InflateRaw, options)
}

pub fn create_unzip(options: Option<ZlibOptions>) -> Unzip {
    Zlib::new(ZlibMode::Unzip, options)
}

pub fn create_brotli_compress(_options: Option<BrotliOptions>) -> BrotliCompress {
    Zlib::new(ZlibMode::BrotliCompress, None)
}

pub fn create_brotli_decompress(_options: Option<BrotliOptions>) -> BrotliDecompress {
    Zlib::new(ZlibMode::BrotliDecompress, None)
}

pub fn create_zstd_compress(_options: Option<ZstdOptions>) -> ZstdCompress {
    Zlib::new(ZlibMode::ZstdCompress, None)
}

pub fn create_zstd_decompress(_options: Option<ZstdOptions>) -> ZstdDecompress {
    Zlib::new(ZlibMode::ZstdDecompress, None)
}

pub fn gzip_sync(input: &Buffer) -> NodeResult<Buffer> {
    gzip_sync_with_options(input, &ZlibOptions::default())
}

pub fn gzip_sync_with_options(input: &Buffer, options: &ZlibOptions) -> NodeResult<Buffer> {
    let mut encoder = GzEncoder::new(Vec::new(), compression_from_level(options.level));
    encoder
        .write_all(&input.as_bytes())
        .map_err(map_zlib_error)?;
    limit_output(
        encoder.finish().map_err(map_zlib_error)?,
        options.max_output_length,
    )
}

pub fn gunzip_sync(input: &Buffer) -> NodeResult<Buffer> {
    let bytes = input.as_bytes();
    let mut decoder = GzDecoder::new(bytes.as_slice());
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).map_err(map_zlib_error)?;
    Ok(Buffer::from_bytes(output))
}

pub fn deflate_sync(input: &Buffer) -> NodeResult<Buffer> {
    deflate_sync_with_options(input, &ZlibOptions::default())
}

pub fn deflate_sync_with_options(input: &Buffer, options: &ZlibOptions) -> NodeResult<Buffer> {
    let mut encoder = DeflateEncoder::new(Vec::new(), compression_from_level(options.level));
    encoder
        .write_all(&input.as_bytes())
        .map_err(map_zlib_error)?;
    limit_output(
        encoder.finish().map_err(map_zlib_error)?,
        options.max_output_length,
    )
}

pub fn inflate_sync(input: &Buffer) -> NodeResult<Buffer> {
    let bytes = input.as_bytes();
    let mut decoder = DeflateDecoder::new(bytes.as_slice());
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).map_err(map_zlib_error)?;
    Ok(Buffer::from_bytes(output))
}

pub fn deflate_raw_sync(input: &Buffer) -> NodeResult<Buffer> {
    deflate_sync(input)
}

pub fn inflate_raw_sync(input: &Buffer) -> NodeResult<Buffer> {
    inflate_sync(input)
}

pub fn unzip_sync(input: &Buffer) -> NodeResult<Buffer> {
    gunzip_sync(input).or_else(|_| inflate_sync(input))
}

pub fn gzip_string_sync(input: &str, encoding: &str) -> NodeResult<Buffer> {
    gzip_sync(&Buffer::from_string(input, Some(encoding))?)
}

pub fn gunzip_string_sync(input: &Buffer, encoding: &str) -> NodeResult<String> {
    gunzip_sync(input)?.to_string(Some(encoding))
}

pub fn brotli_compress_sync(input: &Buffer) -> NodeResult<Buffer> {
    let mut output = Vec::new();
    {
        let mut writer = brotli::CompressorWriter::new(&mut output, 4096, 5, 22);
        writer
            .write_all(&input.as_bytes())
            .map_err(map_zlib_error)?;
    }
    Ok(Buffer::from_bytes(output))
}

pub fn brotli_decompress_sync(input: &Buffer) -> NodeResult<Buffer> {
    let bytes = input.as_bytes();
    let mut decoder = brotli::Decompressor::new(bytes.as_slice(), 4096);
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).map_err(map_zlib_error)?;
    Ok(Buffer::from_bytes(output))
}

pub fn zstd_compress_sync(_input: &Buffer) -> NodeResult<Buffer> {
    zstd_unsupported()
}

pub fn zstd_decompress_sync(_input: &Buffer) -> NodeResult<Buffer> {
    zstd_unsupported()
}

fn compression_from_level(level: i32) -> Compression {
    if level == constants::Z_DEFAULT_COMPRESSION {
        Compression::default()
    } else {
        Compression::new(level.clamp(0, 9) as u32)
    }
}

fn limit_output(output: Vec<u8>, max_output_length: Option<usize>) -> NodeResult<Buffer> {
    if max_output_length.is_some_and(|max| output.len() > max) {
        return Err(NodeError::new(
            "ERR_BUFFER_TOO_LARGE",
            "compressed output exceeds maxOutputLength",
        ));
    }
    Ok(Buffer::from_bytes(output))
}

fn zstd_unsupported<T>() -> NodeResult<T> {
    Err(NodeError::new(
        "ERR_UNSUPPORTED_OPERATION",
        "Zstd compression requires an approved zstd dependency",
    ))
}

fn map_zlib_error(error: std::io::Error) -> NodeError {
    NodeError::new("Z_DATA_ERROR", error.to_string())
}

pub mod constants {
    pub const Z_NO_FLUSH: i32 = 0;
    pub const Z_PARTIAL_FLUSH: i32 = 1;
    pub const Z_SYNC_FLUSH: i32 = 2;
    pub const Z_FULL_FLUSH: i32 = 3;
    pub const Z_FINISH: i32 = 4;
    pub const Z_BLOCK: i32 = 5;
    pub const Z_OK: i32 = 0;
    pub const Z_STREAM_END: i32 = 1;
    pub const Z_NEED_DICT: i32 = 2;
    pub const Z_ERRNO: i32 = -1;
    pub const Z_STREAM_ERROR: i32 = -2;
    pub const Z_DATA_ERROR: i32 = -3;
    pub const Z_MEM_ERROR: i32 = -4;
    pub const Z_BUF_ERROR: i32 = -5;
    pub const Z_VERSION_ERROR: i32 = -6;
    pub const Z_NO_COMPRESSION: i32 = 0;
    pub const Z_BEST_SPEED: i32 = 1;
    pub const Z_BEST_COMPRESSION: i32 = 9;
    pub const Z_DEFAULT_COMPRESSION: i32 = -1;
    pub const Z_FILTERED: i32 = 1;
    pub const Z_HUFFMAN_ONLY: i32 = 2;
    pub const Z_RLE: i32 = 3;
    pub const Z_FIXED: i32 = 4;
    pub const Z_DEFAULT_STRATEGY: i32 = 0;
    pub const Z_MIN_WINDOWBITS: i32 = 8;
    pub const Z_MAX_WINDOWBITS: i32 = 15;
    pub const Z_DEFAULT_WINDOWBITS: i32 = 15;
    pub const Z_MIN_CHUNK: i32 = 64;
    pub const Z_MAX_CHUNK: i32 = i32::MAX;
    pub const Z_DEFAULT_CHUNK: i32 = 16 * 1024;
    pub const Z_MIN_MEMLEVEL: i32 = 1;
    pub const Z_MAX_MEMLEVEL: i32 = 9;
    pub const Z_DEFAULT_MEMLEVEL: i32 = 8;
    pub const DEFLATE: i32 = 1;
    pub const INFLATE: i32 = 2;
    pub const GZIP: i32 = 3;
    pub const GUNZIP: i32 = 4;
    pub const DEFLATERAW: i32 = 5;
    pub const INFLATERAW: i32 = 6;
    pub const UNZIP: i32 = 7;
    pub const BROTLI_ENCODE: i32 = 8;
    pub const BROTLI_DECODE: i32 = 9;
    pub const BROTLI_OPERATION_PROCESS: i32 = 0;
    pub const BROTLI_OPERATION_FLUSH: i32 = 1;
    pub const BROTLI_OPERATION_FINISH: i32 = 2;
    pub const BROTLI_OPERATION_EMIT_METADATA: i32 = 3;
    pub const BROTLI_PARAM_MODE: i32 = 0;
    pub const BROTLI_PARAM_QUALITY: i32 = 1;
    pub const BROTLI_PARAM_LGWIN: i32 = 2;
    pub const BROTLI_PARAM_LGBLOCK: i32 = 3;
    pub const BROTLI_MODE_GENERIC: i32 = 0;
    pub const BROTLI_MODE_TEXT: i32 = 1;
    pub const BROTLI_MODE_FONT: i32 = 2;
    pub const BROTLI_DEFAULT_QUALITY: i32 = 11;
    pub const BROTLI_MIN_QUALITY: i32 = 0;
    pub const BROTLI_MAX_QUALITY: i32 = 11;
    pub const BROTLI_DEFAULT_WINDOW: i32 = 22;
    pub const BROTLI_MIN_WINDOW_BITS: i32 = 10;
    pub const BROTLI_MAX_WINDOW_BITS: i32 = 24;
    pub const ZSTD_COMPRESS: i32 = 10;
    pub const ZSTD_DECOMPRESS: i32 = 11;
    pub const ZSTD_CLEVEL_DEFAULT: i32 = 3;
}
