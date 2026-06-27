//! Closed ArrayBuffer carrier.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArrayBuffer {
    bytes: Vec<u8>,
}

impl ArrayBuffer {
    pub fn new(byte_length: usize) -> Self {
        Self {
            bytes: vec![0_u8; byte_length],
        }
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }

    pub fn byte_length(&self) -> usize {
        self.bytes.len()
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn as_mut_bytes(&mut self) -> &mut [u8] {
        &mut self.bytes
    }

    pub fn slice(&self, start: isize, end: Option<isize>) -> Self {
        let max = self.bytes.len() as isize;
        let s = normalize_index(start, max);
        let e = normalize_index(end.unwrap_or(max), max);
        Self {
            bytes: self.bytes[s..e].to_vec(),
        }
    }
}

fn normalize_index(value: isize, max: isize) -> usize {
    let clamped = if value < 0 {
        max.saturating_add(value)
    } else {
        value
    }
    .clamp(0, max);
    clamped as usize
}
