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

    pub fn from(chunks: Vec<Buffer>) -> Self {
        Self::from_chunks(chunks)
    }

    pub fn pipe(&mut self, writable: &mut Writable) -> NodeResult<()> {
        pipeline(self, writable)
    }

    pub fn unpipe(&mut self, _writable: &mut Writable) -> NodeResult<()> {
        Ok(())
    }

    pub fn destroy(&mut self) {
        self.index = self.chunks.len();
    }

    pub fn to_vec(mut self) -> Vec<Buffer> {
        let mut out = Vec::new();
        while let Some(chunk) = self.read() {
            out.push(chunk);
        }
        out
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

    pub fn destroy(&mut self) {
        self.ended = true;
    }

    pub fn is_ended(&self) -> bool {
        self.ended
    }

    pub fn chunks(&self) -> &[Buffer] {
        &self.chunks
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Duplex {
    readable: Readable,
    writable: Writable,
}

impl Duplex {
    pub fn new(readable: Readable, writable: Writable) -> Self {
        Self { readable, writable }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        self.readable.read()
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        self.writable.write(chunk)
    }

    pub fn end(&mut self) {
        self.writable.end();
    }

    pub fn writable_chunks(&self) -> &[Buffer] {
        self.writable.chunks()
    }
}

#[derive(Clone)]
pub struct Transform {
    transform: fn(Buffer) -> Buffer,
    readable: Readable,
    writable: Writable,
}

impl Transform {
    pub fn new(transform: fn(Buffer) -> Buffer) -> Self {
        Self {
            transform,
            readable: Readable::default(),
            writable: Writable::new(),
        }
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        let transformed = (self.transform)(chunk);
        self.writable.write(transformed.clone()) && {
            self.readable.chunks.push(transformed);
            true
        }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        self.readable.read()
    }

    pub fn end(&mut self) {
        self.writable.end();
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PassThrough {
    inner: Duplex,
}

impl PassThrough {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        let readable_chunk = chunk.clone();
        self.inner.write(chunk) && {
            self.inner.readable.chunks.push(readable_chunk);
            true
        }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        self.inner.read()
    }

    pub fn end(&mut self) {
        self.inner.end();
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

pub fn finished(readable: &Readable, writable: &Writable) -> bool {
    readable.is_ended() && writable.is_ended()
}

pub mod promises {
    use super::{pipeline as pipeline_sync, Readable, Writable};
    use crate::error::NodeResult;

    pub fn pipeline(readable: &mut Readable, writable: &mut Writable) -> NodeResult<()> {
        pipeline_sync(readable, writable)
    }

    pub fn finished(readable: &Readable, writable: &Writable) -> bool {
        super::finished(readable, writable)
    }
}

pub mod web {
    use super::{Readable, Writable};
    use crate::buffer::Buffer;

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct ReadableStream {
        chunks: Vec<Buffer>,
    }

    impl ReadableStream {
        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct WritableStream {
        chunks: Vec<Buffer>,
    }

    impl WritableStream {
        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }
    }

    pub fn readable_to_web(readable: Readable) -> ReadableStream {
        ReadableStream {
            chunks: readable.to_vec(),
        }
    }

    pub fn readable_from_web(stream: ReadableStream) -> Readable {
        Readable::from_chunks(stream.chunks)
    }

    pub fn writable_to_web(writable: Writable) -> WritableStream {
        WritableStream {
            chunks: writable.chunks().to_vec(),
        }
    }

    pub fn writable_from_web(stream: WritableStream) -> Writable {
        let mut writable = Writable::new();
        for chunk in stream.chunks {
            writable.write(chunk);
        }
        writable
    }
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
