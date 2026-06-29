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
