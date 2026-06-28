use crate::buffer::Buffer;
use crate::error::NodeResult;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Readable {
    chunks: Vec<Buffer>,
    index: usize,
}

impl Readable {
    pub fn from_chunks(chunks: Vec<Buffer>) -> Self {
        Self { chunks, index: 0 }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        let chunk = self.chunks.get(self.index).cloned();
        if chunk.is_some() {
            self.index += 1;
        }
        chunk
    }

    pub fn is_ended(&self) -> bool {
        self.index >= self.chunks.len()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Writable {
    chunks: Vec<Buffer>,
    ended: bool,
}

impl Writable {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        if self.ended {
            return false;
        }
        self.chunks.push(chunk);
        true
    }

    pub fn end(&mut self) {
        self.ended = true;
    }

    pub fn chunks(&self) -> &[Buffer] {
        &self.chunks
    }
}

pub fn pipeline(readable: &mut Readable, writable: &mut Writable) -> NodeResult<()> {
    while let Some(chunk) = readable.read() {
        if !writable.write(chunk) {
            break;
        }
    }
    writable.end();
    Ok(())
}

pub mod consumers {
    use super::Readable;
    use crate::buffer::Buffer;
    use crate::error::NodeResult;

    pub fn buffer(readable: &mut Readable) -> NodeResult<Buffer> {
        let mut chunks = Vec::new();
        while let Some(chunk) = readable.read() {
            chunks.push(chunk);
        }
        Ok(Buffer::concat(&chunks))
    }

    pub fn text(readable: &mut Readable, encoding: Option<&str>) -> NodeResult<String> {
        buffer(readable)?.to_string(encoding)
    }
}
