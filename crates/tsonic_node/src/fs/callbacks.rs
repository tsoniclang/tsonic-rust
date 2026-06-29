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

