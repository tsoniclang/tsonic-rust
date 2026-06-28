use std::time::{SystemTime, UNIX_EPOCH};

use tsonic_node::fs::{self, FsReadResult, FsWriteData};

#[test]
fn fs_sync_file_lifecycle() {
    let root = std::env::current_dir().unwrap().join(".temp").join(format!(
        "tsonic-rust-fs-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let root_text = root.to_string_lossy().to_string();
    fs::mkdir_sync(&root_text, true).unwrap();
    let file = root.join("a.txt");
    let file_text = file.to_string_lossy().to_string();
    fs::write_file_sync(&file_text, FsWriteData::String("hello"), Some("utf8")).unwrap();
    assert!(fs::exists_sync(&file_text));
    assert_eq!(fs::stat_sync(&file_text).unwrap().size, 5);
    assert!(!fs::stat_sync(&file_text).unwrap().is_symbolic_link());
    assert!(!fs::lstat_sync(&file_text).unwrap().is_symbolic_link());
    assert_eq!(
        fs::read_file_sync(&file_text, Some("utf8")).unwrap(),
        FsReadResult::String("hello".to_string())
    );
    let names = fs::readdir_sync(&root_text).unwrap();
    assert_eq!(names, vec!["a.txt"]);
    let copy = root.join("b.txt");
    let copy_text = copy.to_string_lossy().to_string();
    fs::copy_file_sync(&file_text, &copy_text).unwrap();
    fs::rename_sync(&copy_text, &root.join("c.txt").to_string_lossy()).unwrap();
    fs::unlink_sync(&file_text).unwrap();
    fs::rm_sync(&root_text, true, false).unwrap();
}

#[test]
fn fs_extended_sync_file_lifecycle() {
    let root = temp_root("extended");
    let root_text = root.to_string_lossy().to_string();
    fs::mkdir_sync(&root_text, true).unwrap();

    let file = root.join("fd.txt");
    let file_text = file.to_string_lossy().to_string();
    fs::write_file_sync_string(&file_text, "hello", "utf8").unwrap();
    fs::append_file_sync_string(&file_text, " world", "utf8").unwrap();
    assert_eq!(
        fs::read_file_sync_string(&file_text, "utf8").unwrap(),
        "hello world"
    );
    let constants = fs::constants();
    assert_eq!(constants.f_ok, 0);
    assert_ne!(constants.o_append, constants.o_rdonly);

    fs::access_sync(&file_text).unwrap();
    fs::chmod_sync(&file_text, 0o600).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let metadata = std::fs::metadata(&file_text).unwrap();
        let uid = metadata.uid();
        let gid = metadata.gid();
        fs::chown_sync(&file_text, uid, gid).unwrap();
    }
    let filesystem = fs::statfs_sync(&file_text).unwrap();
    assert!(filesystem.bsize > 0);
    assert!(filesystem.blocks > 0);
    let stats = fs::stat_sync(&file_text).unwrap();
    assert_eq!(stats.size, 11);
    assert!(stats.mode & 0o600 != 0);
    assert!(stats.nlink >= 1);
    assert!(stats.mtime_ms() > 0.0);
    assert!(stats.ctime_ms() > 0.0);

    let fd = fs::open_sync(&file_text, "r+").unwrap();
    assert_eq!(fs::fstat_sync(fd).unwrap().size, 11);
    fs::fchmod_sync(fd, 0o600).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let metadata = std::fs::metadata(&file_text).unwrap();
        let uid = metadata.uid();
        let gid = metadata.gid();
        fs::fchown_sync(fd, uid, gid).unwrap();
    }
    fs::futimes_sync(fd, 1_600_000_001.0, 1_600_000_002.0).unwrap();
    let mut buffer = tsonic_node::buffer::Buffer::alloc(5);
    assert_eq!(fs::read_sync(fd, &mut buffer, 0, 5, Some(6)).unwrap(), 5);
    assert_eq!(buffer.to_string(Some("utf8")).unwrap(), "world");
    assert_eq!(
        fs::write_sync_string(fd, "rust", Some(6), "utf8").unwrap(),
        4
    );
    fs::fsync_sync(fd).unwrap();
    fs::fdatasync_sync(fd).unwrap();
    fs::ftruncate_sync(fd, 10).unwrap();
    fs::close_sync(fd).unwrap();
    assert_eq!(
        fs::read_file_sync_string(&file_text, "utf8").unwrap(),
        "hello rust"
    );
    assert!(modified_seconds(&file) >= 1_600_000_002);
    fs::utimes_sync(&file_text, 1_600_000_003.0, 1_600_000_004.0).unwrap();
    assert!(modified_seconds(&file) >= 1_600_000_004);

    let buffer_file = root.join("buffer.txt");
    let buffer_file_text = buffer_file.to_string_lossy().to_string();
    fs::append_file_sync_buffer(
        &buffer_file_text,
        &tsonic_node::buffer::Buffer::from_string("abc", Some("utf8")).unwrap(),
    )
    .unwrap();
    let fd = fs::open_sync(&buffer_file_text, "r+").unwrap();
    let write_buffer = tsonic_node::buffer::Buffer::from_string("XYZ", Some("utf8")).unwrap();
    assert_eq!(
        fs::write_sync_buffer(fd, &write_buffer, 1, 2, Some(1)).unwrap(),
        2
    );
    fs::close_sync(fd).unwrap();
    assert_eq!(
        fs::read_file_sync_string(&buffer_file_text, "utf8").unwrap(),
        "aYZ"
    );

    fs::rm_sync(&root_text, true, false).unwrap();
}

#[test]
fn fs_extended_callback_matrix_uses_real_file_io() {
    let root = temp_root("callbacks");
    let root_text = root.to_string_lossy().to_string();
    fs::mkdir_sync(&root_text, true).unwrap();
    let file = root.join("callback.txt");
    let file_text = file.to_string_lossy().to_string();

    let mut write_result = None;
    fs::write_file_callback_string(&file_text, "hello", "utf8", |result| {
        write_result = Some(result);
    });
    write_result.unwrap().unwrap();

    let mut append_result = None;
    fs::append_file_callback_string(&file_text, " world", "utf8", |result| {
        append_result = Some(result);
    });
    append_result.unwrap().unwrap();

    let mut read_result = None;
    fs::read_file_callback_string(&file_text, "utf8", |result| {
        read_result = Some(result);
    });
    assert_eq!(read_result.unwrap().unwrap(), "hello world");

    let mut chmod_result = None;
    fs::chmod_callback(&file_text, 0o600, |result| {
        chmod_result = Some(result);
    });
    chmod_result.unwrap().unwrap();

    let mut stat_result = None;
    fs::stat_callback(&file_text, |result| {
        stat_result = Some(result);
    });
    assert_eq!(stat_result.unwrap().unwrap().size, 11);

    let mut statfs_result = None;
    fs::statfs_callback(&file_text, |result| {
        statfs_result = Some(result);
    });
    assert!(statfs_result.unwrap().unwrap().bsize > 0);

    let mut fd_result = None;
    fs::open_callback(&file_text, "r+", |result| {
        fd_result = Some(result);
    });
    let fd = fd_result.unwrap().unwrap();

    let mut fstat_result = None;
    fs::fstat_callback(fd, |result| {
        fstat_result = Some(result);
    });
    assert_eq!(fstat_result.unwrap().unwrap().size, 11);

    let mut buffer = tsonic_node::buffer::Buffer::alloc(5);
    let mut read_fd_result = None;
    fs::read_callback(fd, &mut buffer, 0, 5, Some(6), |result| {
        read_fd_result = Some(result);
    });
    assert_eq!(read_fd_result.unwrap().unwrap(), 5);
    assert_eq!(buffer.to_string(Some("utf8")).unwrap(), "world");

    let mut write_fd_result = None;
    fs::write_callback_string(fd, "rust", Some(6), "utf8", |result| {
        write_fd_result = Some(result);
    });
    assert_eq!(write_fd_result.unwrap().unwrap(), 4);

    let mut fsync_result = None;
    fs::fsync_callback(fd, |result| {
        fsync_result = Some(result);
    });
    fsync_result.unwrap().unwrap();

    let mut truncate_result = None;
    fs::ftruncate_callback(fd, 10, |result| {
        truncate_result = Some(result);
    });
    truncate_result.unwrap().unwrap();

    let mut close_result = None;
    fs::close_callback(fd, |result| {
        close_result = Some(result);
    });
    close_result.unwrap().unwrap();

    assert_eq!(
        fs::read_file_sync_string(&file_text, "utf8").unwrap(),
        "hello rust"
    );

    let copy = root.join("copy.txt");
    let copy_text = copy.to_string_lossy().to_string();
    let mut copy_result = None;
    fs::copy_file_callback(&file_text, &copy_text, |result| {
        copy_result = Some(result);
    });
    copy_result.unwrap().unwrap();

    let renamed = root.join("renamed.txt");
    let renamed_text = renamed.to_string_lossy().to_string();
    let mut rename_result = None;
    fs::rename_callback(&copy_text, &renamed_text, |result| {
        rename_result = Some(result);
    });
    rename_result.unwrap().unwrap();

    let mut realpath_result = None;
    fs::realpath_callback(&renamed_text, |result| {
        realpath_result = Some(result);
    });
    assert!(realpath_result.unwrap().unwrap().ends_with("renamed.txt"));

    let made_prefix = root.join("callback-tmp-");
    let mut mkdtemp_result = None;
    fs::mkdtemp_callback(&made_prefix.to_string_lossy(), |result| {
        mkdtemp_result = Some(result);
    });
    let made = mkdtemp_result.unwrap().unwrap();
    let mut rmdir_result = None;
    fs::rmdir_callback(&made, |result| {
        rmdir_result = Some(result);
    });
    rmdir_result.unwrap().unwrap();

    let mut unlink_result = None;
    fs::unlink_callback(&renamed_text, |result| {
        unlink_result = Some(result);
    });
    unlink_result.unwrap().unwrap();

    fs::rm_sync(&root_text, true, false).unwrap();
}

#[test]
fn fs_extended_sync_directory_lifecycle() {
    let root = temp_root("directory");
    let root_text = root.to_string_lossy().to_string();
    fs::mkdir_sync(&root_text, true).unwrap();

    let source = root.join("source");
    let source_text = source.to_string_lossy().to_string();
    fs::mkdir_sync(&source_text, false).unwrap();
    let nested = source.join("nested.txt");
    let nested_text = nested.to_string_lossy().to_string();
    fs::write_file_sync_string(&nested_text, "nested", "utf8").unwrap();

    let copied = root.join("copied");
    let copied_text = copied.to_string_lossy().to_string();
    fs::cp_sync(&source_text, &copied_text, true).unwrap();
    assert_eq!(
        fs::read_file_sync_string(&copied.join("nested.txt").to_string_lossy(), "utf8").unwrap(),
        "nested"
    );

    let entries = fs::opendir_sync(&copied_text).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "nested.txt");
    assert!(entries[0].is_file());

    let link = root.join("hardlink.txt");
    let link_text = link.to_string_lossy().to_string();
    fs::link_sync(&nested_text, &link_text).unwrap();
    assert_eq!(
        fs::read_file_sync_string(&link_text, "utf8").unwrap(),
        "nested"
    );
    assert!(fs::realpath_sync(&link_text)
        .unwrap()
        .ends_with("hardlink.txt"));

    let truncate = root.join("truncate.txt");
    let truncate_text = truncate.to_string_lossy().to_string();
    fs::write_file_sync_string(&truncate_text, "abcdef", "utf8").unwrap();
    fs::truncate_sync(&truncate_text, 3).unwrap();
    assert_eq!(
        fs::read_file_sync_string(&truncate_text, "utf8").unwrap(),
        "abc"
    );

    let made = fs::mkdtemp_sync(&root.join("tmp-").to_string_lossy()).unwrap();
    assert!(fs::stat_sync(&made).unwrap().is_directory());
    fs::rmdir_sync(&made).unwrap();

    #[cfg(unix)]
    {
        let symlink = root.join("symlink.txt");
        let symlink_text = symlink.to_string_lossy().to_string();
        fs::symlink_sync(&nested_text, &symlink_text).unwrap();
        fs::lutimes_sync(&symlink_text, 1_600_000_005.0, 1_600_000_006.0).unwrap();
        use std::os::unix::fs::MetadataExt;

        let metadata = std::fs::symlink_metadata(&symlink_text).unwrap();
        let uid = metadata.uid();
        let gid = metadata.gid();
        fs::lchown_sync(&symlink_text, uid, gid).unwrap();
        assert_eq!(fs::readlink_sync(&symlink_text).unwrap(), nested_text);
        assert!(fs::lstat_sync(&symlink_text).unwrap().is_symbolic_link());
    }

    fs::rm_sync(&root_text, true, false).unwrap();
}

#[test]
fn fs_glob_and_watchers_are_closed_polling_apis() {
    let root = temp_root("glob-watch");
    let root_text = root.to_string_lossy().to_string();
    fs::mkdir_sync(&root_text, true).unwrap();
    let alpha = root.join("alpha.txt");
    let beta = root.join("beta.log");
    fs::write_file_sync_string(&alpha.to_string_lossy(), "a", "utf8").unwrap();
    fs::write_file_sync_string(&beta.to_string_lossy(), "b", "utf8").unwrap();

    let matches = fs::glob_sync(&root.join("*.txt").to_string_lossy()).unwrap();
    assert_eq!(matches.len(), 1);
    assert!(matches[0].ends_with("alpha.txt"));

    let mut watcher = fs::watch(&alpha.to_string_lossy()).unwrap();
    assert_eq!(watcher.poll().unwrap(), None);
    fs::write_file_sync_string(&alpha.to_string_lossy(), "changed", "utf8").unwrap();
    let event = watcher.poll().unwrap().unwrap();
    assert_eq!(event.event_type, "change");
    assert_eq!(event.filename, "alpha.txt");

    let mut file_watcher = fs::watch_file(&root.join("new.txt").to_string_lossy()).unwrap();
    assert_eq!(file_watcher.poll().unwrap(), None);
    fs::write_file_sync_string(&root.join("new.txt").to_string_lossy(), "new", "utf8").unwrap();
    assert_eq!(file_watcher.poll().unwrap().unwrap().event_type, "rename");

    fs::rm_sync(&root_text, true, false).unwrap();
}

fn temp_root(label: &str) -> std::path::PathBuf {
    std::env::current_dir().unwrap().join(".temp").join(format!(
        "tsonic-rust-fs-{label}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn modified_seconds(path: &std::path::Path) -> u64 {
    std::fs::metadata(path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
