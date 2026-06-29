use crate::buffer::Buffer;
use crate::error::NodeResult;
use crate::fs::{self, FsWriteData};

pub use crate::fs::{
    BigIntOptions, BufferEncoding, CopyFilter, CopyOptions, CopyOptionsBase, CopySyncOptions,
    CreateReadStreamOptions, CreateWriteStreamOptions, Dirent, FsReadResult, FsStreamOptions,
    FsWatchEvent, FsWatcher, MakeDirectoryOptions, Mode, NoParamCallback, ObjectEncodingOptions,
    OpenDirOptions, OpenMode, PathLike, PathOrFileDescriptor, ReadOptions, ReadPosition,
    ReadResult, ReadStreamOptions, ReadVResult, RmOptions, StatFs, StatFsOptions, StatOptions,
    StatWatcher, Stats, StatsBase, StreamOptions, TimeLike, WatchFileOptions, WatchOptions,
    WatchOptionsWithBufferEncoding, WatchOptionsWithStringEncoding, WriteOptions, WriteResult,
    WriteStreamOptions, WriteVResult,
};

pub type BigIntStats = Stats;
pub type BigIntStatsFs = StatFs;
pub type FileReadOptions = ReadOptions;
pub type FileReadResult = ReadResult;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlagAndOpenMode {
    pub flag: String,
    pub mode: u32,
}

impl Default for FlagAndOpenMode {
    fn default() -> Self {
        Self {
            flag: "r".to_string(),
            mode: 0o666,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReadableWebStreamOptions {
    pub auto_close: bool,
}

impl Default for ReadableWebStreamOptions {
    fn default() -> Self {
        Self { auto_close: true }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriterOptions {
    pub start: Option<u64>,
    pub auto_close: bool,
    pub chunk_size: usize,
    pub limit: Option<usize>,
}

impl Default for WriterOptions {
    fn default() -> Self {
        Self {
            start: None,
            auto_close: true,
            chunk_size: 64 * 1024,
            limit: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PullOptions {
    pub start: Option<u64>,
    pub chunk_size: usize,
    pub limit: Option<usize>,
    pub auto_close: bool,
}

impl Default for PullOptions {
    fn default() -> Self {
        Self {
            start: None,
            chunk_size: 64 * 1024,
            limit: None,
            auto_close: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChangeInfo {
    pub event_type: String,
    pub filename: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisposableTempDir {
    pub path: String,
    removed: bool,
}

impl DisposableTempDir {
    pub fn remove(&mut self) -> NodeResult<()> {
        if !self.removed {
            fs::rm_sync(&self.path, true, true)?;
            self.removed = true;
        }
        Ok(())
    }

    pub fn removed(&self) -> bool {
        self.removed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileHandle {
    fd: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dir {
    path: String,
    entries: Vec<Dirent>,
    index: usize,
    closed: bool,
}

impl Dir {
    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn read(&mut self) -> NodeResult<Option<Dirent>> {
        if self.closed {
            return Err(crate::error::NodeError::new(
                "ERR_DIR_CLOSED",
                "directory is closed",
            ));
        }
        let entry = self.entries.get(self.index).cloned();
        if entry.is_some() {
            self.index += 1;
        }
        Ok(entry)
    }

    pub fn entries(&self) -> &[Dirent] {
        &self.entries
    }

    pub fn close(&mut self) {
        self.closed = true;
    }

    pub fn closed(&self) -> bool {
        self.closed
    }
}

