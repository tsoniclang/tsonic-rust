use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::buffer::Buffer;
use crate::error::{NodeError, NodeResult};

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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(mode);
    }
    #[cfg(not(unix))]
    {
        permissions.set_readonly(mode & 0o200 == 0);
    }
    fs::set_permissions(path, permissions).map_err(map_io_error)
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
