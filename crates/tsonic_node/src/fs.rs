use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};
use crate::stream::{Readable, Writable};
use filetime::FileTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatFs {
    pub r#type: i64,
    pub bsize: u64,
    pub blocks: u64,
    pub bfree: u64,
    pub bavail: u64,
    pub files: u64,
    pub ffree: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stats {
    pub size: u64,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symbolic_link: bool,
}

impl Stats {
    pub fn is_file(&self) -> bool {
        self.is_file
    }

    pub fn is_directory(&self) -> bool {
        self.is_directory
    }

    pub fn is_symbolic_link(&self) -> bool {
        self.is_symbolic_link
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dirent {
    pub name: String,
    pub parent_path: String,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symbolic_link: bool,
}

impl Dirent {
    pub fn is_file(&self) -> bool {
        self.is_file
    }

    pub fn is_directory(&self) -> bool {
        self.is_directory
    }

    pub fn is_symbolic_link(&self) -> bool {
        self.is_symbolic_link
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsReadResult {
    String(String),
    Buffer(Buffer),
}

pub enum FsWriteData<'a> {
    String(&'a str),
    Buffer(&'a Buffer),
    Bytes(&'a [u8]),
}

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
    Ok(Stats {
        size: metadata.len(),
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_symbolic_link: metadata.file_type().is_symlink(),
    })
}

pub fn lstat_sync(path: &str) -> NodeResult<Stats> {
    let metadata = fs::symlink_metadata(path).map_err(map_io_error)?;
    Ok(Stats {
        size: metadata.len(),
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_symbolic_link: metadata.file_type().is_symlink(),
    })
}

pub fn chmod_sync(path: &str, mode: u32) -> NodeResult<()> {
    let mut permissions = fs::metadata(path).map_err(map_io_error)?.permissions();
    set_permissions_mode(&mut permissions, mode);
    fs::set_permissions(path, permissions).map_err(map_io_error)
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

pub fn mkdir_sync(path: &str, recursive: bool) -> NodeResult<()> {
    if recursive {
        fs::create_dir_all(path).map_err(map_io_error)
    } else {
        fs::create_dir(path).map_err(map_io_error)
    }
}

pub fn rm_sync(path: &str, recursive: bool, force: bool) -> NodeResult<()> {
    let path_ref = std::path::Path::new(path);
    if !path_ref.exists() {
        return if force {
            Ok(())
        } else {
            Err(NodeError::new("ENOENT", "path does not exist"))
        };
    }
    if path_ref.is_dir() {
        if recursive {
            fs::remove_dir_all(path_ref).map_err(map_io_error)
        } else {
            fs::remove_dir(path_ref).map_err(map_io_error)
        }
    } else {
        fs::remove_file(path_ref).map_err(map_io_error)
    }
}

pub fn readdir_sync(path: &str) -> NodeResult<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(path).map_err(map_io_error)? {
        let entry = entry.map_err(map_io_error)?;
        names.push(entry.file_name().to_string_lossy().to_string());
    }
    names.sort();
    Ok(names)
}

pub fn unlink_sync(path: &str) -> NodeResult<()> {
    fs::remove_file(path).map_err(map_io_error)
}

pub fn rename_sync(from: &str, to: &str) -> NodeResult<()> {
    fs::rename(from, to).map_err(map_io_error)
}

pub fn copy_file_sync(from: &str, to: &str) -> NodeResult<()> {
    fs::copy(from, to).map(|_| ()).map_err(map_io_error)
}

pub fn cp_sync(from: &str, to: &str, recursive: bool) -> NodeResult<()> {
    let metadata = fs::metadata(from).map_err(map_io_error)?;
    if metadata.is_dir() {
        if !recursive {
            return Err(NodeError::new("EISDIR", "source is a directory"));
        }
        fs::create_dir_all(to).map_err(map_io_error)?;
        for entry in fs::read_dir(from).map_err(map_io_error)? {
            let entry = entry.map_err(map_io_error)?;
            let child_from = entry.path();
            let child_to = std::path::Path::new(to).join(entry.file_name());
            cp_sync(
                &child_from.to_string_lossy(),
                &child_to.to_string_lossy(),
                true,
            )?;
        }
        Ok(())
    } else {
        copy_file_sync(from, to)
    }
}

pub fn link_sync(existing_path: &str, new_path: &str) -> NodeResult<()> {
    fs::hard_link(existing_path, new_path).map_err(map_io_error)
}

pub fn symlink_sync(target: &str, path: &str) -> NodeResult<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, path).map_err(map_io_error)
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, path).map_err(map_io_error)
    }
}

pub fn readlink_sync(path: &str) -> NodeResult<String> {
    fs::read_link(path)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(map_io_error)
}

pub fn realpath_sync(path: &str) -> NodeResult<String> {
    fs::canonicalize(path)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(map_io_error)
}

pub fn rmdir_sync(path: &str) -> NodeResult<()> {
    fs::remove_dir(path).map_err(map_io_error)
}

pub fn truncate_sync(path: &str, len: u64) -> NodeResult<()> {
    OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|file| file.set_len(len))
        .map_err(map_io_error)
}

pub fn mkdtemp_sync(prefix: &str) -> NodeResult<String> {
    for index in 0..10_000 {
        let candidate = format!("{prefix}{index:06}");
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(map_io_error(error)),
        }
    }
    Err(NodeError::new(
        "EEXIST",
        "unable to create temporary directory",
    ))
}

pub fn opendir_sync(path: &str) -> NodeResult<Vec<Dirent>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(map_io_error)? {
        let entry = entry.map_err(map_io_error)?;
        let metadata = entry.file_type().map_err(map_io_error)?;
        entries.push(Dirent {
            name: entry.file_name().to_string_lossy().to_string(),
            parent_path: path.to_string(),
            is_file: metadata.is_file(),
            is_directory: metadata.is_dir(),
            is_symbolic_link: metadata.is_symlink(),
        });
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(entries)
}

pub fn open_sync(path: &str, flags: &str) -> NodeResult<i32> {
    let mut options = OpenOptions::new();
    match flags {
        "r" => {
            options.read(true);
        }
        "r+" => {
            options.read(true).write(true);
        }
        "w" => {
            options.write(true).create(true).truncate(true);
        }
        "w+" => {
            options.read(true).write(true).create(true).truncate(true);
        }
        "a" => {
            options.write(true).create(true).append(true);
        }
        "a+" => {
            options.read(true).write(true).create(true).append(true);
        }
        _ => {
            return Err(NodeError::new(
                "ERR_INVALID_ARG_VALUE",
                "unsupported open flag",
            ))
        }
    }
    let file = options.open(path).map_err(map_io_error)?;
    let fd = NEXT_FD.fetch_add(1, Ordering::SeqCst);
    file_table().lock().unwrap().insert(fd, file);
    Ok(fd)
}

pub fn close_sync(fd: i32) -> NodeResult<()> {
    file_table()
        .lock()
        .unwrap()
        .remove(&fd)
        .map(|_| ())
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))
}

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

pub fn fstat_sync(fd: i32) -> NodeResult<Stats> {
    let table = file_table().lock().unwrap();
    let file = table
        .get(&fd)
        .ok_or_else(|| NodeError::new("EBADF", "bad file descriptor"))?;
    let metadata = file.metadata().map_err(map_io_error)?;
    Ok(Stats {
        size: metadata.len(),
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_symbolic_link: metadata.file_type().is_symlink(),
    })
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

pub fn create_read_stream(path: &str) -> NodeResult<Readable> {
    Ok(Readable::from_chunks(vec![read_file_sync_buffer(path)?]))
}

pub fn create_write_stream() -> Writable {
    Writable::new()
}

pub fn read_file_callback_string(
    path: &str,
    encoding: &str,
    callback: impl FnOnce(NodeResult<String>),
) {
    callback(read_file_sync_string(path, encoding));
}

pub fn read_file_callback_buffer(path: &str, callback: impl FnOnce(NodeResult<Buffer>)) {
    callback(read_file_sync_buffer(path));
}

pub fn write_file_callback_string(
    path: &str,
    value: &str,
    encoding: &str,
    callback: impl FnOnce(NodeResult<()>),
) {
    callback(write_file_sync_string(path, value, encoding));
}

pub fn write_file_callback_buffer(
    path: &str,
    value: &Buffer,
    callback: impl FnOnce(NodeResult<()>),
) {
    callback(write_file_sync_buffer(path, value));
}

pub fn exists_callback(path: &str, callback: impl FnOnce(bool)) {
    callback(exists_sync(path));
}

pub fn access_callback(path: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(access_sync(path));
}

pub fn append_file_callback_string(
    path: &str,
    value: &str,
    encoding: &str,
    callback: impl FnOnce(NodeResult<()>),
) {
    callback(append_file_sync_string(path, value, encoding));
}

pub fn stat_callback(path: &str, callback: impl FnOnce(NodeResult<Stats>)) {
    callback(stat_sync(path));
}

pub fn lstat_callback(path: &str, callback: impl FnOnce(NodeResult<Stats>)) {
    callback(lstat_sync(path));
}

pub fn readdir_callback(path: &str, callback: impl FnOnce(NodeResult<Vec<String>>)) {
    callback(readdir_sync(path));
}

pub fn mkdir_callback(path: &str, recursive: bool, callback: impl FnOnce(NodeResult<()>)) {
    callback(mkdir_sync(path, recursive));
}

pub fn copy_file_callback(from: &str, to: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(copy_file_sync(from, to));
}

pub fn rename_callback(from: &str, to: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(rename_sync(from, to));
}

pub fn unlink_callback(path: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(unlink_sync(path));
}

pub fn rm_callback(
    path: &str,
    recursive: bool,
    force: bool,
    callback: impl FnOnce(NodeResult<()>),
) {
    callback(rm_sync(path, recursive, force));
}

pub fn glob_sync(pattern: &str) -> NodeResult<Vec<String>> {
    let mut matches = glob::glob(pattern)
        .map_err(|error| NodeError::new("ERR_INVALID_ARG_VALUE", error.to_string()))?
        .map(|entry| {
            entry
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|error| NodeError::new("EIO", error.to_string()))
        })
        .collect::<NodeResult<Vec<_>>>()?;
    matches.sort();
    Ok(matches)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsWatchEvent {
    pub event_type: String,
    pub filename: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsWatcher {
    path: String,
    previous: Option<WatchSnapshot>,
}

impl FsWatcher {
    pub fn poll(&mut self) -> NodeResult<Option<FsWatchEvent>> {
        let next = WatchSnapshot::read(&self.path);
        let event_type = match (&self.previous, &next) {
            (None, None) => None,
            (None, Some(_)) => Some("rename"),
            (Some(_), None) => Some("rename"),
            (Some(previous), Some(next)) if previous != next => Some("change"),
            _ => None,
        };
        self.previous = next;
        Ok(event_type.map(|event_type| FsWatchEvent {
            event_type: event_type.to_string(),
            filename: std::path::Path::new(&self.path)
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| self.path.clone()),
        }))
    }
}

pub fn watch(path: &str) -> NodeResult<FsWatcher> {
    Ok(FsWatcher {
        path: path.to_string(),
        previous: WatchSnapshot::read(path),
    })
}

pub fn watch_file(path: &str) -> NodeResult<FsWatcher> {
    watch(path)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WatchSnapshot {
    len: u64,
    is_file: bool,
    is_directory: bool,
}

impl WatchSnapshot {
    fn read(path: &str) -> Option<Self> {
        let metadata = fs::metadata(path).ok()?;
        Some(Self {
            len: metadata.len(),
            is_file: metadata.is_file(),
            is_directory: metadata.is_dir(),
        })
    }
}

static NEXT_FD: AtomicI32 = AtomicI32::new(10);
static FILE_TABLE: OnceLock<Mutex<HashMap<i32, File>>> = OnceLock::new();

fn file_table() -> &'static Mutex<HashMap<i32, File>> {
    FILE_TABLE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn map_io_error(error: std::io::Error) -> NodeError {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "ENOENT",
        std::io::ErrorKind::AlreadyExists => "EEXIST",
        std::io::ErrorKind::PermissionDenied => "EACCES",
        std::io::ErrorKind::IsADirectory => "EISDIR",
        std::io::ErrorKind::NotADirectory => "ENOTDIR",
        _ => "EIO",
    };
    NodeError::new(code, error.to_string())
}
