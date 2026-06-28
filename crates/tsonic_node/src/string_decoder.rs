use crate::buffer::decode_bytes;
use crate::error::NodeResult;

#[derive(Debug, Clone)]
pub struct StringDecoder {
    encoding: String,
    pending: Vec<u8>,
}

impl StringDecoder {
    pub fn new(encoding: Option<&str>) -> Self {
        Self {
            encoding: encoding.unwrap_or("utf8").to_string(),
            pending: Vec::new(),
        }
    }

    pub fn encoding(&self) -> &str {
        &self.encoding
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    pub fn write(&mut self, bytes: &[u8]) -> NodeResult<String> {
        if !is_utf8_encoding(&self.encoding) {
            return decode_bytes(bytes, Some(&self.encoding));
        }
        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(text) => {
                let result = text.to_string();
                self.pending.clear();
                Ok(result)
            }
            Err(error) => {
                let valid = error.valid_up_to();
                let result = String::from_utf8_lossy(&self.pending[..valid]).into_owned();
                let pending = self.pending[valid..].to_vec();
                self.pending = pending;
                Ok(result)
            }
        }
    }

    pub fn end(&mut self, bytes: Option<&[u8]>) -> NodeResult<String> {
        let mut result = String::new();
        if let Some(bytes) = bytes {
            result.push_str(&self.write(bytes)?);
        }
        if !self.pending.is_empty() {
            result.push_str(&String::from_utf8_lossy(&self.pending));
            self.pending.clear();
        }
        Ok(result)
    }
}

fn is_utf8_encoding(encoding: &str) -> bool {
    matches!(encoding.to_ascii_lowercase().as_str(), "utf8" | "utf-8")
}
