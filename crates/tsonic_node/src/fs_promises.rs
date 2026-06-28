use crate::buffer::Buffer;
use crate::error::NodeResult;
use crate::fs::{self, Dirent, FsWriteData, StatFs, Stats};

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

    pub fn readv(&self, buffers: &mut [Buffer], position: Option<u64>) -> NodeResult<usize> {
        fs::readv_sync(self.fd, buffers, position)
    }

    pub fn writev(&self, buffers: &[Buffer], position: Option<u64>) -> NodeResult<usize> {
        fs::writev_sync(self.fd, buffers, position)
    }

    pub fn write_string(
        &self,
        value: &str,
        position: Option<u64>,
        encoding: &str,
    ) -> NodeResult<usize> {
        fs::write_sync_string(self.fd, value, position, encoding)
    }

    pub fn append_file_string(&self, value: &str, encoding: &str) -> NodeResult<usize> {
        let position = Some(self.stat()?.size);
        self.write_string(value, position, encoding)
    }

    pub fn append_file_buffer(&self, value: &Buffer) -> NodeResult<usize> {
        let position = Some(self.stat()?.size);
        self.write_buffer(value, 0, value.len(), position)
    }

    pub fn read_file_buffer(&self) -> NodeResult<Buffer> {
        let size = self.stat()?.size as usize;
        let mut buffer = Buffer::alloc(size);
        let read = self.read(&mut buffer, 0, size, Some(0))?;
        Ok(Buffer::from_bytes(buffer.as_bytes()[..read].to_vec()))
    }

    pub fn read_file_string(&self, encoding: &str) -> NodeResult<String> {
        self.read_file_buffer()?.to_string(Some(encoding))
    }

    pub fn readable_web_stream(&self) -> NodeResult<crate::stream::web::ReadableStream> {
        Ok(crate::stream::web::ReadableStream::from_chunks(vec![
            self.read_file_buffer()?
        ]))
    }

    pub fn writable_web_stream(&self) -> crate::stream::web::WritableStream {
        crate::stream::web::WritableStream::new()
    }

    pub fn create_read_stream(&self) -> NodeResult<crate::stream::Readable> {
        Ok(crate::stream::Readable::from_chunks(vec![
            self.read_file_buffer()?
        ]))
    }

    pub fn create_write_stream(&self) -> crate::stream::Writable {
        crate::stream::Writable::new()
    }

    pub fn read_lines(&self, encoding: &str) -> NodeResult<Vec<String>> {
        Ok(self
            .read_file_string(encoding)?
            .lines()
            .map(str::to_string)
            .collect())
    }

    pub fn pull(&self, chunk_size: usize) -> NodeResult<crate::stream::Readable> {
        let buffer = self.read_file_buffer()?;
        if chunk_size == 0 || buffer.len() <= chunk_size {
            return Ok(crate::stream::Readable::from_chunks(vec![buffer]));
        }
        let chunks = buffer
            .as_bytes()
            .chunks(chunk_size)
            .map(|chunk| Buffer::from_bytes(chunk.to_vec()))
            .collect();
        Ok(crate::stream::Readable::from_chunks(chunks))
    }

    pub fn writer(&self) -> FileHandleWriter {
        FileHandleWriter {
            fd: self.fd,
            position: None,
        }
    }

    pub fn close(self) -> NodeResult<()> {
        fs::close_sync(self.fd)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileHandleWriter {
    fd: i32,
    position: Option<u64>,
}

impl FileHandleWriter {
    pub fn fd(&self) -> i32 {
        self.fd
    }

    pub fn position(&self) -> Option<u64> {
        self.position
    }

    pub fn seek(&mut self, position: u64) {
        self.position = Some(position);
    }

    pub fn write_buffer(&mut self, buffer: &Buffer) -> NodeResult<usize> {
        let written = fs::write_sync_buffer(self.fd, buffer, 0, buffer.len(), self.position)?;
        if let Some(position) = self.position {
            self.position = Some(position + written as u64);
        }
        Ok(written)
    }

    pub fn write_string(&mut self, value: &str, encoding: &str) -> NodeResult<usize> {
        let written = fs::write_sync_string(self.fd, value, self.position, encoding)?;
        if let Some(position) = self.position {
            self.position = Some(position + written as u64);
        }
        Ok(written)
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

pub fn opendir_handle(path: &str) -> NodeResult<Dir> {
    Ok(Dir {
        path: path.to_string(),
        entries: opendir(path)?,
        index: 0,
        closed: false,
    })
}

pub fn open(path: &str, flags: &str) -> NodeResult<FileHandle> {
    Ok(FileHandle {
        fd: fs::open_sync(path, flags)?,
    })
}
