
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReadableStreamDefaultController {
    chunks: Vec<Buffer>,
    closed: bool,
    errored: Option<String>,
}

impl ReadableStreamDefaultController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue(&mut self, chunk: Buffer) -> NodeResult<()> {
        if self.closed {
            return Err(NodeError::new("ERR_INVALID_STATE", "controller is closed"));
        }
        self.chunks.push(chunk);
        Ok(())
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn error(&mut self, reason: impl Into<String>) {
        self.errored = Some(reason.into());
        self.closed = true;
    }

    pub fn desired_size(&self) -> Option<usize> {
        if self.closed {
            None
        } else {
            Some(usize::MAX.saturating_sub(self.chunks.len()))
        }
    }

    pub fn chunks(&self) -> &[Buffer] {
        &self.chunks
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReadableByteStreamController {
    inner: ReadableStreamDefaultController,
    byob_request: Option<ReadableStreamBYOBRequest>,
}

impl ReadableByteStreamController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue(&mut self, chunk: Buffer) -> NodeResult<()> {
        self.inner.enqueue(chunk)
    }

    pub fn close(&mut self) {
        self.inner.close();
    }

    pub fn error(&mut self, reason: impl Into<String>) {
        self.inner.error(reason);
    }

    pub fn desired_size(&self) -> Option<usize> {
        self.inner.desired_size()
    }

    pub fn byob_request(&self) -> Option<&ReadableStreamBYOBRequest> {
        self.byob_request.as_ref()
    }

    pub fn set_byob_request(&mut self, request: ReadableStreamBYOBRequest) {
        self.byob_request = Some(request);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadableStreamBYOBRequest {
    view: Option<Buffer>,
    bytes_written: usize,
}

impl ReadableStreamBYOBRequest {
    pub fn new(view: Buffer) -> Self {
        Self {
            view: Some(view),
            bytes_written: 0,
        }
    }

    pub fn view(&self) -> Option<&Buffer> {
        self.view.as_ref()
    }

    pub fn respond(&mut self, bytes_written: usize) {
        self.bytes_written = bytes_written;
    }

    pub fn respond_with_new_view(&mut self, view: Buffer) {
        self.bytes_written = view.len();
        self.view = Some(view);
    }

    pub fn bytes_written(&self) -> usize {
        self.bytes_written
    }
}

pub struct ReadableStreamBYOBReader<'a> {
    stream: &'a mut ReadableStream,
    released: bool,
}

impl ReadableStreamBYOBReader<'_> {
    pub fn read(
        &mut self,
        view: Buffer,
        options: ReadableStreamBYOBReaderReadOptions,
    ) -> ReadableStreamReadResult {
        if self.released {
            return ReadableStreamReadResult {
                done: true,
                value: None,
            };
        }
        let mut buffer = self
            .stream
            .chunks
            .get(self.stream.index)
            .cloned()
            .unwrap_or(view);
        if let Some(min) = options.min {
            buffer = Buffer::from_bytes(buffer.as_bytes()[..buffer.len().min(min)].to_vec());
        }
        self.stream.index = self.stream.index.saturating_add(1);
        ReadableStreamReadResult {
            done: false,
            value: Some(buffer),
        }
    }

    pub fn release_lock(&mut self) {
        if !self.released {
            self.released = true;
            self.stream.locked = false;
        }
    }
}

impl Drop for ReadableStreamBYOBReader<'_> {
    fn drop(&mut self) {
        self.release_lock();
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

    pub fn read_result(&mut self) -> ReadableStreamReadResult {
        match self.read() {
            Some(value) => ReadableStreamReadResult {
                done: false,
                value: Some(value),
            },
            None => ReadableStreamReadResult {
                done: true,
                value: None,
            },
        }
    }

    pub fn closed(&self) -> bool {
        self.released || self.stream.canceled || self.stream.index >= self.stream.chunks.len()
    }

    pub fn cancel(&mut self) {
        self.stream.cancel();
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

    pub fn ready(&self) -> bool {
        !self.released && !self.stream.aborted
    }

    pub fn closed(&self) -> bool {
        self.released || self.stream.closed
    }

    pub fn desired_size(&self) -> Option<usize> {
        if self.stream.closed || self.stream.aborted {
            None
        } else {
            Some(usize::MAX.saturating_sub(self.stream.chunks.len()))
        }
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WritableStreamDefaultController {
    signal_aborted: bool,
    errored: Option<String>,
}

impl WritableStreamDefaultController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn signal_aborted(&self) -> bool {
        self.signal_aborted
    }

    pub fn abort_signal(&mut self) {
        self.signal_aborted = true;
    }

    pub fn error(&mut self, error: impl Into<String>) {
        self.errored = Some(error.into());
    }

    pub fn errored(&self) -> Option<&str> {
        self.errored.as_deref()
    }
}

impl Drop for WritableStreamDefaultWriter<'_> {
    fn drop(&mut self) {
        self.release_lock();
    }
}

