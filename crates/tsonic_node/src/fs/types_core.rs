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

