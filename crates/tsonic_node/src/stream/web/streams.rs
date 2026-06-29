use super::{Readable, Writable};
use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuingStrategy {
    pub high_water_mark: Option<usize>,
    pub size: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueuingStrategyInit {
    pub high_water_mark: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CountQueuingStrategy {
    high_water_mark: usize,
}

impl CountQueuingStrategy {
    pub fn new(init: QueuingStrategyInit) -> Self {
        Self {
            high_water_mark: init.high_water_mark,
        }
    }

    pub fn high_water_mark(&self) -> usize {
        self.high_water_mark
    }

    pub fn size(&self) -> usize {
        1
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteLengthQueuingStrategy {
    high_water_mark: usize,
}

impl ByteLengthQueuingStrategy {
    pub fn new(init: QueuingStrategyInit) -> Self {
        Self {
            high_water_mark: init.high_water_mark,
        }
    }

    pub fn high_water_mark(&self) -> usize {
        self.high_water_mark
    }

    pub fn size(&self, chunk: &Buffer) -> usize {
        chunk.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StreamPipeOptions {
    pub prevent_abort: bool,
    pub prevent_cancel: bool,
    pub prevent_close: bool,
    pub signal_aborted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReadableStreamGetReaderOptions {
    pub mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReadableStreamIteratorOptions {
    pub prevent_cancel: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReadableStreamBYOBReaderReadOptions {
    pub min: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadableStreamReadResult {
    pub done: bool,
    pub value: Option<Buffer>,
}

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

    pub fn get_reader_with_options(
        &mut self,
        options: ReadableStreamGetReaderOptions,
    ) -> NodeResult<ReadableStreamDefaultReader<'_>> {
        if options.mode.as_deref() == Some("byob") {
            return Err(NodeError::new(
                "ERR_INVALID_ARG_VALUE",
                "BYOB reader requires byte stream controller",
            ));
        }
        self.get_reader()
    }

    pub fn cancel(&mut self) {
        self.canceled = true;
        self.index = self.chunks.len();
    }

    pub fn cancel_with_reason(&mut self, _reason: &str) {
        self.cancel();
    }

    pub fn values(&mut self) -> Vec<Buffer> {
        let mut values = Vec::new();
        while self.index < self.chunks.len() {
            values.push(self.chunks[self.index].clone());
            self.index += 1;
        }
        values
    }

    pub fn values_with_options(
        &mut self,
        _options: ReadableStreamIteratorOptions,
    ) -> Vec<Buffer> {
        self.values()
    }

    pub fn pipe_to(&mut self, destination: &mut WritableStream) -> NodeResult<()> {
        let chunks = self.values();
        for chunk in chunks {
            destination.write(chunk)?;
        }
        destination.close();
        Ok(())
    }

    pub fn pipe_to_with_options(
        &mut self,
        destination: &mut WritableStream,
        options: &StreamPipeOptions,
    ) -> NodeResult<()> {
        if options.signal_aborted {
            if !options.prevent_cancel {
                self.cancel();
            }
            if !options.prevent_abort {
                destination.abort();
            }
            return Err(NodeError::new("ABORT_ERR", "pipeTo aborted"));
        }
        let chunks = self.values();
        for chunk in chunks {
            destination.write(chunk)?;
        }
        if !options.prevent_close {
            destination.close();
        }
        Ok(())
    }

    pub fn tee(&self) -> (ReadableStream, ReadableStream) {
        (self.clone(), self.clone())
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
