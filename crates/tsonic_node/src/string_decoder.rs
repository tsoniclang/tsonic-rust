use crate::buffer::decode_bytes;
use crate::error::NodeResult;

#[derive(Debug, Clone)]
pub struct StringDecoder {
    encoding: String,
}

impl StringDecoder {
    pub fn new(encoding: Option<&str>) -> Self {
        Self {
            encoding: encoding.unwrap_or("utf8").to_string(),
        }
    }

    pub fn write(&self, bytes: &[u8]) -> NodeResult<String> {
        decode_bytes(bytes, Some(&self.encoding))
    }

    pub fn end(&self, bytes: Option<&[u8]>) -> NodeResult<String> {
        match bytes {
            Some(bytes) => self.write(bytes),
            None => Ok(String::new()),
        }
    }
}
