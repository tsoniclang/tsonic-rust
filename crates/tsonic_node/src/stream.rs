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
    use crate::error::{NodeError, NodeResult};

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct ReadableStream {
        chunks: Vec<Buffer>,
        index: usize,
        locked: bool,
        canceled: bool,
    }

    impl ReadableStream {
        pub fn from_chunks(chunks: Vec<Buffer>) -> Self {
            Self {
                chunks,
                index: 0,
                locked: false,
                canceled: false,
            }
        }

        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }

        pub fn locked(&self) -> bool {
            self.locked
        }

        pub fn canceled(&self) -> bool {
            self.canceled
        }

        pub fn get_reader(&mut self) -> NodeResult<ReadableStreamDefaultReader<'_>> {
            if self.locked {
                return Err(NodeError::new("ERR_INVALID_STATE", "stream is locked"));
            }
            self.locked = true;
            Ok(ReadableStreamDefaultReader {
                stream: self,
                released: false,
            })
        }

        pub fn cancel(&mut self) {
            self.canceled = true;
            self.index = self.chunks.len();
        }

        pub fn values(&mut self) -> Vec<Buffer> {
            let mut values = Vec::new();
            while self.index < self.chunks.len() {
                values.push(self.chunks[self.index].clone());
                self.index += 1;
            }
            values
        }

        pub fn pipe_to(&mut self, destination: &mut WritableStream) -> NodeResult<()> {
            let chunks = self.values();
            for chunk in chunks {
                destination.write(chunk)?;
            }
            destination.close();
            Ok(())
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct WritableStream {
        chunks: Vec<Buffer>,
        locked: bool,
        closed: bool,
        aborted: bool,
    }

    impl WritableStream {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }

        pub fn locked(&self) -> bool {
            self.locked
        }

        pub fn closed(&self) -> bool {
            self.closed
        }

        pub fn aborted(&self) -> bool {
            self.aborted
        }

        pub fn write(&mut self, chunk: Buffer) -> NodeResult<()> {
            if self.closed || self.aborted {
                return Err(NodeError::new(
                    "ERR_STREAM_WRITE_AFTER_END",
                    "cannot write after stream is closed",
                ));
            }
            self.chunks.push(chunk);
            Ok(())
        }

        pub fn close(&mut self) {
            self.closed = true;
        }

        pub fn abort(&mut self) {
            self.aborted = true;
            self.closed = true;
        }

        pub fn get_writer(&mut self) -> NodeResult<WritableStreamDefaultWriter<'_>> {
            if self.locked {
                return Err(NodeError::new("ERR_INVALID_STATE", "stream is locked"));
            }
            self.locked = true;
            Ok(WritableStreamDefaultWriter {
                stream: self,
                released: false,
            })
        }
    }

    pub struct ReadableStreamDefaultReader<'a> {
        stream: &'a mut ReadableStream,
        released: bool,
    }

    impl ReadableStreamDefaultReader<'_> {
        pub fn read(&mut self) -> Option<Buffer> {
            if self.released || self.stream.canceled {
                return None;
            }
            let chunk = self.stream.chunks.get(self.stream.index).cloned();
            if chunk.is_some() {
                self.stream.index += 1;
            }
            chunk
        }

        pub fn release_lock(&mut self) {
            if !self.released {
                self.released = true;
                self.stream.locked = false;
            }
        }
    }

    impl Drop for ReadableStreamDefaultReader<'_> {
        fn drop(&mut self) {
            self.release_lock();
        }
    }

    pub struct WritableStreamDefaultWriter<'a> {
        stream: &'a mut WritableStream,
        released: bool,
    }

    impl WritableStreamDefaultWriter<'_> {
        pub fn write(&mut self, chunk: Buffer) -> NodeResult<()> {
            if self.released {
                return Err(NodeError::new("ERR_INVALID_STATE", "writer lock released"));
            }
            self.stream.write(chunk)
        }

        pub fn close(&mut self) {
            self.stream.close();
        }

        pub fn abort(&mut self) {
            self.stream.abort();
        }

        pub fn release_lock(&mut self) {
            if !self.released {
                self.released = true;
                self.stream.locked = false;
            }
        }
    }

    impl Drop for WritableStreamDefaultWriter<'_> {
        fn drop(&mut self) {
            self.release_lock();
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct TransformStream {
        readable: ReadableStream,
        writable: WritableStream,
    }

    impl TransformStream {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn readable(&self) -> &ReadableStream {
            &self.readable
        }

        pub fn writable(&self) -> &WritableStream {
            &self.writable
        }

        pub fn write_passthrough(&mut self, chunk: Buffer) -> NodeResult<()> {
            self.writable.write(chunk.clone())?;
            self.readable.chunks.push(chunk);
            Ok(())
        }
    }

    pub fn readable_to_web(readable: Readable) -> ReadableStream {
        ReadableStream::from_chunks(readable.to_vec())
    }

    pub fn readable_from_web(stream: ReadableStream) -> Readable {
        Readable::from_chunks(stream.chunks)
    }

    pub fn writable_to_web(writable: Writable) -> WritableStream {
        let mut stream = WritableStream::new();
        stream.chunks = writable.chunks().to_vec();
        stream
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
    use crate::error::{NodeError, NodeResult};
    use tsonic_js::json;
    use tsonic_js::web::{Blob, BlobPart};
    use tsonic_js::{ArrayBuffer, JsValue};

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

    pub fn array_buffer(readable: &mut Readable) -> NodeResult<ArrayBuffer> {
        Ok(ArrayBuffer::from_bytes(
            buffer(readable)?.as_bytes().to_vec(),
        ))
    }

    pub fn blob(readable: &mut Readable, content_type: impl Into<String>) -> NodeResult<Blob> {
        Ok(Blob::new(
            &[BlobPart::Bytes(buffer(readable)?.as_bytes().to_vec())],
            content_type,
        ))
    }

    pub fn json(readable: &mut Readable, encoding: Option<&str>) -> NodeResult<JsValue> {
        json::parse(&text(readable, encoding)?)
            .map_err(|error| NodeError::new("ERR_INVALID_JSON", error.to_string()))
    }
}
