impl FileHandle {
    pub fn fd(&self) -> i32 {
        self.fd
    }

    pub fn stat(&self) -> NodeResult<Stats> {
        fs::fstat_sync(self.fd)
    }

    pub fn stat_with_options(&self, options: StatOptions) -> NodeResult<Stats> {
        fs::fstat_sync_with_options(self.fd, options)
    }

    pub fn sync(&self) -> NodeResult<()> {
        fs::fsync_sync(self.fd)
    }

    pub fn datasync(&self) -> NodeResult<()> {
        fs::fdatasync_sync(self.fd)
    }

    pub fn truncate(&self, len: u64) -> NodeResult<()> {
        fs::ftruncate_sync(self.fd, len)
    }

    pub fn truncate_default(&self) -> NodeResult<()> {
        self.truncate(0)
    }

    pub fn chmod(&self, mode: u32) -> NodeResult<()> {
        fs::fchmod_sync(self.fd, mode)
    }

    pub fn chown(&self, uid: u32, gid: u32) -> NodeResult<()> {
        fs::fchown_sync(self.fd, uid, gid)
    }

    pub fn utimes(&self, atime_seconds: f64, mtime_seconds: f64) -> NodeResult<()> {
        fs::futimes_sync(self.fd, atime_seconds, mtime_seconds)
    }

    pub fn read(
        &self,
        buffer: &mut Buffer,
        offset: usize,
        length: usize,
        position: Option<u64>,
    ) -> NodeResult<usize> {
        fs::read_sync(self.fd, buffer, offset, length, position)
    }

    pub fn read_with_options(
        &self,
        buffer: Buffer,
        options: ReadOptions,
    ) -> NodeResult<ReadResult> {
        fs::read_sync_with_options(self.fd, buffer, options)
    }

    pub fn write_buffer(
        &self,
        buffer: &Buffer,
        offset: usize,
        length: usize,
        position: Option<u64>,
    ) -> NodeResult<usize> {
        fs::write_sync_buffer(self.fd, buffer, offset, length, position)
    }

    pub fn write_buffer_with_options(
        &self,
        buffer: &Buffer,
        options: WriteOptions,
    ) -> NodeResult<WriteResult> {
        fs::write_sync_buffer_with_options(self.fd, buffer, options)
    }

    pub fn readv(&self, buffers: &mut [Buffer], position: Option<u64>) -> NodeResult<usize> {
        fs::readv_sync(self.fd, buffers, position)
    }

    pub fn readv_result(
        &self,
        buffers: &mut [Buffer],
        position: Option<u64>,
    ) -> NodeResult<ReadVResult> {
        fs::readv_sync_result(self.fd, buffers, position)
    }

    pub fn writev(&self, buffers: &[Buffer], position: Option<u64>) -> NodeResult<usize> {
        fs::writev_sync(self.fd, buffers, position)
    }

    pub fn writev_result(
        &self,
        buffers: &[Buffer],
        position: Option<u64>,
    ) -> NodeResult<WriteVResult> {
        fs::writev_sync_result(self.fd, buffers, position)
    }

    pub fn write_string(
        &self,
        value: &str,
        position: Option<u64>,
        encoding: &str,
    ) -> NodeResult<usize> {
        fs::write_sync_string(self.fd, value, position, encoding)
    }

    pub fn write_string_with_options(
        &self,
        value: &str,
        options: WriteOptions,
    ) -> NodeResult<WriteResult> {
        fs::write_sync_string_with_options(self.fd, value, options)
    }

    pub fn append_file_string(&self, value: &str, encoding: &str) -> NodeResult<usize> {
        let position = Some(self.stat()?.size);
        self.write_string(value, position, encoding)
    }

    pub fn append_file_buffer(&self, value: &Buffer) -> NodeResult<usize> {
        let position = Some(self.stat()?.size);
        self.write_buffer(value, 0, value.len(), position)
    }

    pub fn read_file_buffer(&self) -> NodeResult<Buffer> {
        let size = self.stat()?.size as usize;
        let mut buffer = Buffer::alloc(size);
        let read = self.read(&mut buffer, 0, size, Some(0))?;
        Ok(Buffer::from_bytes(buffer.as_bytes()[..read].to_vec()))
    }

    pub fn read_file_string(&self, encoding: &str) -> NodeResult<String> {
        self.read_file_buffer()?.to_string(Some(encoding))
    }

    pub fn readable_web_stream(&self) -> NodeResult<crate::stream::web::ReadableStream> {
        Ok(crate::stream::web::ReadableStream::from_chunks(vec![
            self.read_file_buffer()?
        ]))
    }

    pub fn readable_web_stream_with_options(
        &self,
        _options: ReadableWebStreamOptions,
    ) -> NodeResult<crate::stream::web::ReadableStream> {
        self.readable_web_stream()
    }

    pub fn writable_web_stream(&self) -> crate::stream::web::WritableStream {
        crate::stream::web::WritableStream::new()
    }

    pub fn create_read_stream(&self) -> NodeResult<fs::ReadStream> {
        Ok(fs::ReadStream::new(
            format!("fd:{}", self.fd),
            crate::stream::Readable::from_chunks(vec![self.read_file_buffer()?]),
        ))
    }

    pub fn create_read_stream_with_options(
        &self,
        options: ReadStreamOptions,
    ) -> NodeResult<fs::ReadStream> {
        if options.stream.signal_aborted {
            return Err(crate::error::NodeError::new(
                "ABORT_ERR",
                "read stream creation was aborted",
            ));
        }
        let mut buffer = self.read_file_buffer()?;
        if let Some(start) = options.stream.start {
            let start = start as usize;
            let end = options
                .stream
                .end
                .map(|end| end as usize + 1)
                .unwrap_or_else(|| buffer.len())
                .min(buffer.len());
            buffer = if start >= buffer.len() || start >= end {
                Buffer::from_bytes(Vec::new())
            } else {
                Buffer::from_bytes(buffer.as_bytes()[start..end].to_vec())
            };
        }
        Ok(fs::ReadStream::new(
            format!("fd:{}", self.fd),
            crate::stream::Readable::from_chunks(vec![buffer]),
        ))
    }

    pub fn create_write_stream(&self) -> fs::WriteStream {
        fs::create_write_stream(&format!("fd:{}", self.fd))
    }

    pub fn create_write_stream_with_options(
        &self,
        options: WriteStreamOptions,
    ) -> NodeResult<fs::WriteStream> {
        fs::create_write_stream_with_options(&format!("fd:{}", self.fd), options)
    }

    pub fn read_lines(&self, encoding: &str) -> NodeResult<Vec<String>> {
        Ok(self
            .read_file_string(encoding)?
            .lines()
            .map(str::to_string)
            .collect())
    }

    pub fn read_lines_with_options(&self, options: ReadStreamOptions) -> NodeResult<Vec<String>> {
        let encoding = options.stream.encoding.as_deref().unwrap_or("utf8");
        self.read_lines(encoding)
    }

    pub fn pull(&self, chunk_size: usize) -> NodeResult<crate::stream::Readable> {
        let buffer = self.read_file_buffer()?;
        if chunk_size == 0 || buffer.len() <= chunk_size {
            return Ok(crate::stream::Readable::from_chunks(vec![buffer]));
        }
        let chunks = buffer
            .as_bytes()
            .chunks(chunk_size)
            .map(|chunk| Buffer::from_bytes(chunk.to_vec()))
            .collect();
        Ok(crate::stream::Readable::from_chunks(chunks))
    }

    pub fn pull_with_options(&self, options: PullOptions) -> NodeResult<crate::stream::Readable> {
        let mut buffer = self.read_file_buffer()?;
        if let Some(start) = options.start {
            let start = start as usize;
            buffer = if start >= buffer.len() {
                Buffer::from_bytes(Vec::new())
            } else {
                Buffer::from_bytes(buffer.as_bytes()[start..].to_vec())
            };
        }
        if let Some(limit) = options.limit {
            buffer = Buffer::from_bytes(buffer.as_bytes()[..buffer.len().min(limit)].to_vec());
        }
        if options.chunk_size == 0 || buffer.len() <= options.chunk_size {
            return Ok(crate::stream::Readable::from_chunks(vec![buffer]));
        }
        let chunks = buffer
            .as_bytes()
            .chunks(options.chunk_size)
            .map(|chunk| Buffer::from_bytes(chunk.to_vec()))
            .collect();
        Ok(crate::stream::Readable::from_chunks(chunks))
    }

    pub fn writer(&self) -> FileHandleWriter {
        FileHandleWriter {
            fd: self.fd,
            position: None,
        }
    }

    pub fn writer_with_options(&self, options: WriterOptions) -> FileHandleWriter {
        FileHandleWriter {
            fd: self.fd,
            position: options.start,
        }
    }

    pub fn close(self) -> NodeResult<()> {
        fs::close_sync(self.fd)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileHandleWriter {
    fd: i32,
    position: Option<u64>,
}

impl FileHandleWriter {
    pub fn fd(&self) -> i32 {
        self.fd
    }

    pub fn position(&self) -> Option<u64> {
        self.position
    }

    pub fn seek(&mut self, position: u64) {
        self.position = Some(position);
    }

    pub fn write_buffer(&mut self, buffer: &Buffer) -> NodeResult<usize> {
        let written = fs::write_sync_buffer(self.fd, buffer, 0, buffer.len(), self.position)?;
        if let Some(position) = self.position {
            self.position = Some(position + written as u64);
        }
        Ok(written)
    }

    pub fn write_string(&mut self, value: &str, encoding: &str) -> NodeResult<usize> {
        let written = fs::write_sync_string(self.fd, value, self.position, encoding)?;
        if let Some(position) = self.position {
            self.position = Some(position + written as u64);
        }
        Ok(written)
    }
}

