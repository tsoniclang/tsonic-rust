use crate::array_buffer::ArrayBuffer;
use crate::errors::{range_error, JsResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataView {
    bytes: Vec<u8>,
}

impl DataView {
    pub fn new(buffer: ArrayBuffer) -> Self {
        Self {
            bytes: buffer.as_bytes().to_vec(),
        }
    }

    pub fn byte_length(&self) -> usize {
        self.bytes.len()
    }

    pub fn get_uint8(&self, offset: usize) -> JsResult<u8> {
        self.bytes
            .get(offset)
            .copied()
            .ok_or_else(|| range_error("DataView offset out of bounds"))
    }

    pub fn set_uint8(&mut self, offset: usize, value: u8) -> JsResult<()> {
        let slot = self
            .bytes
            .get_mut(offset)
            .ok_or_else(|| range_error("DataView offset out of bounds"))?;
        *slot = value;
        Ok(())
    }

    pub fn get_int32(&self, offset: usize, little_endian: bool) -> JsResult<i32> {
        let bytes = self.read_4(offset)?;
        Ok(if little_endian {
            i32::from_le_bytes(bytes)
        } else {
            i32::from_be_bytes(bytes)
        })
    }

    pub fn set_int32(&mut self, offset: usize, value: i32, little_endian: bool) -> JsResult<()> {
        let bytes = if little_endian {
            value.to_le_bytes()
        } else {
            value.to_be_bytes()
        };
        self.write(offset, &bytes)
    }

    pub fn get_float64(&self, offset: usize, little_endian: bool) -> JsResult<f64> {
        let slice = self.read(offset, 8)?;
        let mut bytes = [0_u8; 8];
        bytes.copy_from_slice(slice);
        Ok(if little_endian {
            f64::from_le_bytes(bytes)
        } else {
            f64::from_be_bytes(bytes)
        })
    }

    pub fn set_float64(&mut self, offset: usize, value: f64, little_endian: bool) -> JsResult<()> {
        let bytes = if little_endian {
            value.to_le_bytes()
        } else {
            value.to_be_bytes()
        };
        self.write(offset, &bytes)
    }

    fn read_4(&self, offset: usize) -> JsResult<[u8; 4]> {
        let slice = self.read(offset, 4)?;
        let mut bytes = [0_u8; 4];
        bytes.copy_from_slice(slice);
        Ok(bytes)
    }

    fn read(&self, offset: usize, len: usize) -> JsResult<&[u8]> {
        self.bytes
            .get(offset..offset + len)
            .ok_or_else(|| range_error("DataView offset out of bounds"))
    }

    fn write(&mut self, offset: usize, bytes: &[u8]) -> JsResult<()> {
        let target = self
            .bytes
            .get_mut(offset..offset + bytes.len())
            .ok_or_else(|| range_error("DataView offset out of bounds"))?;
        target.copy_from_slice(bytes);
        Ok(())
    }
}
