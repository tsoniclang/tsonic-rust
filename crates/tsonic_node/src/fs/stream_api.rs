pub fn create_read_stream(path: &str) -> NodeResult<ReadStream> {
    Ok(ReadStream::new(
        path,
        Readable::from_chunks(vec![read_file_sync_buffer(path)?]),
    ))
}

pub fn create_read_stream_with_options(
    path: &str,
    options: ReadStreamOptions,
) -> NodeResult<ReadStream> {
    if options.stream.signal_aborted {
        return Err(NodeError::new(
            "ABORT_ERR",
            "read stream creation was aborted",
        ));
    }
    let mut buffer = read_file_sync_buffer(path)?;
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
    Ok(ReadStream::new(path, Readable::from_chunks(vec![buffer])))
}

pub fn create_write_stream(path: &str) -> WriteStream {
    WriteStream::new(path, Writable::new())
}

pub fn create_write_stream_with_options(
    path: &str,
    options: WriteStreamOptions,
) -> NodeResult<WriteStream> {
    if options.stream.signal_aborted {
        return Err(NodeError::new(
            "ABORT_ERR",
            "write stream creation was aborted",
        ));
    }
    Ok(WriteStream::new(path, Writable::new()))
}

