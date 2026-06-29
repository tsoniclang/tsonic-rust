use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

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

#[derive(Debug, Clone, PartialEq)]
pub struct Stats {
    pub size: u64,
    pub dev: u64,
    pub ino: u64,
    pub mode: u32,
    pub nlink: u64,
    pub uid: u32,
    pub gid: u32,
    pub rdev: u64,
    pub blksize: u64,
    pub blocks: u64,
    pub atime_ms: f64,
    pub mtime_ms: f64,
    pub ctime_ms: f64,
    pub birthtime_ms: f64,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symbolic_link: bool,
    pub is_block_device: bool,
    pub is_character_device: bool,
    pub is_fifo: bool,
    pub is_socket: bool,
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

    pub fn is_block_device(&self) -> bool {
        self.is_block_device
    }

    pub fn is_character_device(&self) -> bool {
        self.is_character_device
    }

    pub fn is_fifo(&self) -> bool {
        self.is_fifo
    }

    pub fn is_socket(&self) -> bool {
        self.is_socket
    }

    pub fn atime_ms(&self) -> f64 {
        self.atime_ms
    }

    pub fn mtime_ms(&self) -> f64 {
        self.mtime_ms
    }

    pub fn ctime_ms(&self) -> f64 {
        self.ctime_ms
    }

    pub fn birthtime_ms(&self) -> f64 {
        self.birthtime_ms
    }

    pub fn atime(&self) -> tsonic_js::date::JsDate {
        tsonic_js::date::JsDate::from_millis(self.atime_ms)
    }

    pub fn mtime(&self) -> tsonic_js::date::JsDate {
        tsonic_js::date::JsDate::from_millis(self.mtime_ms)
    }

    pub fn ctime(&self) -> tsonic_js::date::JsDate {
        tsonic_js::date::JsDate::from_millis(self.ctime_ms)
    }

    pub fn birthtime(&self) -> tsonic_js::date::JsDate {
        tsonic_js::date::JsDate::from_millis(self.birthtime_ms)
    }

    pub fn atime_ns(&self) -> u128 {
        ms_to_ns(self.atime_ms)
    }

    pub fn mtime_ns(&self) -> u128 {
        ms_to_ns(self.mtime_ms)
    }

    pub fn ctime_ns(&self) -> u128 {
        ms_to_ns(self.ctime_ms)
    }

    pub fn birthtime_ns(&self) -> u128 {
        ms_to_ns(self.birthtime_ms)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FsConstants {
    pub f_ok: i32,
    pub r_ok: i32,
    pub w_ok: i32,
    pub x_ok: i32,
    pub copyfile_excl: i32,
    pub copyfile_ficlone: i32,
    pub copyfile_ficlone_force: i32,
    pub o_rdonly: i32,
    pub o_wronly: i32,
    pub o_rdwr: i32,
    pub o_creat: i32,
    pub o_direct: i32,
    pub o_directory: i32,
    pub o_dsync: i32,
    pub o_excl: i32,
    pub o_noatime: i32,
    pub o_noctty: i32,
    pub o_nofollow: i32,
    pub o_nonblock: i32,
    pub o_symlink: i32,
    pub o_sync: i32,
    pub o_trunc: i32,
    pub o_append: i32,
    pub s_ifmt: i32,
    pub s_ifreg: i32,
    pub s_ifdir: i32,
    pub s_ifchr: i32,
    pub s_ifblk: i32,
    pub s_ififo: i32,
    pub s_iflnk: i32,
    pub s_ifsock: i32,
    pub s_irwxu: i32,
    pub s_irusr: i32,
    pub s_iwusr: i32,
    pub s_ixusr: i32,
    pub s_irwxg: i32,
    pub s_irgrp: i32,
    pub s_iwgrp: i32,
    pub s_ixgrp: i32,
    pub s_irwxo: i32,
    pub s_iroth: i32,
    pub s_iwoth: i32,
    pub s_ixoth: i32,
    pub uv_fs_o_filemap: i32,
}

pub fn constants() -> FsConstants {
    FsConstants {
        f_ok: 0,
        r_ok: 4,
        w_ok: 2,
        x_ok: 1,
        copyfile_excl: 1,
        copyfile_ficlone: 2,
        copyfile_ficlone_force: 4,
        o_rdonly: platform_constant_o_rdonly(),
        o_wronly: platform_constant_o_wronly(),
        o_rdwr: platform_constant_o_rdwr(),
        o_creat: platform_constant_o_creat(),
        o_direct: platform_constant_o_direct(),
        o_directory: platform_constant_o_directory(),
        o_dsync: platform_constant_o_dsync(),
        o_excl: platform_constant_o_excl(),
        o_noatime: platform_constant_o_noatime(),
        o_noctty: platform_constant_o_noctty(),
        o_nofollow: platform_constant_o_nofollow(),
        o_nonblock: platform_constant_o_nonblock(),
        o_symlink: 0,
        o_sync: platform_constant_o_sync(),
        o_trunc: platform_constant_o_trunc(),
        o_append: platform_constant_o_append(),
        s_ifmt: 0o170000,
        s_ifreg: 0o100000,
        s_ifdir: 0o040000,
        s_ifchr: 0o020000,
        s_ifblk: 0o060000,
        s_ififo: 0o010000,
        s_iflnk: 0o120000,
        s_ifsock: 0o140000,
        s_irwxu: 0o700,
        s_irusr: 0o400,
        s_iwusr: 0o200,
        s_ixusr: 0o100,
        s_irwxg: 0o070,
        s_irgrp: 0o040,
        s_iwgrp: 0o020,
        s_ixgrp: 0o010,
        s_irwxo: 0o007,
        s_iroth: 0o004,
        s_iwoth: 0o002,
        s_ixoth: 0o001,
        uv_fs_o_filemap: 0,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dirent {
    pub name: String,
    pub parent_path: String,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symbolic_link: bool,
    pub is_block_device: bool,
    pub is_character_device: bool,
    pub is_fifo: bool,
    pub is_socket: bool,
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

    pub fn is_block_device(&self) -> bool {
        self.is_block_device
    }

    pub fn is_character_device(&self) -> bool {
        self.is_character_device
    }

    pub fn is_fifo(&self) -> bool {
        self.is_fifo
    }

    pub fn is_socket(&self) -> bool {
        self.is_socket
    }

    pub fn parent_path(&self) -> &str {
        &self.parent_path
    }

    pub fn parent_path_value(&self) -> String {
        self.parent_path.clone()
    }

    pub fn file_type(&self) -> &'static str {
        if self.is_file {
            "file"
        } else if self.is_directory {
            "directory"
        } else if self.is_symbolic_link {
            "symlink"
        } else if self.is_block_device {
            "blockDevice"
        } else if self.is_character_device {
            "characterDevice"
        } else if self.is_fifo {
            "fifo"
        } else if self.is_socket {
            "socket"
        } else {
            "unknown"
        }
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

pub type PathLike = String;
pub type PathOrFileDescriptor = String;
pub type OpenMode = String;
pub type BufferEncoding = String;
pub type Mode = u32;
pub type TimeLike = f64;
pub type ReadPosition = u64;
pub type NoParamCallback = fn(NodeResult<()>);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectEncodingOptions {
    pub encoding: Option<String>,
}

impl ObjectEncodingOptions {
    pub fn buffer() -> Self {
        Self { encoding: None }
    }

    pub fn string(encoding: &str) -> Self {
        Self {
            encoding: Some(encoding.to_string()),
        }
    }
}

impl Default for ObjectEncodingOptions {
    fn default() -> Self {
        Self::buffer()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BigIntOptions {
    pub bigint: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatOptions {
    pub bigint: bool,
    pub throw_if_no_entry: bool,
}

impl Default for StatOptions {
    fn default() -> Self {
        Self {
            bigint: false,
            throw_if_no_entry: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatFsOptions {
    pub bigint: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MakeDirectoryOptions {
    pub recursive: bool,
    pub mode: u32,
}

impl Default for MakeDirectoryOptions {
    fn default() -> Self {
        Self {
            recursive: false,
            mode: 0o777,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RmOptions {
    pub recursive: bool,
    pub force: bool,
    pub max_retries: u32,
    pub retry_delay_ms: u64,
}

impl Default for RmOptions {
    fn default() -> Self {
        Self {
            recursive: false,
            force: false,
            max_retries: 0,
            retry_delay_ms: 100,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CopyFilter {
    AcceptAll,
    RejectAll,
}

impl CopyFilter {
    pub fn accepts(&self, _source: &str, _destination: &str) -> bool {
        matches!(self, Self::AcceptAll)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopyOptionsBase {
    pub dereference: bool,
    pub error_on_exist: bool,
    pub force: bool,
    pub mode: i32,
    pub preserve_timestamps: bool,
    pub recursive: bool,
    pub verbatim_symlinks: bool,
}

impl Default for CopyOptionsBase {
    fn default() -> Self {
        Self {
            dereference: false,
            error_on_exist: false,
            force: true,
            mode: 0,
            preserve_timestamps: false,
            recursive: false,
            verbatim_symlinks: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CopyOptions {
    pub base: CopyOptionsBase,
    pub filter: Option<CopyFilter>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CopySyncOptions {
    pub base: CopyOptionsBase,
    pub filter: Option<CopyFilter>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenDirOptions {
    pub encoding: Option<String>,
    pub buffer_size: usize,
    pub recursive: bool,
}

impl Default for OpenDirOptions {
    fn default() -> Self {
        Self {
            encoding: Some("utf8".to_string()),
            buffer_size: 32,
            recursive: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReadOptions {
    pub offset: usize,
    pub length: usize,
    pub position: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadResult {
    pub bytes_read: usize,
    pub buffer: Buffer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadVResult {
    pub bytes_read: usize,
    pub buffers: Vec<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteOptions {
    pub offset: usize,
    pub length: usize,
    pub position: Option<u64>,
    pub encoding: String,
}

impl WriteOptions {
    pub fn buffer(offset: usize, length: usize, position: Option<u64>) -> Self {
        Self {
            offset,
            length,
            position,
            encoding: "utf8".to_string(),
        }
    }

    pub fn string(position: Option<u64>, encoding: &str) -> Self {
        Self {
            offset: 0,
            length: usize::MAX,
            position,
            encoding: encoding.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteResult {
    pub bytes_written: usize,
    pub buffer: Option<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteVResult {
    pub bytes_written: usize,
    pub buffers: Vec<Buffer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsStreamOptions {
    pub flags: String,
    pub encoding: Option<String>,
    pub fd: Option<i32>,
    pub mode: u32,
    pub auto_close: bool,
    pub emit_close: bool,
    pub start: Option<u64>,
    pub end: Option<u64>,
    pub high_water_mark: usize,
    pub flush: bool,
    pub signal_aborted: bool,
}

impl Default for FsStreamOptions {
    fn default() -> Self {
        Self {
            flags: "r".to_string(),
            encoding: None,
            fd: None,
            mode: 0o666,
            auto_close: true,
            emit_close: true,
            start: None,
            end: None,
            high_water_mark: 64 * 1024,
            flush: false,
            signal_aborted: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReadStreamOptions {
    pub stream: FsStreamOptions,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WriteStreamOptions {
    pub stream: FsStreamOptions,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchOptions {
    pub persistent: bool,
    pub recursive: bool,
    pub encoding: Option<String>,
    pub ignore: Vec<String>,
    pub signal_aborted: bool,
    pub max_queue: usize,
    pub overflow: String,
}

impl Default for WatchOptions {
    fn default() -> Self {
        Self {
            persistent: true,
            recursive: false,
            encoding: Some("utf8".to_string()),
            ignore: Vec::new(),
            signal_aborted: false,
            max_queue: usize::MAX,
            overflow: "ignore".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WatchFileOptions {
    pub bigint: bool,
    pub persistent: bool,
    pub interval_ms: u64,
}

impl Default for WatchFileOptions {
    fn default() -> Self {
        Self {
            bigint: false,
            persistent: true,
            interval_ms: 5007,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Utf8StreamOptions {
    pub dest: Option<String>,
    pub fd: Option<i32>,
    pub fs: Option<FsImplementation>,
    pub min_length: usize,
    pub max_length: usize,
    pub max_write: usize,
    pub content_mode: String,
    pub append: bool,
    pub sync: bool,
    pub fsync: bool,
    pub mkdir: bool,
    pub mode: u32,
    pub periodic_flush_ms: Option<u64>,
    pub retry_eagain: bool,
}

impl Default for Utf8StreamOptions {
    fn default() -> Self {
        Self {
            dest: None,
            fd: None,
            fs: None,
            min_length: 0,
            max_length: usize::MAX,
            max_write: usize::MAX,
            content_mode: "utf8".to_string(),
            append: false,
            sync: false,
            fsync: false,
            mkdir: false,
            mode: 0o666,
            periodic_flush_ms: None,
            retry_eagain: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GlobOptions {
    pub cwd: Option<String>,
    pub with_file_types: Option<bool>,
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GlobOptionsWithoutFileTypes {
    pub cwd: Option<String>,
    pub with_file_types: bool,
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GlobOptionsWithFileTypes {
    pub cwd: Option<String>,
    pub with_file_types: bool,
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OpenAsBlobOptions {
    pub type_: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReadOptionsWithBuffer {
    pub buffer: Option<Buffer>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FsImplementation {
    pub open: bool,
    pub close: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CreateReadStreamFsImplementation {
    pub read: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CreateWriteStreamFsImplementation {
    pub write: bool,
    pub writev: bool,
}

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dir {
    pub path: String,
    entries: Vec<Dirent>,
    index: usize,
    closed: bool,
}

impl Dir {
    pub fn open(path: &str) -> NodeResult<Self> {
        Ok(Self {
            path: path.to_string(),
            entries: opendir_sync(path)?,
            index: 0,
            closed: false,
        })
    }

    pub fn read_sync(&mut self) -> Option<Dirent> {
        if self.closed {
            return None;
        }
        let entry = self.entries.get(self.index).cloned();
        if entry.is_some() {
            self.index += 1;
        }
        entry
    }

    pub fn read(&mut self) -> NodeResult<Option<Dirent>> {
        Ok(self.read_sync())
    }

    pub fn read_callback(&mut self, callback: impl FnOnce(NodeResult<Option<Dirent>>)) {
        callback(self.read());
    }

    pub fn close_sync(&mut self) {
        self.closed = true;
    }

    pub fn close(&mut self) -> NodeResult<()> {
        self.close_sync();
        Ok(())
    }

    pub fn close_callback(&mut self, callback: impl FnOnce(NodeResult<()>)) {
        callback(self.close());
    }

    pub fn closed(&self) -> bool {
        self.closed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisposableTempDir {
    pub path: String,
}

impl DisposableTempDir {
    pub fn new(path: String) -> Self {
        Self { path }
    }

    pub fn remove(&self) -> NodeResult<()> {
        rm_sync(&self.path, true, true)
    }
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

pub fn mkdir_sync(path: &str, recursive: bool) -> NodeResult<()> {
    if recursive {
        fs::create_dir_all(path).map_err(map_io_error)
    } else {
        fs::create_dir(path).map_err(map_io_error)
    }
}

pub fn mkdir_sync_with_options(path: &str, options: MakeDirectoryOptions) -> NodeResult<()> {
    mkdir_sync(path, options.recursive)?;
    chmod_sync(path, options.mode)
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

pub fn rm_sync_with_options(path: &str, options: RmOptions) -> NodeResult<()> {
    let mut attempts = 0;
    loop {
        match rm_sync(path, options.recursive, options.force) {
            Ok(()) => return Ok(()),
            Err(error) if attempts < options.max_retries => {
                attempts += 1;
                if options.retry_delay_ms > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(options.retry_delay_ms));
                }
                if error.code == "ENOENT" && options.force {
                    return Ok(());
                }
            }
            Err(error) => return Err(error),
        }
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

pub fn copy_file_sync_with_mode(from: &str, to: &str, mode: i32) -> NodeResult<()> {
    if mode & constants().copyfile_excl != 0 && std::path::Path::new(to).exists() {
        return Err(NodeError::new("EEXIST", "destination already exists"));
    }
    copy_file_sync(from, to)
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

pub fn cp_sync_with_options(from: &str, to: &str, options: &CopySyncOptions) -> NodeResult<()> {
    if let Some(filter) = &options.filter {
        if !filter.accepts(from, to) {
            return Ok(());
        }
    }
    if std::path::Path::new(to).exists() && options.base.error_on_exist {
        return Err(NodeError::new("EEXIST", "destination already exists"));
    }
    if std::path::Path::new(to).exists() && !options.base.force {
        return Ok(());
    }
    if options.base.mode != 0 {
        copy_file_sync_with_mode(from, to, options.base.mode)
    } else {
        cp_sync(from, to, options.base.recursive)
    }
}

pub fn copy_sync(from: &str, to: &str, options: &CopyOptions) -> NodeResult<()> {
    cp_sync_with_options(
        from,
        to,
        &CopySyncOptions {
            base: options.base.clone(),
            filter: options.filter.clone(),
        },
    )
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

pub fn realpath_native(path: &str) -> NodeResult<String> {
    realpath_sync(path)
}

pub fn realpath_sync_native(path: &str) -> NodeResult<String> {
    realpath_sync(path)
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

pub fn mkdtemp_disposable_sync(prefix: &str) -> NodeResult<DisposableTempDir> {
    mkdtemp_sync(prefix).map(DisposableTempDir::new)
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
            is_block_device: false,
            is_character_device: false,
            is_fifo: false,
            is_socket: false,
        });
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(entries)
}

pub fn opendir_handle_sync(path: &str) -> NodeResult<Dir> {
    Dir::open(path)
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

pub fn chmod_callback(path: &str, mode: u32, callback: impl FnOnce(NodeResult<()>)) {
    callback(chmod_sync(path, mode));
}

pub fn chown_callback(path: &str, uid: u32, gid: u32, callback: impl FnOnce(NodeResult<()>)) {
    callback(chown_sync(path, uid, gid));
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

pub fn statfs_callback(path: &str, callback: impl FnOnce(NodeResult<StatFs>)) {
    callback(statfs_sync(path));
}

pub fn lstat_callback(path: &str, callback: impl FnOnce(NodeResult<Stats>)) {
    callback(lstat_sync(path));
}

pub fn lchown_callback(path: &str, uid: u32, gid: u32, callback: impl FnOnce(NodeResult<()>)) {
    callback(lchown_sync(path, uid, gid));
}

pub fn lchmod_callback(path: &str, mode: u32, callback: impl FnOnce(NodeResult<()>)) {
    callback(lchmod_sync(path, mode));
}

pub fn utimes_callback(
    path: &str,
    atime_seconds: f64,
    mtime_seconds: f64,
    callback: impl FnOnce(NodeResult<()>),
) {
    callback(utimes_sync(path, atime_seconds, mtime_seconds));
}

pub fn lutimes_callback(
    path: &str,
    atime_seconds: f64,
    mtime_seconds: f64,
    callback: impl FnOnce(NodeResult<()>),
) {
    callback(lutimes_sync(path, atime_seconds, mtime_seconds));
}

pub fn readdir_callback(path: &str, callback: impl FnOnce(NodeResult<Vec<String>>)) {
    callback(readdir_sync(path));
}

pub fn mkdir_callback(path: &str, recursive: bool, callback: impl FnOnce(NodeResult<()>)) {
    callback(mkdir_sync(path, recursive));
}

pub fn mkdtemp_callback(prefix: &str, callback: impl FnOnce(NodeResult<String>)) {
    callback(mkdtemp_sync(prefix));
}

pub fn copy_file_callback(from: &str, to: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(copy_file_sync(from, to));
}

pub fn cp_callback(from: &str, to: &str, recursive: bool, callback: impl FnOnce(NodeResult<()>)) {
    callback(cp_sync(from, to, recursive));
}

pub fn link_callback(existing_path: &str, new_path: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(link_sync(existing_path, new_path));
}

pub fn rename_callback(from: &str, to: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(rename_sync(from, to));
}

pub fn readlink_callback(path: &str, callback: impl FnOnce(NodeResult<String>)) {
    callback(readlink_sync(path));
}

pub fn realpath_callback(path: &str, callback: impl FnOnce(NodeResult<String>)) {
    callback(realpath_sync(path));
}

pub fn rmdir_callback(path: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(rmdir_sync(path));
}

pub fn symlink_callback(target: &str, path: &str, callback: impl FnOnce(NodeResult<()>)) {
    callback(symlink_sync(target, path));
}

pub fn truncate_callback(path: &str, len: u64, callback: impl FnOnce(NodeResult<()>)) {
    callback(truncate_sync(path, len));
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

pub fn open_callback(path: &str, flags: &str, callback: impl FnOnce(NodeResult<i32>)) {
    callback(open_sync(path, flags));
}

pub fn close_callback(fd: i32, callback: impl FnOnce(NodeResult<()>)) {
    callback(close_sync(fd));
}

pub fn read_callback(
    fd: i32,
    buffer: &mut Buffer,
    offset: usize,
    length: usize,
    position: Option<u64>,
    callback: impl FnOnce(NodeResult<usize>),
) {
    callback(read_sync(fd, buffer, offset, length, position));
}

pub fn readv_callback(
    fd: i32,
    buffers: &mut [Buffer],
    position: Option<u64>,
    callback: impl FnOnce(NodeResult<usize>),
) {
    callback(readv_sync(fd, buffers, position));
}

pub fn write_callback_buffer(
    fd: i32,
    buffer: &Buffer,
    offset: usize,
    length: usize,
    position: Option<u64>,
    callback: impl FnOnce(NodeResult<usize>),
) {
    callback(write_sync_buffer(fd, buffer, offset, length, position));
}

pub fn write_callback_string(
    fd: i32,
    value: &str,
    position: Option<u64>,
    encoding: &str,
    callback: impl FnOnce(NodeResult<usize>),
) {
    callback(write_sync_string(fd, value, position, encoding));
}

pub fn writev_callback(
    fd: i32,
    buffers: &[Buffer],
    position: Option<u64>,
    callback: impl FnOnce(NodeResult<usize>),
) {
    callback(writev_sync(fd, buffers, position));
}

pub fn fstat_callback(fd: i32, callback: impl FnOnce(NodeResult<Stats>)) {
    callback(fstat_sync(fd));
}

pub fn fchmod_callback(fd: i32, mode: u32, callback: impl FnOnce(NodeResult<()>)) {
    callback(fchmod_sync(fd, mode));
}

pub fn fchown_callback(fd: i32, uid: u32, gid: u32, callback: impl FnOnce(NodeResult<()>)) {
    callback(fchown_sync(fd, uid, gid));
}

pub fn fsync_callback(fd: i32, callback: impl FnOnce(NodeResult<()>)) {
    callback(fsync_sync(fd));
}

pub fn fdatasync_callback(fd: i32, callback: impl FnOnce(NodeResult<()>)) {
    callback(fdatasync_sync(fd));
}

pub fn ftruncate_callback(fd: i32, len: u64, callback: impl FnOnce(NodeResult<()>)) {
    callback(ftruncate_sync(fd, len));
}

pub fn futimes_callback(
    fd: i32,
    atime_seconds: f64,
    mtime_seconds: f64,
    callback: impl FnOnce(NodeResult<()>),
) {
    callback(futimes_sync(fd, atime_seconds, mtime_seconds));
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
    closed: bool,
    refed: bool,
}

impl FsWatcher {
    pub fn poll(&mut self) -> NodeResult<Option<FsWatchEvent>> {
        if self.closed {
            return Err(NodeError::new("ERR_WATCHER_CLOSED", "watcher is closed"));
        }
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

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn ref_(&mut self) -> &mut Self {
        self.refed = true;
        self
    }

    pub fn unref(&mut self) -> &mut Self {
        self.refed = false;
        self
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }

    pub fn closed(&self) -> bool {
        self.closed
    }
}

pub fn watch(path: &str) -> NodeResult<FsWatcher> {
    watch_with_options(path, WatchOptions::default())
}

pub fn watch_with_options(path: &str, options: WatchOptions) -> NodeResult<FsWatcher> {
    if options.signal_aborted {
        return Err(NodeError::new("ABORT_ERR", "watch was aborted"));
    }
    Ok(FsWatcher {
        path: path.to_string(),
        previous: WatchSnapshot::read(path),
        closed: false,
        refed: options.persistent,
    })
}

pub fn watch_file(path: &str) -> NodeResult<FsWatcher> {
    watch(path)
}

pub fn watch_file_with_options(path: &str, options: WatchFileOptions) -> NodeResult<FsWatcher> {
    let mut watcher = watch(path)?;
    watcher.refed = options.persistent;
    Ok(watcher)
}

pub type StatWatcher = FsWatcher;

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

fn stats_from_metadata(metadata: &fs::Metadata) -> Stats {
    Stats {
        size: metadata.len(),
        dev: metadata_dev(metadata),
        ino: metadata_ino(metadata),
        mode: metadata_mode(metadata),
        nlink: metadata_nlink(metadata),
        uid: metadata_uid(metadata),
        gid: metadata_gid(metadata),
        rdev: metadata_rdev(metadata),
        blksize: metadata_blksize(metadata),
        blocks: metadata_blocks(metadata),
        atime_ms: system_time_ms(metadata.accessed().ok()),
        mtime_ms: system_time_ms(metadata.modified().ok()),
        ctime_ms: system_time_ms(metadata_changed(metadata)),
        birthtime_ms: system_time_ms(metadata.created().ok()),
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_symbolic_link: metadata.file_type().is_symlink(),
        is_block_device: metadata_is_block_device(metadata),
        is_character_device: metadata_is_character_device(metadata),
        is_fifo: metadata_is_fifo(metadata),
        is_socket: metadata_is_socket(metadata),
    }
}

fn ms_to_ns(value: f64) -> u128 {
    if value.is_finite() && value > 0.0 {
        (value * 1_000_000.0).round() as u128
    } else {
        0
    }
}

fn system_time_ms(value: Option<SystemTime>) -> f64 {
    value
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[cfg(unix)]
fn metadata_dev(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.dev()
}

#[cfg(not(unix))]
fn metadata_dev(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_ino(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.ino()
}

#[cfg(not(unix))]
fn metadata_ino(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_mode(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;
    metadata.mode()
}

#[cfg(not(unix))]
fn metadata_mode(metadata: &fs::Metadata) -> u32 {
    if metadata.permissions().readonly() {
        0o444
    } else {
        0o666
    }
}

#[cfg(unix)]
fn metadata_nlink(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.nlink()
}

#[cfg(not(unix))]
fn metadata_nlink(_metadata: &fs::Metadata) -> u64 {
    1
}

#[cfg(unix)]
fn metadata_uid(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;
    metadata.uid()
}

#[cfg(not(unix))]
fn metadata_uid(_metadata: &fs::Metadata) -> u32 {
    0
}

#[cfg(unix)]
fn metadata_gid(metadata: &fs::Metadata) -> u32 {
    use std::os::unix::fs::MetadataExt;
    metadata.gid()
}

#[cfg(not(unix))]
fn metadata_gid(_metadata: &fs::Metadata) -> u32 {
    0
}

#[cfg(unix)]
fn metadata_rdev(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.rdev()
}

#[cfg(not(unix))]
fn metadata_rdev(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_blksize(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.blksize()
}

#[cfg(not(unix))]
fn metadata_blksize(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_blocks(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.blocks()
}

#[cfg(not(unix))]
fn metadata_blocks(_metadata: &fs::Metadata) -> u64 {
    0
}

#[cfg(unix)]
fn metadata_is_block_device(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_block_device()
}

#[cfg(not(unix))]
fn metadata_is_block_device(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_is_character_device(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_char_device()
}

#[cfg(not(unix))]
fn metadata_is_character_device(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_is_fifo(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_fifo()
}

#[cfg(not(unix))]
fn metadata_is_fifo(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_is_socket(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;
    metadata.file_type().is_socket()
}

#[cfg(not(unix))]
fn metadata_is_socket(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn metadata_changed(metadata: &fs::Metadata) -> Option<SystemTime> {
    use std::os::unix::fs::MetadataExt;
    let seconds = metadata.ctime();
    let nanos = metadata.ctime_nsec();
    if seconds < 0 {
        return None;
    }
    Some(UNIX_EPOCH + std::time::Duration::new(seconds as u64, nanos as u32))
}

#[cfg(not(unix))]
fn metadata_changed(metadata: &fs::Metadata) -> Option<SystemTime> {
    metadata.modified().ok()
}

#[cfg(unix)]
fn platform_constant_o_rdonly() -> i32 {
    libc::O_RDONLY
}

#[cfg(not(unix))]
fn platform_constant_o_rdonly() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_wronly() -> i32 {
    libc::O_WRONLY
}

#[cfg(not(unix))]
fn platform_constant_o_wronly() -> i32 {
    1
}

#[cfg(unix)]
fn platform_constant_o_rdwr() -> i32 {
    libc::O_RDWR
}

#[cfg(not(unix))]
fn platform_constant_o_rdwr() -> i32 {
    2
}

#[cfg(unix)]
fn platform_constant_o_creat() -> i32 {
    libc::O_CREAT
}

#[cfg(not(unix))]
fn platform_constant_o_creat() -> i32 {
    0x100
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn platform_constant_o_direct() -> i32 {
    libc::O_DIRECT
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn platform_constant_o_direct() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_directory() -> i32 {
    libc::O_DIRECTORY
}

#[cfg(not(unix))]
fn platform_constant_o_directory() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_dsync() -> i32 {
    libc::O_DSYNC
}

#[cfg(not(unix))]
fn platform_constant_o_dsync() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_excl() -> i32 {
    libc::O_EXCL
}

#[cfg(not(unix))]
fn platform_constant_o_excl() -> i32 {
    0x400
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn platform_constant_o_noatime() -> i32 {
    libc::O_NOATIME
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn platform_constant_o_noatime() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_noctty() -> i32 {
    libc::O_NOCTTY
}

#[cfg(not(unix))]
fn platform_constant_o_noctty() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_nofollow() -> i32 {
    libc::O_NOFOLLOW
}

#[cfg(not(unix))]
fn platform_constant_o_nofollow() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_nonblock() -> i32 {
    libc::O_NONBLOCK
}

#[cfg(not(unix))]
fn platform_constant_o_nonblock() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_sync() -> i32 {
    libc::O_SYNC
}

#[cfg(not(unix))]
fn platform_constant_o_sync() -> i32 {
    0
}

#[cfg(unix)]
fn platform_constant_o_trunc() -> i32 {
    libc::O_TRUNC
}

#[cfg(not(unix))]
fn platform_constant_o_trunc() -> i32 {
    0x200
}

#[cfg(unix)]
fn platform_constant_o_append() -> i32 {
    libc::O_APPEND
}

#[cfg(not(unix))]
fn platform_constant_o_append() -> i32 {
    0x8
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
