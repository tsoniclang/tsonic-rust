use crate::buffer::Buffer;
use crate::error::NodeResult;
use crate::fs::{self, Dirent, FsWriteData, StatFs, Stats};

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

    pub fn chown(&self, uid: u32, gid: u32) -> NodeResult<()> {
        fs::fchown_sync(self.fd, uid, gid)
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

pub fn chown(path: &str, uid: u32, gid: u32) -> NodeResult<()> {
    fs::chown_sync(path, uid, gid)
}

pub fn lchown(path: &str, uid: u32, gid: u32) -> NodeResult<()> {
    fs::lchown_sync(path, uid, gid)
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

pub fn link(existing_path: &str, new_path: &str) -> NodeResult<()> {
    fs::link_sync(existing_path, new_path)
}

pub fn stat(path: &str) -> NodeResult<Stats> {
    fs::stat_sync(path)
}

pub fn statfs(path: &str) -> NodeResult<StatFs> {
    fs::statfs_sync(path)
}

pub fn lstat(path: &str) -> NodeResult<Stats> {
    fs::lstat_sync(path)
}

pub fn mkdir(path: &str, recursive: bool) -> NodeResult<()> {
    fs::mkdir_sync(path, recursive)
}

pub fn mkdtemp(prefix: &str) -> NodeResult<String> {
    fs::mkdtemp_sync(prefix)
}

pub fn rm(path: &str, recursive: bool, force: bool) -> NodeResult<()> {
    fs::rm_sync(path, recursive, force)
}

pub fn rmdir(path: &str) -> NodeResult<()> {
    fs::rmdir_sync(path)
}

pub fn rename(from: &str, to: &str) -> NodeResult<()> {
    fs::rename_sync(from, to)
}

pub fn unlink(path: &str) -> NodeResult<()> {
    fs::unlink_sync(path)
}

pub fn truncate(path: &str, len: u64) -> NodeResult<()> {
    fs::truncate_sync(path, len)
}

pub fn symlink(target: &str, path: &str) -> NodeResult<()> {
    fs::symlink_sync(target, path)
}

pub fn readlink(path: &str) -> NodeResult<String> {
    fs::readlink_sync(path)
}

pub fn realpath(path: &str) -> NodeResult<String> {
    fs::realpath_sync(path)
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
