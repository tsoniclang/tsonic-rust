use crate::buffer::Buffer;
use crate::error::NodeResult;
use crate::fs::{self, Dirent, FsWriteData, Stats};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileHandle {
    fd: i32,
}

impl FileHandle {
    pub fn fd(&self) -> i32 {
        self.fd
    }

    pub fn stat(&self) -> NodeResult<Stats> {
        fs::fstat_sync(self.fd)
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

    pub fn chmod(&self, mode: u32) -> NodeResult<()> {
        fs::fchmod_sync(self.fd, mode)
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

    pub fn write_buffer(
        &self,
        buffer: &Buffer,
        offset: usize,
        length: usize,
        position: Option<u64>,
    ) -> NodeResult<usize> {
        fs::write_sync_buffer(self.fd, buffer, offset, length, position)
    }

    pub fn write_string(
        &self,
        value: &str,
        position: Option<u64>,
        encoding: &str,
    ) -> NodeResult<usize> {
        fs::write_sync_string(self.fd, value, position, encoding)
    }

    pub fn close(self) -> NodeResult<()> {
        fs::close_sync(self.fd)
    }
}

pub fn access(path: &str) -> NodeResult<()> {
    fs::access_sync(path)
}

pub fn read_file_string(path: &str, encoding: &str) -> NodeResult<String> {
    fs::read_file_sync_string(path, encoding)
}

pub fn read_file_buffer(path: &str) -> NodeResult<Buffer> {
    fs::read_file_sync_buffer(path)
}

pub fn write_file_string(path: &str, value: &str, encoding: &str) -> NodeResult<()> {
    fs::write_file_sync_string(path, value, encoding)
}

pub fn write_file_buffer(path: &str, value: &Buffer) -> NodeResult<()> {
    fs::write_file_sync(path, FsWriteData::Buffer(value), None)
}

pub fn append_file_string(path: &str, value: &str, encoding: &str) -> NodeResult<()> {
    fs::append_file_sync_string(path, value, encoding)
}

pub fn append_file_buffer(path: &str, value: &Buffer) -> NodeResult<()> {
    fs::append_file_sync_buffer(path, value)
}

pub fn chmod(path: &str, mode: u32) -> NodeResult<()> {
    fs::chmod_sync(path, mode)
}

pub fn utimes(path: &str, atime_seconds: f64, mtime_seconds: f64) -> NodeResult<()> {
    fs::utimes_sync(path, atime_seconds, mtime_seconds)
}

pub fn copy_file(from: &str, to: &str) -> NodeResult<()> {
    fs::copy_file_sync(from, to)
}

pub fn cp(from: &str, to: &str, recursive: bool) -> NodeResult<()> {
    fs::cp_sync(from, to, recursive)
}

pub fn stat(path: &str) -> NodeResult<Stats> {
    fs::stat_sync(path)
}

pub fn lstat(path: &str) -> NodeResult<Stats> {
    fs::lstat_sync(path)
}

pub fn mkdir(path: &str, recursive: bool) -> NodeResult<()> {
    fs::mkdir_sync(path, recursive)
}

pub fn rm(path: &str, recursive: bool, force: bool) -> NodeResult<()> {
    fs::rm_sync(path, recursive, force)
}

pub fn rename(from: &str, to: &str) -> NodeResult<()> {
    fs::rename_sync(from, to)
}

pub fn unlink(path: &str) -> NodeResult<()> {
    fs::unlink_sync(path)
}

pub fn readdir(path: &str) -> NodeResult<Vec<String>> {
    fs::readdir_sync(path)
}

pub fn opendir(path: &str) -> NodeResult<Vec<Dirent>> {
    fs::opendir_sync(path)
}

pub fn open(path: &str, flags: &str) -> NodeResult<FileHandle> {
    Ok(FileHandle {
        fd: fs::open_sync(path, flags)?,
    })
}
