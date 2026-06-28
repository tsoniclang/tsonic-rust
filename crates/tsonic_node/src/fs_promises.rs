use crate::buffer::Buffer;
use crate::error::NodeResult;
use crate::fs::{self, Dirent, FsWriteData, Stats};

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

pub fn readdir(path: &str) -> NodeResult<Vec<String>> {
    fs::readdir_sync(path)
}

pub fn opendir(path: &str) -> NodeResult<Vec<Dirent>> {
    fs::opendir_sync(path)
}
