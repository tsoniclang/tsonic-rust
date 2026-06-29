#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Utf8Stream {
    pub file: String,
    pub fd: i32,
    pub min_length: usize,
    pub max_length: usize,
    pub content_mode: String,
    pub writing: bool,
    pub append: bool,
    pub sync: bool,
    pub periodic_flush: Option<u64>,
    pub fsync: bool,
    pub mkdir: bool,
    pub mode: u32,
    buffer: Vec<u8>,
    destroyed: bool,
}

impl Utf8Stream {
    pub fn new(options: Utf8StreamOptions) -> NodeResult<Self> {
        if let Some(dest) = &options.dest {
            if options.mkdir {
                if let Some(parent) = std::path::Path::new(dest).parent() {
                    if !parent.as_os_str().is_empty() {
                        fs::create_dir_all(parent).map_err(map_io_error)?;
                    }
                }
            }
        }

        Ok(Self {
            file: options.dest.unwrap_or_default(),
            fd: options.fd.unwrap_or(-1),
            min_length: options.min_length,
            max_length: options.max_length,
            content_mode: options.content_mode,
            writing: false,
            append: options.append,
            sync: options.sync,
            periodic_flush: options.periodic_flush_ms,
            fsync: options.fsync,
            mkdir: options.mkdir,
            mode: options.mode,
            buffer: Vec::new(),
            destroyed: false,
        })
    }

    pub fn reopen(&mut self, file: &str) -> NodeResult<()> {
        self.flush_sync()?;
        self.file = file.to_string();
        Ok(())
    }

    pub fn write(&mut self, data: FsWriteData<'_>) -> bool {
        if self.destroyed {
            return false;
        }
        let bytes = match data {
            FsWriteData::String(value) => value.as_bytes().to_vec(),
            FsWriteData::Buffer(value) => value.as_bytes().to_vec(),
            FsWriteData::Bytes(value) => value.to_vec(),
        };
        if self.buffer.len().saturating_add(bytes.len()) > self.max_length {
            return false;
        }
        self.writing = true;
        self.buffer.extend_from_slice(&bytes);
        if self.sync || self.buffer.len() >= self.min_length {
            self.flush_sync().is_ok()
        } else {
            true
        }
    }

    pub fn flush(&mut self, callback: impl FnOnce(NodeResult<()>)) {
        callback(self.flush_sync());
    }

    pub fn flush_sync(&mut self) -> NodeResult<()> {
        if self.buffer.is_empty() {
            self.writing = false;
            return Ok(());
        }
        if self.file.is_empty() {
            self.buffer.clear();
            self.writing = false;
            return Ok(());
        }
        let mut options = OpenOptions::new();
        options.create(true).write(true);
        if self.append {
            options.append(true);
        } else {
            options.truncate(true);
        }
        let mut file = options.open(&self.file).map_err(map_io_error)?;
        file.write_all(&self.buffer).map_err(map_io_error)?;
        if self.fsync {
            file.sync_all().map_err(map_io_error)?;
        }
        self.buffer.clear();
        self.writing = false;
        Ok(())
    }

    pub fn end(&mut self) -> NodeResult<()> {
        self.flush_sync()?;
        self.destroyed = true;
        Ok(())
    }

    pub fn destroy(&mut self) {
        self.buffer.clear();
        self.writing = false;
        self.destroyed = true;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadStream {
    pub path: String,
    pub pending: bool,
    pub bytes_read: usize,
    inner: Readable,
}

impl ReadStream {
    pub fn new(path: impl Into<String>, inner: Readable) -> Self {
        Self {
            path: path.into(),
            pending: false,
            bytes_read: 0,
            inner,
        }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        let chunk = self.inner.read();
        if let Some(buffer) = &chunk {
            self.bytes_read += buffer.len();
        }
        chunk
    }

    pub fn to_vec(self) -> Vec<Buffer> {
        self.inner.to_vec()
    }

    pub fn close(&mut self) {
        self.inner.destroy();
        self.pending = false;
    }

    pub fn closed(&self) -> bool {
        self.inner.closed()
    }

    pub fn text(&mut self, encoding: Option<&str>) -> NodeResult<String> {
        let chunks = self.inner.to_array();
        let mut bytes = Vec::new();
        for chunk in chunks {
            bytes.extend_from_slice(&chunk.as_bytes());
        }
        crate::buffer::decode_bytes(&bytes, encoding)
    }

    pub fn add_listener(&mut self, event: &str) -> &mut Self {
        self.inner.add_listener(event);
        self
    }

    pub fn on(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn once(&mut self, event: &str) -> &mut Self {
        self.inner.once(event);
        self
    }

    pub fn prepend_listener(&mut self, event: &str) -> &mut Self {
        self.inner.prepend_listener(event);
        self
    }

    pub fn prepend_once_listener(&mut self, event: &str) -> &mut Self {
        self.inner.prepend_once_listener(event);
        self
    }

    pub fn remove_listener(&mut self, event: &str) -> &mut Self {
        self.inner.remove_listener(event);
        self
    }

    pub fn off(&mut self, event: &str) -> &mut Self {
        self.inner.off(event);
        self
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.inner.remove_all_listeners(event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        self.inner.listeners(event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<String> {
        self.inner.raw_listeners(event)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.inner.listener_count(event)
    }

    pub fn emit(&self, event: &str) -> bool {
        self.inner.emit(event)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteStream {
    pub path: String,
    pub pending: bool,
    pub bytes_written: usize,
    inner: Writable,
}

impl WriteStream {
    pub fn new(path: impl Into<String>, inner: Writable) -> Self {
        Self {
            path: path.into(),
            pending: false,
            bytes_written: 0,
            inner,
        }
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        let len = chunk.len();
        let before = self.inner.chunks().len();
        let ok = self.inner.write(chunk);
        if self.inner.chunks().len() > before {
            self.bytes_written += len;
        }
        ok
    }

    pub fn chunks(&self) -> &[Buffer] {
        self.inner.chunks()
    }

    pub fn close(&mut self) {
        self.inner.end();
        self.pending = false;
    }

    pub fn closed(&self) -> bool {
        self.inner.closed()
    }

    pub fn add_listener(&mut self, event: &str) -> &mut Self {
        self.inner.add_listener(event);
        self
    }

    pub fn on(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn once(&mut self, event: &str) -> &mut Self {
        self.inner.once(event);
        self
    }

    pub fn prepend_listener(&mut self, event: &str) -> &mut Self {
        self.inner.prepend_listener(event);
        self
    }

    pub fn prepend_once_listener(&mut self, event: &str) -> &mut Self {
        self.inner.prepend_once_listener(event);
        self
    }

    pub fn remove_listener(&mut self, event: &str) -> &mut Self {
        self.inner.remove_listener(event);
        self
    }

    pub fn off(&mut self, event: &str) -> &mut Self {
        self.inner.off(event);
        self
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.inner.remove_all_listeners(event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        self.inner.listeners(event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<String> {
        self.inner.raw_listeners(event)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.inner.listener_count(event)
    }

    pub fn emit(&self, event: &str) -> bool {
        self.inner.emit(event)
    }
}

pub type StatsBase = Stats;
pub type BigIntStats = Stats;
pub type BigIntStatsFs = StatFs;
pub type StatsFsBase = StatFs;
pub type StreamOptions = FsStreamOptions;
pub type CreateReadStreamOptions = ReadStreamOptions;
pub type CreateWriteStreamOptions = WriteStreamOptions;
pub type WatchOptionsWithBufferEncoding = WatchOptions;
pub type WatchOptionsWithStringEncoding = WatchOptions;
