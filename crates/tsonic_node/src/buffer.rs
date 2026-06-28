use std::cell::RefCell;
use std::rc::Rc;

use tsonic_js::object::JsObject;
use tsonic_js::value::JsValue;

use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone)]
pub struct Buffer {
    storage: Rc<RefCell<Vec<u8>>>,
    offset: usize,
    len: usize,
}

impl PartialEq for Buffer {
    fn eq(&self, other: &Self) -> bool {
        self.to_vec() == other.to_vec()
    }
}

impl Eq for Buffer {}

impl Buffer {
    pub fn alloc(size: usize) -> Self {
        Self::from_bytes(vec![0; size])
    }

    pub fn alloc_unsafe(size: usize) -> Self {
        Self::alloc(size)
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        let len = bytes.len();
        Self {
            storage: Rc::new(RefCell::new(bytes)),
            offset: 0,
            len,
        }
    }

    pub fn from_string(value: &str, encoding: Option<&str>) -> NodeResult<Self> {
        Ok(Self::from_bytes(encode_string(value, encoding)?))
    }

    pub fn byte_length(value: &str, encoding: Option<&str>) -> NodeResult<usize> {
        Ok(encode_string(value, encoding)?.len())
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn as_bytes(&self) -> Vec<u8> {
        self.to_vec()
    }

    pub fn get(&self, index: usize) -> Option<u8> {
        if index >= self.len {
            return None;
        }
        Some(self.storage.borrow()[self.offset + index])
    }

    pub fn set(&mut self, index: usize, value: u8) -> NodeResult<()> {
        if index >= self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer index out of range",
            ));
        }
        self.storage.borrow_mut()[self.offset + index] = value;
        Ok(())
    }

    pub fn fill(&mut self, value: u8, start: usize, end: Option<usize>) -> NodeResult<&mut Self> {
        let end = end.unwrap_or(self.len).min(self.len);
        if start > end {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer fill start is after end",
            ));
        }
        for index in start..end {
            self.set(index, value)?;
        }
        Ok(self)
    }

    pub fn copy(
        &self,
        target: &mut Buffer,
        target_start: usize,
        source_start: usize,
        source_end: Option<usize>,
    ) -> NodeResult<usize> {
        if target_start > target.len || source_start > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer copy range is outside buffer",
            ));
        }
        let source_end = source_end.unwrap_or(self.len).min(self.len);
        if source_start > source_end {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer copy source start is after source end",
            ));
        }
        let count = (source_end - source_start).min(target.len - target_start);
        let bytes = self.read_exact(source_start, count)?;
        target.write_exact(target_start, &bytes)?;
        Ok(count)
    }

    pub fn slice(&self, start: isize, end: Option<isize>) -> Self {
        self.view(start, end)
    }

    pub fn subarray(&self, start: isize, end: Option<isize>) -> Self {
        self.view(start, end)
    }

    pub fn to_string(&self, encoding: Option<&str>) -> NodeResult<String> {
        decode_bytes(&self.to_vec(), encoding)
    }

    pub fn to_json(&self) -> JsValue {
        let values = self
            .to_vec()
            .into_iter()
            .map(|byte| JsValue::Number(f64::from(byte)))
            .collect::<Vec<_>>();
        JsValue::Object(JsObject::from_pairs([
            ("type", JsValue::String("Buffer".to_string())),
            ("data", JsValue::from(values)),
        ]))
    }

    pub fn equals(&self, other: &Buffer) -> bool {
        self.to_vec() == other.to_vec()
    }

    pub fn compare(&self, other: &Buffer) -> i32 {
        match self.to_vec().cmp(&other.to_vec()) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }
    }

    pub fn includes(&self, needle: &[u8], byte_offset: isize) -> bool {
        self.index_of(needle, byte_offset).is_some()
    }

    pub fn index_of(&self, needle: &[u8], byte_offset: isize) -> Option<usize> {
        if needle.is_empty() {
            return Some(normalize_search_start(self.len, byte_offset));
        }
        let start = normalize_search_start(self.len, byte_offset);
        self.to_vec()[start..]
            .windows(needle.len())
            .position(|window| window == needle)
            .map(|index| index + start)
    }

    pub fn last_index_of(&self, needle: &[u8], byte_offset: Option<isize>) -> Option<usize> {
        if needle.is_empty() {
            return Some(
                byte_offset.map_or(self.len, |offset| normalize_search_start(self.len, offset)),
            );
        }
        if needle.len() > self.len {
            return None;
        }
        let max_start = self.len - needle.len();
        let start = byte_offset
            .map(|offset| normalize_search_start(self.len, offset).min(max_start))
            .unwrap_or(max_start);
        let bytes = self.to_vec();
        (0..=start)
            .rev()
            .find(|index| &bytes[*index..*index + needle.len()] == needle)
    }

    pub fn concat(buffers: &[Buffer]) -> Buffer {
        let mut out = Vec::new();
        for buffer in buffers {
            out.extend_from_slice(&buffer.to_vec());
        }
        Buffer::from_bytes(out)
    }

    pub fn read_uint32_le(&self, offset: usize) -> NodeResult<u32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(u32::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_uint_le(&self, offset: usize, byte_length: usize) -> NodeResult<u64> {
        validate_integer_byte_length(byte_length)?;
        let bytes = self.read_exact(offset, byte_length)?;
        let mut value = 0_u64;
        for (index, byte) in bytes.into_iter().enumerate() {
            value |= u64::from(byte) << (index * 8);
        }
        Ok(value)
    }

    pub fn read_uint_be(&self, offset: usize, byte_length: usize) -> NodeResult<u64> {
        validate_integer_byte_length(byte_length)?;
        let bytes = self.read_exact(offset, byte_length)?;
        let mut value = 0_u64;
        for byte in bytes {
            value = (value << 8) | u64::from(byte);
        }
        Ok(value)
    }

    pub fn read_int_le(&self, offset: usize, byte_length: usize) -> NodeResult<i64> {
        let value = self.read_uint_le(offset, byte_length)?;
        sign_extend(value, byte_length)
    }

    pub fn read_int_be(&self, offset: usize, byte_length: usize) -> NodeResult<i64> {
        let value = self.read_uint_be(offset, byte_length)?;
        sign_extend(value, byte_length)
    }

    pub fn read_uint8(&self, offset: usize) -> NodeResult<u8> {
        Ok(self.read_exact(offset, 1)?[0])
    }

    pub fn read_int8(&self, offset: usize) -> NodeResult<i8> {
        Ok(self.read_uint8(offset)? as i8)
    }

    pub fn read_uint16_le(&self, offset: usize) -> NodeResult<u16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(u16::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_uint16_be(&self, offset: usize) -> NodeResult<u16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(u16::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int16_le(&self, offset: usize) -> NodeResult<i16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(i16::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int16_be(&self, offset: usize) -> NodeResult<i16> {
        let bytes = self.read_exact(offset, 2)?;
        Ok(i16::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int32_le(&self, offset: usize) -> NodeResult<i32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(i32::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_int32_be(&self, offset: usize) -> NodeResult<i32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(i32::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_float_le(&self, offset: usize) -> NodeResult<f32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(f32::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_float_be(&self, offset: usize) -> NodeResult<f32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(f32::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_double_le(&self, offset: usize) -> NodeResult<f64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(f64::from_le_bytes(bytes.try_into().unwrap()))
    }

    pub fn read_double_be(&self, offset: usize) -> NodeResult<f64> {
        let bytes = self.read_exact(offset, 8)?;
        Ok(f64::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn write_uint8(&mut self, value: u8, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &[value])
    }

    pub fn write_uint_le(
        &mut self,
        value: u64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        validate_unsigned_integer_value(value, byte_length)?;
        let bytes = (0..byte_length)
            .map(|index| ((value >> (index * 8)) & 0xff) as u8)
            .collect::<Vec<_>>();
        self.write_exact(offset, &bytes)
    }

    pub fn write_uint_be(
        &mut self,
        value: u64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        validate_unsigned_integer_value(value, byte_length)?;
        let bytes = (0..byte_length)
            .rev()
            .map(|index| ((value >> (index * 8)) & 0xff) as u8)
            .collect::<Vec<_>>();
        self.write_exact(offset, &bytes)
    }

    pub fn write_int_le(
        &mut self,
        value: i64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        let encoded = encode_signed_integer_value(value, byte_length)?;
        self.write_uint_le(encoded, offset, byte_length)
    }

    pub fn write_int_be(
        &mut self,
        value: i64,
        offset: usize,
        byte_length: usize,
    ) -> NodeResult<()> {
        let encoded = encode_signed_integer_value(value, byte_length)?;
        self.write_uint_be(encoded, offset, byte_length)
    }

    pub fn write_int8(&mut self, value: i8, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &[value as u8])
    }

    pub fn write_uint16_le(&mut self, value: u16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_uint16_be(&mut self, value: u16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_int16_le(&mut self, value: i16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_int16_be(&mut self, value: i16, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn read_uint32_be(&self, offset: usize) -> NodeResult<u32> {
        let bytes = self.read_exact(offset, 4)?;
        Ok(u32::from_be_bytes(bytes.try_into().unwrap()))
    }

    pub fn write_uint32_le(&mut self, value: u32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_uint32_be(&mut self, value: u32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_int32_le(&mut self, value: i32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_int32_be(&mut self, value: i32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_float_le(&mut self, value: f32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_float_be(&mut self, value: f32, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    pub fn write_double_le(&mut self, value: f64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_le_bytes())
    }

    pub fn write_double_be(&mut self, value: f64, offset: usize) -> NodeResult<()> {
        self.write_exact(offset, &value.to_be_bytes())
    }

    fn view(&self, start: isize, end: Option<isize>) -> Self {
        let (start, end) = normalize_range(self.len, start, end);
        Self {
            storage: Rc::clone(&self.storage),
            offset: self.offset + start,
            len: end.saturating_sub(start),
        }
    }

    fn to_vec(&self) -> Vec<u8> {
        self.storage.borrow()[self.offset..self.offset + self.len].to_vec()
    }

    fn read_exact(&self, offset: usize, len: usize) -> NodeResult<Vec<u8>> {
        if offset + len > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer offset out of range",
            ));
        }
        Ok(self.storage.borrow()[self.offset + offset..self.offset + offset + len].to_vec())
    }

    fn write_exact(&mut self, offset: usize, bytes: &[u8]) -> NodeResult<()> {
        if offset + bytes.len() > self.len {
            return Err(NodeError::new(
                "ERR_OUT_OF_RANGE",
                "buffer offset out of range",
            ));
        }
        self.storage.borrow_mut()[self.offset + offset..self.offset + offset + bytes.len()]
            .copy_from_slice(bytes);
        Ok(())
    }
}

pub fn encode_string(value: &str, encoding: Option<&str>) -> NodeResult<Vec<u8>> {
    match normalize_encoding(encoding)? {
        Encoding::Utf8 => Ok(value.as_bytes().to_vec()),
        Encoding::Latin1 => Ok(value.chars().map(|ch| (ch as u32 & 0xff) as u8).collect()),
        Encoding::Utf16Le => Ok(value.encode_utf16().flat_map(u16::to_le_bytes).collect()),
        Encoding::Hex => decode_hex(value),
        Encoding::Base64 => decode_base64(value),
        Encoding::Base64Url => {
            let mut value = value.replace('-', "+").replace('_', "/");
            while !value.len().is_multiple_of(4) {
                value.push('=');
            }
            decode_base64(&value)
        }
    }
}

pub fn decode_bytes(bytes: &[u8], encoding: Option<&str>) -> NodeResult<String> {
    match normalize_encoding(encoding)? {
        Encoding::Utf8 => String::from_utf8(bytes.to_vec())
            .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string())),
        Encoding::Latin1 => Ok(bytes.iter().map(|byte| *byte as char).collect()),
        Encoding::Utf16Le => {
            let units = bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>();
            Ok(String::from_utf16_lossy(&units))
        }
        Encoding::Hex => Ok(encode_hex(bytes)),
        Encoding::Base64 => Ok(encode_base64(bytes)),
        Encoding::Base64Url => Ok(encode_base64(bytes)
            .replace('+', "-")
            .replace('/', "_")
            .trim_end_matches('=')
            .to_string()),
    }
}

pub fn transcode(buffer: &Buffer, from_encoding: &str, to_encoding: &str) -> NodeResult<Buffer> {
    let text = decode_bytes(&buffer.as_bytes(), Some(from_encoding))?;
    Buffer::from_string(&text, Some(to_encoding))
}

pub fn is_buffer(_value: &Buffer) -> bool {
    true
}

pub fn is_encoding(encoding: &str) -> bool {
    normalize_encoding(Some(encoding)).is_ok()
}

#[derive(Debug, Clone, Copy)]
enum Encoding {
    Utf8,
    Latin1,
    Utf16Le,
    Hex,
    Base64,
    Base64Url,
}

fn normalize_encoding(encoding: Option<&str>) -> NodeResult<Encoding> {
    match encoding.unwrap_or("utf8").to_ascii_lowercase().as_str() {
        "utf8" | "utf-8" => Ok(Encoding::Utf8),
        "ascii" | "latin1" | "binary" => Ok(Encoding::Latin1),
        "utf16le" | "ucs2" | "ucs-2" => Ok(Encoding::Utf16Le),
        "hex" => Ok(Encoding::Hex),
        "base64" => Ok(Encoding::Base64),
        "base64url" => Ok(Encoding::Base64Url),
        other => Err(NodeError::new(
            "ERR_UNKNOWN_ENCODING",
            format!("unknown encoding `{other}`"),
        )),
    }
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

fn validate_integer_byte_length(byte_length: usize) -> NodeResult<()> {
    if (1..=6).contains(&byte_length) {
        Ok(())
    } else {
        Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "byteLength must be between 1 and 6",
        ))
    }
}

fn validate_unsigned_integer_value(value: u64, byte_length: usize) -> NodeResult<()> {
    validate_integer_byte_length(byte_length)?;
    let max_exclusive = 1_u64 << (byte_length * 8);
    if value < max_exclusive {
        Ok(())
    } else {
        Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "value is outside unsigned integer range",
        ))
    }
}

fn encode_signed_integer_value(value: i64, byte_length: usize) -> NodeResult<u64> {
    validate_integer_byte_length(byte_length)?;
    let bits = byte_length * 8;
    let min = -(1_i64 << (bits - 1));
    let max = (1_i64 << (bits - 1)) - 1;
    if value < min || value > max {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "value is outside signed integer range",
        ));
    }
    if value < 0 {
        Ok(((1_i128 << bits) + i128::from(value)) as u64)
    } else {
        Ok(value as u64)
    }
}

fn sign_extend(value: u64, byte_length: usize) -> NodeResult<i64> {
    validate_integer_byte_length(byte_length)?;
    let bits = byte_length * 8;
    let sign_bit = 1_u64 << (bits - 1);
    if value & sign_bit == 0 {
        Ok(value as i64)
    } else {
        Ok((i128::from(value) - (1_i128 << bits)) as i64)
    }
}

fn normalize_index(len: usize, index: isize) -> usize {
    let len = len as isize;
    let normalized = if index < 0 { len + index } else { index };
    normalized.clamp(0, len) as usize
}

fn normalize_search_start(len: usize, offset: isize) -> usize {
    if offset < 0 {
        (len as isize + offset).clamp(0, len as isize) as usize
    } else {
        (offset as usize).min(len)
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn decode_hex(value: &str) -> NodeResult<Vec<u8>> {
    let mut bytes = Vec::with_capacity(value.len() / 2);
    let chars = value.as_bytes();
    if !chars.len().is_multiple_of(2) {
        return Err(NodeError::new(
            "ERR_INVALID_ARG_VALUE",
            "hex string has odd length",
        ));
    }
    for pair in chars.chunks(2) {
        let hi = hex_value(pair[0])?;
        let lo = hex_value(pair[1])?;
        bytes.push((hi << 4) | lo);
    }
    Ok(bytes)
}

fn hex_value(byte: u8) -> NodeResult<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(NodeError::new(
            "ERR_INVALID_ARG_VALUE",
            "invalid hex string",
        )),
    }
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn decode_base64(value: &str) -> NodeResult<Vec<u8>> {
    let clean = value
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if !clean.len().is_multiple_of(4) {
        return Err(NodeError::new(
            "ERR_INVALID_ARG_VALUE",
            "invalid base64 length",
        ));
    }
    let mut out = Vec::new();
    for chunk in clean.chunks(4) {
        let a = base64_value(chunk[0])?;
        let b = base64_value(chunk[1])?;
        let c = if chunk[2] == b'=' {
            64
        } else {
            base64_value(chunk[2])?
        };
        let d = if chunk[3] == b'=' {
            64
        } else {
            base64_value(chunk[3])?
        };
        out.push((a << 2) | (b >> 4));
        if c != 64 {
            out.push(((b & 0x0f) << 4) | (c >> 2));
        }
        if d != 64 {
            out.push(((c & 0x03) << 6) | d);
        }
    }
    Ok(out)
}

fn base64_value(byte: u8) -> NodeResult<u8> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(NodeError::new(
            "ERR_INVALID_ARG_VALUE",
            "invalid base64 string",
        )),
    }
}
