pub fn exists_sync(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

pub fn access_sync(path: &str) -> NodeResult<()> {
    if exists_sync(path) {
        Ok(())
    } else {
        Err(NodeError::new("ENOENT", "path does not exist"))
    }
}

pub fn read_file_sync(path: &str, encoding: Option<&str>) -> NodeResult<FsReadResult> {
    let bytes = fs::read(path).map_err(map_io_error)?;
    if let Some(encoding) = encoding {
        Ok(FsReadResult::String(crate::buffer::decode_bytes(
            &bytes,
            Some(encoding),
        )?))
    } else {
        Ok(FsReadResult::Buffer(Buffer::from_bytes(bytes)))
    }
}

pub fn read_file_sync_string(path: &str, encoding: &str) -> NodeResult<String> {
    match read_file_sync(path, Some(encoding))? {
        FsReadResult::String(value) => Ok(value),
        FsReadResult::Buffer(_) => Err(NodeError::new(
            "ERR_INVALID_RETURN_VALUE",
            "readFileSync string overload returned a buffer",
        )),
    }
}

pub fn read_file_sync_buffer(path: &str) -> NodeResult<Buffer> {
    match read_file_sync(path, None)? {
        FsReadResult::Buffer(value) => Ok(value),
        FsReadResult::String(_) => Err(NodeError::new(
            "ERR_INVALID_RETURN_VALUE",
            "readFileSync buffer overload returned a string",
        )),
    }
}

pub fn read_file_sync_with_options(
    path: &str,
    options: &ObjectEncodingOptions,
) -> NodeResult<FsReadResult> {
    read_file_sync(path, options.encoding.as_deref())
}

pub fn write_file_sync(
    path: &str,
    data: FsWriteData<'_>,
    encoding: Option<&str>,
) -> NodeResult<()> {
    let bytes = match data {
        FsWriteData::String(value) => crate::buffer::encode_string(value, encoding)?,
        FsWriteData::Buffer(value) => value.as_bytes(),
        FsWriteData::Bytes(value) => value.to_vec(),
    };
    fs::write(path, bytes).map_err(map_io_error)
}

pub fn write_file_sync_string(path: &str, value: &str, encoding: &str) -> NodeResult<()> {
    write_file_sync(path, FsWriteData::String(value), Some(encoding))
}

pub fn write_file_sync_buffer(path: &str, value: &Buffer) -> NodeResult<()> {
    write_file_sync(path, FsWriteData::Buffer(value), None)
}

pub fn append_file_sync_string(path: &str, value: &str, encoding: &str) -> NodeResult<()> {
    let bytes = crate::buffer::encode_string(value, Some(encoding))?;
    append_bytes(path, &bytes)
}

pub fn append_file_sync_buffer(path: &str, value: &Buffer) -> NodeResult<()> {
    append_bytes(path, &value.as_bytes())
}

fn append_bytes(path: &str, bytes: &[u8]) -> NodeResult<()> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(map_io_error)
}

pub fn stat_sync(path: &str) -> NodeResult<Stats> {
    let metadata = fs::metadata(path).map_err(map_io_error)?;
    Ok(stats_from_metadata(&metadata))
}

pub fn stat_sync_with_options(path: &str, options: StatOptions) -> NodeResult<Option<Stats>> {
    match stat_sync(path) {
        Ok(stats) => Ok(Some(stats)),
        Err(error) if !options.throw_if_no_entry && error.code == "ENOENT" => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn lstat_sync(path: &str) -> NodeResult<Stats> {
    let metadata = fs::symlink_metadata(path).map_err(map_io_error)?;
    Ok(stats_from_metadata(&metadata))
}

pub fn lstat_sync_with_options(path: &str, options: StatOptions) -> NodeResult<Option<Stats>> {
    match lstat_sync(path) {
        Ok(stats) => Ok(Some(stats)),
        Err(error) if !options.throw_if_no_entry && error.code == "ENOENT" => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn chmod_sync(path: &str, mode: u32) -> NodeResult<()> {
    let mut permissions = fs::metadata(path).map_err(map_io_error)?.permissions();
    set_permissions_mode(&mut permissions, mode);
    fs::set_permissions(path, permissions).map_err(map_io_error)
}

pub fn lchmod_sync(path: &str, mode: u32) -> NodeResult<()> {
    chmod_sync(path, mode)
}

pub fn fchmod_sync(fd: i32, mode: u32) -> NodeResult<()> {
    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    let mut permissions = file.metadata().map_err(map_io_error)?.permissions();
    set_permissions_mode(&mut permissions, mode);
    file.set_permissions(permissions).map_err(map_io_error)
}

pub fn chown_sync(path: &str, uid: u32, gid: u32) -> NodeResult<()> {
    chown_impl(path, uid, gid)
}

pub fn lchown_sync(path: &str, uid: u32, gid: u32) -> NodeResult<()> {
    lchown_impl(path, uid, gid)
}

pub fn fchown_sync(fd: i32, uid: u32, gid: u32) -> NodeResult<()> {
    fchown_impl(fd, uid, gid)
}

pub fn statfs_sync(path: &str) -> NodeResult<StatFs> {
    statfs_impl(path)
}

pub fn statfs_sync_with_options(path: &str, _options: StatFsOptions) -> NodeResult<StatFs> {
    statfs_sync(path)
}

pub fn utimes_sync(path: &str, atime_seconds: f64, mtime_seconds: f64) -> NodeResult<()> {
    let atime = file_time_from_seconds(atime_seconds)?;
    let mtime = file_time_from_seconds(mtime_seconds)?;
    filetime::set_file_times(path, atime, mtime).map_err(map_io_error)
}

pub fn lutimes_sync(path: &str, atime_seconds: f64, mtime_seconds: f64) -> NodeResult<()> {
    let atime = file_time_from_seconds(atime_seconds)?;
    let mtime = file_time_from_seconds(mtime_seconds)?;
    filetime::set_symlink_file_times(path, atime, mtime).map_err(map_io_error)
}

pub fn futimes_sync(fd: i32, atime_seconds: f64, mtime_seconds: f64) -> NodeResult<()> {
    let atime = file_time_from_seconds(atime_seconds)?;
    let mtime = file_time_from_seconds(mtime_seconds)?;
    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    filetime::set_file_handle_times(file, Some(atime), Some(mtime)).map_err(map_io_error)
}

fn set_permissions_mode(permissions: &mut fs::Permissions, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(mode);
    }
    #[cfg(not(unix))]
    {
        permissions.set_readonly(mode & 0o200 == 0);
    }
}

fn file_time_from_seconds(value: f64) -> NodeResult<FileTime> {
    if !value.is_finite() {
        return Err(NodeError::new(
            "ERR_INVALID_ARG_VALUE",
            "file time must be finite",
        ));
    }
    let seconds = value.floor();
    if seconds < i64::MIN as f64 || seconds > i64::MAX as f64 {
        return Err(NodeError::new(
            "ERR_OUT_OF_RANGE",
            "file time is outside supported range",
        ));
    }
    let nanos = ((value - seconds) * 1_000_000_000.0).round();
    let mut seconds = seconds as i64;
    let mut nanos = nanos as u32;
    if nanos >= 1_000_000_000 {
        seconds = seconds
            .checked_add(1)
            .ok_or_else(|| NodeError::new("ERR_OUT_OF_RANGE", "file time overflow"))?;
        nanos -= 1_000_000_000;
    }
    Ok(FileTime::from_unix_time(seconds, nanos))
}

#[cfg(unix)]
fn chown_impl(path: &str, uid: u32, gid: u32) -> NodeResult<()> {
    let path = path_cstring(path)?;
    let result = unsafe { libc::chown(path.as_ptr(), uid, gid) };
    if result == 0 {
        Ok(())
    } else {
        Err(map_io_error(std::io::Error::last_os_error()))
    }
}

#[cfg(not(unix))]
fn chown_impl(_path: &str, _uid: u32, _gid: u32) -> NodeResult<()> {
    Err(NodeError::new(
        "ERR_FEATURE_UNAVAILABLE",
        "chown is currently implemented for Unix targets",
    ))
}

#[cfg(unix)]
fn lchown_impl(path: &str, uid: u32, gid: u32) -> NodeResult<()> {
    let path = path_cstring(path)?;
    let result = unsafe { libc::lchown(path.as_ptr(), uid, gid) };
    if result == 0 {
        Ok(())
    } else {
        Err(map_io_error(std::io::Error::last_os_error()))
    }
}

#[cfg(not(unix))]
fn lchown_impl(_path: &str, _uid: u32, _gid: u32) -> NodeResult<()> {
    Err(NodeError::new(
        "ERR_FEATURE_UNAVAILABLE",
        "lchown is currently implemented for Unix targets",
    ))
}

#[cfg(unix)]
fn fchown_impl(fd: i32, uid: u32, gid: u32) -> NodeResult<()> {
    use std::os::fd::AsRawFd;

    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    let result = unsafe { libc::fchown(file.as_raw_fd(), uid, gid) };
    if result == 0 {
        Ok(())
    } else {
        Err(map_io_error(std::io::Error::last_os_error()))
    }
}

#[cfg(not(unix))]
fn fchown_impl(_fd: i32, _uid: u32, _gid: u32) -> NodeResult<()> {
    Err(NodeError::new(
        "ERR_FEATURE_UNAVAILABLE",
        "fchown is currently implemented for Unix targets",
    ))
}

#[cfg(unix)]
fn path_cstring(path: &str) -> NodeResult<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;

    let path = std::path::Path::new(path);
    std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|_| {
        NodeError::new(
            "ERR_INVALID_ARG_VALUE",
            "path contains an interior NUL byte",
        )
    })
}

#[cfg(target_os = "linux")]
fn statfs_impl(path: &str) -> NodeResult<StatFs> {
    use std::mem::MaybeUninit;

    let path = path_cstring(path)?;
    let mut stats = MaybeUninit::<libc::statfs>::uninit();
    let result = unsafe { libc::statfs(path.as_ptr(), stats.as_mut_ptr()) };
    if result != 0 {
        return Err(map_io_error(std::io::Error::last_os_error()));
    }
    let stats = unsafe { stats.assume_init() };
    Ok(StatFs {
        r#type: stats.f_type,
        bsize: stats.f_bsize as u64,
        blocks: stats.f_blocks,
        bfree: stats.f_bfree,
        bavail: stats.f_bavail,
        files: stats.f_files,
        ffree: stats.f_ffree,
    })
}

#[cfg(not(target_os = "linux"))]
fn statfs_impl(_path: &str) -> NodeResult<StatFs> {
    Err(NodeError::new(
        "ERR_FEATURE_UNAVAILABLE",
        "statfs is currently implemented for Linux targets",
    ))
}

