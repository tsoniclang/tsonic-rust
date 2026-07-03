#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blob {
    bytes: Vec<u8>,
    content_type: String,
}

impl Blob {
    pub fn new(parts: &[BlobPart], content_type: impl Into<String>) -> Self {
        let mut bytes = Vec::new();
        for part in parts {
            match part {
                BlobPart::Bytes(value) => bytes.extend_from_slice(value),
                BlobPart::Text(value) => bytes.extend_from_slice(value.as_bytes()),
                BlobPart::Blob(value) => bytes.extend_from_slice(&value.bytes),
            }
        }
        Self {
            bytes,
            content_type: content_type.into().to_ascii_lowercase(),
        }
    }

    pub fn from_text(text: impl Into<String>) -> Self {
        Self::new(&[BlobPart::Text(text.into())], "text/plain")
    }

    pub fn size(&self) -> usize {
        self.bytes.len()
    }

    pub fn content_type(&self) -> &str {
        &self.content_type
    }

    pub fn text(&self) -> JsResult<String> {
        String::from_utf8(self.bytes.clone()).map_err(|_| type_error("Blob text is not UTF-8"))
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        ArrayBuffer::from_bytes(self.bytes.clone())
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn slice(&self, start: usize, end: Option<usize>, content_type: impl Into<String>) -> Self {
        let start = start.min(self.bytes.len());
        let end = end
            .unwrap_or(self.bytes.len())
            .min(self.bytes.len())
            .max(start);
        Self {
            bytes: self.bytes[start..end].to_vec(),
            content_type: content_type.into().to_ascii_lowercase(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobPart {
    Bytes(Vec<u8>),
    Text(String),
    Blob(Blob),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct File {
    blob: Blob,
    name: String,
    last_modified: i64,
}

impl File {
    pub fn new(
        parts: &[BlobPart],
        name: impl Into<String>,
        content_type: impl Into<String>,
        last_modified: i64,
    ) -> Self {
        Self {
            blob: Blob::new(parts, content_type),
            name: name.into(),
            last_modified,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn last_modified(&self) -> i64 {
        self.last_modified
    }

    pub fn blob(&self) -> &Blob {
        &self.blob
    }

    pub fn size(&self) -> usize {
        self.blob.size()
    }

    pub fn content_type(&self) -> &str {
        self.blob.content_type()
    }

    pub fn text(&self) -> JsResult<String> {
        self.blob.text()
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        self.blob.array_buffer()
    }
}
