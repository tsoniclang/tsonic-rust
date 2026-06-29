pub fn read_sync(
    fd: i32,
    buffer: &mut Buffer,
    offset: usize,
    length: usize,
    position: Option<u64>,
) -> NodeResult<usize> {
    if offset > buffer.len() || offset.saturating_add(length) > buffer.len() {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "buffer offset out of range",
        ));
    }
    let mut table = file_table().lock().unwrap();
    let file = table
        .get_mut(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    if let Some(position) = position {
        file.seek(SeekFrom::Start(position)).map_err(map_io_error)?;
    }
    let mut bytes = vec![0_u8; length];
    let read = file.read(&mut bytes).map_err(map_io_error)?;
    for (index, byte) in bytes.into_iter().take(read).enumerate() {
        buffer.set(offset + index, byte)?;
    }
    Ok(read)
}

pub fn read_sync_with_options(
    fd: i32,
    mut buffer: Buffer,
    options: ReadOptions,
) -> NodeResult<ReadResult> {
    let bytes_read = read_sync(
        fd,
        &mut buffer,
        options.offset,
        options.length,
        options.position,
    )?;
    Ok(ReadResult { bytes_read, buffer })
}

pub fn readv_sync(fd: i32, buffers: &mut [Buffer], position: Option<u64>) -> NodeResult<usize> {
    let mut total = 0;
    let mut next_position = position;
    for buffer in buffers {
        let read = read_sync(fd, buffer, 0, buffer.len(), next_position)?;
        total += read;
        if let Some(position) = next_position {
            next_position = Some(position + read as u64);
        }
        if read < buffer.len() {
            break;
        }
    }
    Ok(total)
}

pub fn readv_sync_result(
    fd: i32,
    buffers: &mut [Buffer],
    position: Option<u64>,
) -> NodeResult<ReadVResult> {
    let bytes_read = readv_sync(fd, buffers, position)?;
    Ok(ReadVResult {
        bytes_read,
        buffers: buffers.to_vec(),
    })
}

pub fn write_sync_buffer(
    fd: i32,
    buffer: &Buffer,
    offset: usize,
    length: usize,
    position: Option<u64>,
) -> NodeResult<usize> {
    if offset > buffer.len() {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "buffer offset out of range",
        ));
    }
    let mut table = file_table().lock().unwrap();
    let file = table
        .get_mut(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    if let Some(position) = position {
        file.seek(SeekFrom::Start(position)).map_err(map_io_error)?;
    }
    let bytes = buffer.as_bytes();
    let end = offset.saturating_add(length).min(bytes.len());
    file.write(&bytes[offset..end]).map_err(map_io_error)
}

pub fn write_sync_buffer_with_options(
    fd: i32,
    buffer: &Buffer,
    options: WriteOptions,
) -> NodeResult<WriteResult> {
    let bytes_written =
        write_sync_buffer(fd, buffer, options.offset, options.length, options.position)?;
    Ok(WriteResult {
        bytes_written,
        buffer: Some(Buffer::from_bytes(
            buffer.as_bytes()[options.offset..options.offset.saturating_add(bytes_written)]
                .to_vec(),
        )),
    })
}

pub fn write_sync_string(
    fd: i32,
    value: &str,
    position: Option<u64>,
    encoding: &str,
) -> NodeResult<usize> {
    let bytes = crate::buffer::encode_string(value, Some(encoding))?;
    let buffer = Buffer::from_bytes(bytes);
    write_sync_buffer(fd, &buffer, 0, buffer.len(), position)
}

pub fn write_sync_string_with_options(
    fd: i32,
    value: &str,
    options: WriteOptions,
) -> NodeResult<WriteResult> {
    let bytes_written = write_sync_string(fd, value, options.position, &options.encoding)?;
    Ok(WriteResult {
        bytes_written,
        buffer: None,
    })
}

pub fn writev_sync(fd: i32, buffers: &[Buffer], position: Option<u64>) -> NodeResult<usize> {
    let mut total = 0;
    let mut next_position = position;
    for buffer in buffers {
        let written = write_sync_buffer(fd, buffer, 0, buffer.len(), next_position)?;
        total += written;
        if let Some(position) = next_position {
            next_position = Some(position + written as u64);
        }
        if written < buffer.len() {
            break;
        }
    }
    Ok(total)
}

pub fn writev_sync_result(
    fd: i32,
    buffers: &[Buffer],
    position: Option<u64>,
) -> NodeResult<WriteVResult> {
    let bytes_written = writev_sync(fd, buffers, position)?;
    Ok(WriteVResult {
        bytes_written,
        buffers: buffers.to_vec(),
    })
}

pub fn fstat_sync(fd: i32) -> NodeResult<Stats> {
    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    let metadata = file.metadata().map_err(map_io_error)?;
    Ok(stats_from_metadata(&metadata))
}

pub fn fstat_sync_with_options(fd: i32, _options: StatOptions) -> NodeResult<Stats> {
    fstat_sync(fd)
}

pub fn fsync_sync(fd: i32) -> NodeResult<()> {
    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    file.sync_all().map_err(map_io_error)
}

pub fn fdatasync_sync(fd: i32) -> NodeResult<()> {
    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    file.sync_data().map_err(map_io_error)
}

pub fn ftruncate_sync(fd: i32, len: u64) -> NodeResult<()> {
    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    file.set_len(len).map_err(map_io_error)
}

