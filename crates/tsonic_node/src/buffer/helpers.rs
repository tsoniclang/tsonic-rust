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
