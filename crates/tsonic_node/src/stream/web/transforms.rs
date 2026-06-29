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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TransformStreamDefaultController {
    chunks: Vec<Buffer>,
    terminated: bool,
    errored: Option<String>,
}

impl TransformStreamDefaultController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue(&mut self, chunk: Buffer) -> NodeResult<()> {
        if self.terminated {
            return Err(NodeError::new(
                "ERR_INVALID_STATE",
                "transform controller is terminated",
            ));
        }
        self.chunks.push(chunk);
        Ok(())
    }

    pub fn error(&mut self, reason: impl Into<String>) {
        self.errored = Some(reason.into());
        self.terminated = true;
    }

    pub fn terminate(&mut self) {
        self.terminated = true;
    }

    pub fn desired_size(&self) -> Option<usize> {
        if self.terminated {
            None
        } else {
            Some(usize::MAX.saturating_sub(self.chunks.len()))
        }
    }

    pub fn chunks(&self) -> &[Buffer] {
        &self.chunks
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenericTransformStream {
    pub readable: ReadableStream,
    pub writable: WritableStream,
}

pub type ReadableWritablePair = GenericTransformStream;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextEncoderStream {
    readable: ReadableStream,
    writable: WritableStream,
}

impl Default for TextEncoderStream {
    fn default() -> Self {
        Self {
            readable: ReadableStream::default(),
            writable: WritableStream::new(),
        }
    }
}

impl TextEncoderStream {
    pub fn readable(&self) -> &ReadableStream {
        &self.readable
    }

    pub fn writable(&self) -> &WritableStream {
        &self.writable
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextDecoderStream {
    readable: ReadableStream,
    writable: WritableStream,
}

impl Default for TextDecoderStream {
    fn default() -> Self {
        Self {
            readable: ReadableStream::default(),
            writable: WritableStream::new(),
        }
    }
}

impl TextDecoderStream {
    pub fn readable(&self) -> &ReadableStream {
        &self.readable
    }

    pub fn writable(&self) -> &WritableStream {
        &self.writable
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressionStream {
    readable: ReadableStream,
    writable: WritableStream,
    format: String,
}

impl CompressionStream {
    pub fn new(format: &str) -> Self {
        Self {
            readable: ReadableStream::default(),
            writable: WritableStream::new(),
            format: format.to_string(),
        }
    }

    pub fn readable(&self) -> &ReadableStream {
        &self.readable
    }

    pub fn writable(&self) -> &WritableStream {
        &self.writable
    }

    pub fn format(&self) -> &str {
        &self.format
    }
}

pub type DecompressionStream = CompressionStream;

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
