pub fn access(path: &str) -> NodeResult<()> {
    fs::access_sync(path)
}

pub fn exists(path: &str) -> NodeResult<bool> {
    Ok(fs::exists_sync(path))
}

pub fn read_file_string(path: &str, encoding: &str) -> NodeResult<String> {
    fs::read_file_sync_string(path, encoding)
}

pub fn read_file_buffer(path: &str) -> NodeResult<Buffer> {
    fs::read_file_sync_buffer(path)
}

pub fn read_file_with_options(
    path: &str,
    options: &ObjectEncodingOptions,
) -> NodeResult<FsReadResult> {
    fs::read_file_sync_with_options(path, options)
}

pub fn write_file_string(path: &str, value: &str, encoding: &str) -> NodeResult<()> {
    fs::write_file_sync_string(path, value, encoding)
}

pub fn write_file_buffer(path: &str, value: &Buffer) -> NodeResult<()> {
    fs::write_file_sync(path, FsWriteData::Buffer(value), None)
}

pub fn write_file_string_with_options(
    path: &str,
    value: &str,
    options: &ObjectEncodingOptions,
) -> NodeResult<()> {
    fs::write_file_sync(
        path,
        FsWriteData::String(value),
        options.encoding.as_deref(),
    )
}

pub fn write_file_buffer_with_options(
    path: &str,
    value: &Buffer,
    _options: &ObjectEncodingOptions,
) -> NodeResult<()> {
    fs::write_file_sync(path, FsWriteData::Buffer(value), None)
}

pub fn append_file_string(path: &str, value: &str, encoding: &str) -> NodeResult<()> {
    fs::append_file_sync_string(path, value, encoding)
}

pub fn append_file_buffer(path: &str, value: &Buffer) -> NodeResult<()> {
    fs::append_file_sync_buffer(path, value)
}

pub fn append_file_string_with_options(
    path: &str,
    value: &str,
    options: &ObjectEncodingOptions,
) -> NodeResult<()> {
    fs::append_file_sync_string(path, value, options.encoding.as_deref().unwrap_or("utf8"))
}

pub fn append_file_buffer_with_options(
    path: &str,
    value: &Buffer,
    _options: &ObjectEncodingOptions,
) -> NodeResult<()> {
    fs::append_file_sync_buffer(path, value)
}

pub fn chmod(path: &str, mode: u32) -> NodeResult<()> {
    fs::chmod_sync(path, mode)
}

pub fn lchmod(path: &str, mode: u32) -> NodeResult<()> {
    fs::lchmod_sync(path, mode)
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

pub fn copy_file_with_mode(from: &str, to: &str, mode: i32) -> NodeResult<()> {
    fs::copy_file_sync_with_mode(from, to, mode)
}

pub fn cp(from: &str, to: &str, recursive: bool) -> NodeResult<()> {
    fs::cp_sync(from, to, recursive)
}

pub fn cp_with_options(from: &str, to: &str, options: &CopySyncOptions) -> NodeResult<()> {
    fs::cp_sync_with_options(from, to, options)
}

pub fn copy_with_options(from: &str, to: &str, options: &CopyOptions) -> NodeResult<()> {
    fs::copy_sync(from, to, options)
}

pub fn link(existing_path: &str, new_path: &str) -> NodeResult<()> {
    fs::link_sync(existing_path, new_path)
}

pub fn stat(path: &str) -> NodeResult<Stats> {
    fs::stat_sync(path)
}

pub fn stat_with_options(path: &str, options: StatOptions) -> NodeResult<Option<Stats>> {
    fs::stat_sync_with_options(path, options)
}

pub fn statfs(path: &str) -> NodeResult<StatFs> {
    fs::statfs_sync(path)
}

pub fn statfs_with_options(path: &str, options: StatFsOptions) -> NodeResult<StatFs> {
    fs::statfs_sync_with_options(path, options)
}

pub fn lstat(path: &str) -> NodeResult<Stats> {
    fs::lstat_sync(path)
}

pub fn lstat_with_options(path: &str, options: StatOptions) -> NodeResult<Option<Stats>> {
    fs::lstat_sync_with_options(path, options)
}

pub fn mkdir(path: &str, recursive: bool) -> NodeResult<()> {
    fs::mkdir_sync(path, recursive)
}

pub fn mkdir_with_options(path: &str, options: MakeDirectoryOptions) -> NodeResult<()> {
    fs::mkdir_sync_with_options(path, options)
}

pub fn mkdtemp(prefix: &str) -> NodeResult<String> {
    fs::mkdtemp_sync(prefix)
}

pub fn mkdtemp_disposable(prefix: &str) -> NodeResult<DisposableTempDir> {
    Ok(DisposableTempDir {
        path: mkdtemp(prefix)?,
        removed: false,
    })
}

pub fn rm(path: &str, recursive: bool, force: bool) -> NodeResult<()> {
    fs::rm_sync(path, recursive, force)
}

pub fn rm_with_options(path: &str, options: RmOptions) -> NodeResult<()> {
    fs::rm_sync_with_options(path, options)
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

pub fn realpath_native(path: &str) -> NodeResult<String> {
    fs::realpath_native(path)
}

pub fn realpath_sync_native(path: &str) -> NodeResult<String> {
    fs::realpath_sync_native(path)
}

pub fn readdir(path: &str) -> NodeResult<Vec<String>> {
    fs::readdir_sync(path)
}

pub fn opendir(path: &str) -> NodeResult<Vec<Dirent>> {
    fs::opendir_sync(path)
}

pub fn opendir_with_options(path: &str, _options: OpenDirOptions) -> NodeResult<Vec<Dirent>> {
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

pub fn opendir_handle_with_options(path: &str, options: OpenDirOptions) -> NodeResult<Dir> {
    Ok(Dir {
        path: path.to_string(),
        entries: opendir_with_options(path, options)?,
        index: 0,
        closed: false,
    })
}

pub fn open(path: &str, flags: &str) -> NodeResult<FileHandle> {
    Ok(FileHandle {
        fd: fs::open_sync(path, flags)?,
    })
}

pub fn open_with_options(path: &str, options: FlagAndOpenMode) -> NodeResult<FileHandle> {
    let handle = open(path, &options.flag)?;
    if options.mode != 0 {
        handle.chmod(options.mode)?;
    }
    Ok(handle)
}

pub fn close(fd: i32) -> NodeResult<()> {
    fs::close_sync(fd)
}

pub fn read(
    fd: i32,
    buffer: &mut Buffer,
    offset: usize,
    length: usize,
    position: Option<u64>,
) -> NodeResult<usize> {
    fs::read_sync(fd, buffer, offset, length, position)
}

pub fn read_with_options(fd: i32, buffer: Buffer, options: ReadOptions) -> NodeResult<ReadResult> {
    fs::read_sync_with_options(fd, buffer, options)
}

pub fn readv(fd: i32, buffers: &mut [Buffer], position: Option<u64>) -> NodeResult<usize> {
    fs::readv_sync(fd, buffers, position)
}

pub fn readv_result(
    fd: i32,
    buffers: &mut [Buffer],
    position: Option<u64>,
) -> NodeResult<ReadVResult> {
    fs::readv_sync_result(fd, buffers, position)
}

pub fn write_buffer(
    fd: i32,
    buffer: &Buffer,
    offset: usize,
    length: usize,
    position: Option<u64>,
) -> NodeResult<usize> {
    fs::write_sync_buffer(fd, buffer, offset, length, position)
}

pub fn write_buffer_with_options(
    fd: i32,
    buffer: &Buffer,
    options: WriteOptions,
) -> NodeResult<WriteResult> {
    fs::write_sync_buffer_with_options(fd, buffer, options)
}

pub fn write_string(
    fd: i32,
    value: &str,
    position: Option<u64>,
    encoding: &str,
) -> NodeResult<usize> {
    fs::write_sync_string(fd, value, position, encoding)
}

pub fn write_string_with_options(
    fd: i32,
    value: &str,
    options: WriteOptions,
) -> NodeResult<WriteResult> {
    fs::write_sync_string_with_options(fd, value, options)
}

pub fn writev(fd: i32, buffers: &[Buffer], position: Option<u64>) -> NodeResult<usize> {
    fs::writev_sync(fd, buffers, position)
}

pub fn writev_result(
    fd: i32,
    buffers: &[Buffer],
    position: Option<u64>,
) -> NodeResult<WriteVResult> {
    fs::writev_sync_result(fd, buffers, position)
}

pub fn fstat(fd: i32) -> NodeResult<Stats> {
    fs::fstat_sync(fd)
}

pub fn fstat_with_options(fd: i32, options: StatOptions) -> NodeResult<Stats> {
    fs::fstat_sync_with_options(fd, options)
}

pub fn fsync(fd: i32) -> NodeResult<()> {
    fs::fsync_sync(fd)
}

pub fn fdatasync(fd: i32) -> NodeResult<()> {
    fs::fdatasync_sync(fd)
}

pub fn ftruncate(fd: i32, len: u64) -> NodeResult<()> {
    fs::ftruncate_sync(fd, len)
}

pub fn fchmod(fd: i32, mode: u32) -> NodeResult<()> {
    fs::fchmod_sync(fd, mode)
}

pub fn fchown(fd: i32, uid: u32, gid: u32) -> NodeResult<()> {
    fs::fchown_sync(fd, uid, gid)
}

pub fn futimes(fd: i32, atime_seconds: f64, mtime_seconds: f64) -> NodeResult<()> {
    fs::futimes_sync(fd, atime_seconds, mtime_seconds)
}

pub fn glob(pattern: &str) -> NodeResult<Vec<String>> {
    fs::glob_sync(pattern)
}

pub fn watch(path: &str) -> NodeResult<FsWatcher> {
    fs::watch(path)
}

pub fn watch_with_options(path: &str, options: WatchOptions) -> NodeResult<FsWatcher> {
    fs::watch_with_options(path, options)
}

pub fn watch_file(path: &str) -> NodeResult<StatWatcher> {
    fs::watch_file(path)
}

pub fn watch_file_with_options(path: &str, options: WatchFileOptions) -> NodeResult<StatWatcher> {
    fs::watch_file_with_options(path, options)
}
