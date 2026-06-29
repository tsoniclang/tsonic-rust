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

