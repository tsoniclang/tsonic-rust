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

pub fn compare(buf1: &Buffer, buf2: &Buffer) -> i32 {
    buf1.compare(buf2)
}

pub fn is_buffer(_value: &Buffer) -> bool {
    true
}

pub fn is_encoding(encoding: &str) -> bool {
    normalize_encoding(Some(encoding)).is_ok()
}

pub fn is_utf8(input: &[u8]) -> bool {
    std::str::from_utf8(input).is_ok()
}

pub fn is_ascii(input: &[u8]) -> bool {
    input.is_ascii()
}

pub fn resolve_object_url(_id: &str) -> Option<Blob> {
    None
}

pub fn blob_size(blob: &Blob) -> usize {
    blob.size()
}

pub fn blob_type(blob: &Blob) -> &str {
    blob.content_type()
}

pub fn blob_text(blob: &Blob) -> NodeResult<String> {
    blob.text()
        .map_err(|error| NodeError::new(error.kind().to_string(), error.message().to_string()))
}

pub fn blob_array_buffer(blob: &Blob) -> tsonic_js::ArrayBuffer {
    blob.array_buffer()
}

pub fn blob_bytes(blob: &Blob) -> Vec<u8> {
    blob.bytes().to_vec()
}

pub fn blob_slice(blob: &Blob, start: usize, end: Option<usize>, content_type: &str) -> Blob {
    blob.slice(start, end, content_type)
}

pub fn blob_stream(blob: &Blob) -> crate::stream::web::ReadableStream {
    crate::stream::web::ReadableStream::from_chunks(vec![Buffer::from_bytes(blob.bytes().to_vec())])
}

pub fn file_name(file: &File) -> &str {
    file.name()
}

pub fn file_last_modified(file: &File) -> i64 {
    file.last_modified()
}

pub fn file_webkit_relative_path(_file: &File) -> &str {
    ""
}

pub fn file_size(file: &File) -> usize {
    file.size()
}

pub fn file_type(file: &File) -> &str {
    file.content_type()
}

pub fn file_text(file: &File) -> NodeResult<String> {
    file.text()
        .map_err(|error| NodeError::new(error.kind().to_string(), error.message().to_string()))
}

pub fn file_array_buffer(file: &File) -> tsonic_js::ArrayBuffer {
    file.array_buffer()
}
