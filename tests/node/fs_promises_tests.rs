use std::time::{SystemTime, UNIX_EPOCH};

use tsonic_node::{
    buffer::Buffer,
    fs_promises::{self, FsReadResult},
};

#[test]
fn fs_promises_exposes_blocking_now_variants_with_node_shapes() {
    let root = std::env::current_dir().unwrap().join(".temp").join(format!(
        "tsonic-rust-fs-promises-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let root_text = root.to_string_lossy().to_string();
    fs_promises::mkdir(&root_text, true).unwrap();
    let file = root.join("a.txt");
    let file_text = file.to_string_lossy().to_string();

    fs_promises::write_file_string(&file_text, "hello", "utf8").unwrap();
    fs_promises::write_file_string_with_options(
        &file_text,
        "hello",
        &fs_promises::ObjectEncodingOptions::string("utf8"),
    )
    .unwrap();
    fs_promises::append_file_string(&file_text, " world", "utf8").unwrap();
    fs_promises::append_file_string_with_options(
        &file_text,
        "",
        &fs_promises::ObjectEncodingOptions::string("utf8"),
    )
    .unwrap();
    fs_promises::append_file_buffer(&file_text, &Buffer::from_string("!", Some("utf8")).unwrap())
        .unwrap();
    fs_promises::append_file_buffer_with_options(
        &file_text,
        &Buffer::from_string("", Some("utf8")).unwrap(),
        &fs_promises::ObjectEncodingOptions::buffer(),
    )
    .unwrap();
    assert_eq!(
        fs_promises::read_file_string(&file_text, "utf8").unwrap(),
        "hello world!"
    );
    assert_eq!(
        fs_promises::read_file_with_options(
            &file_text,
            &fs_promises::ObjectEncodingOptions::string("utf8")
        )
        .unwrap(),
        FsReadResult::String("hello world!".to_string())
    );
    assert_eq!(
        fs_promises::read_file_with_options(
            &file_text,
            &fs_promises::ObjectEncodingOptions::buffer()
        )
        .unwrap(),
        FsReadResult::Buffer(Buffer::from_string("hello world!", Some("utf8")).unwrap())
    );
    assert_eq!(fs_promises::stat(&file_text).unwrap().size, 12);
    assert!(fs_promises::stat_with_options(
        &root.join("missing.txt").to_string_lossy(),
        fs_promises::StatOptions {
            throw_if_no_entry: false,
            ..fs_promises::StatOptions::default()
        },
    )
    .unwrap()
    .is_none());
    fs_promises::access(&file_text).unwrap();
    assert!(fs_promises::exists(&file_text).unwrap());
    fs_promises::chmod(&file_text, 0o600).unwrap();
    fs_promises::lchmod(&file_text, 0o600).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let metadata = std::fs::metadata(&file_text).unwrap();
        let uid = metadata.uid();
        let gid = metadata.gid();
        fs_promises::chown(&file_text, uid, gid).unwrap();
    }
    fs_promises::utimes(&file_text, 1_600_000_011.0, 1_600_000_012.0).unwrap();
    assert!(
        std::fs::metadata(&file_text)
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            >= 1_600_000_012
    );

    let copy = root.join("copy.txt");
    let copy_text = copy.to_string_lossy().to_string();
    fs_promises::copy_file(&file_text, &copy_text).unwrap();
    let copy_with_mode = root.join("copy-mode.txt");
    let copy_with_mode_text = copy_with_mode.to_string_lossy().to_string();
    fs_promises::copy_file_with_mode(&file_text, &copy_with_mode_text, 0).unwrap();
    assert_eq!(
        fs_promises::read_file_string(&copy_with_mode_text, "utf8").unwrap(),
        "hello world!"
    );
    fs_promises::unlink(&copy_with_mode_text).unwrap();
    let renamed = root.join("renamed.txt");
    let renamed_text = renamed.to_string_lossy().to_string();
    fs_promises::rename(&copy_text, &renamed_text).unwrap();
    assert_eq!(
        fs_promises::read_file_string(&renamed_text, "utf8").unwrap(),
        "hello world!"
    );
    fs_promises::unlink(&renamed_text).unwrap();

    let link = root.join("hardlink.txt");
    let link_text = link.to_string_lossy().to_string();
    fs_promises::link(&file_text, &link_text).unwrap();
    assert_eq!(
        fs_promises::read_file_string(&link_text, "utf8").unwrap(),
        "hello world!"
    );
    assert!(fs_promises::realpath(&link_text)
        .unwrap()
        .ends_with("hardlink.txt"));
    assert!(fs_promises::realpath_native(&link_text)
        .unwrap()
        .ends_with("hardlink.txt"));
    assert!(fs_promises::realpath_sync_native(&link_text)
        .unwrap()
        .ends_with("hardlink.txt"));
    fs_promises::unlink(&link_text).unwrap();

    assert_eq!(fs_promises::readdir(&root_text).unwrap(), vec!["a.txt"]);
    assert_eq!(fs_promises::opendir(&root_text).unwrap()[0].name, "a.txt");
    assert!(
        fs_promises::opendir_with_options(&root_text, fs_promises::OpenDirOptions::default())
            .unwrap()
            .iter()
            .any(|entry| entry.name == "a.txt")
    );
    let statfs = fs_promises::statfs(&file_text).unwrap();
    assert!(statfs.bsize > 0);
    assert!(
        fs_promises::statfs_with_options(&file_text, fs_promises::StatFsOptions { bigint: false })
            .unwrap()
            .bsize
            > 0
    );

    let handle = fs_promises::open(&file_text, "r+").unwrap();
    assert!(handle.fd() >= 0);
    assert_eq!(handle.stat().unwrap().size, 12);
    assert_eq!(
        handle
            .stat_with_options(fs_promises::StatOptions::default())
            .unwrap()
            .size,
        12
    );
    handle.chmod(0o600).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let metadata = std::fs::metadata(&file_text).unwrap();
        let uid = metadata.uid();
        let gid = metadata.gid();
        handle.chown(uid, gid).unwrap();
    }
    handle.utimes(1_600_000_013.0, 1_600_000_014.0).unwrap();
    let mut buffer = Buffer::alloc(5);
    assert_eq!(handle.read(&mut buffer, 0, 5, Some(6)).unwrap(), 5);
    assert_eq!(buffer.to_string(Some("utf8")).unwrap(), "world");
    let read_result = handle
        .read_with_options(
            Buffer::alloc(5),
            fs_promises::ReadOptions {
                offset: 0,
                length: 5,
                position: Some(0),
            },
        )
        .unwrap();
    assert_eq!(read_result.bytes_read, 5);
    assert_eq!(read_result.buffer.to_string(Some("utf8")).unwrap(), "hello");
    handle.write_string("rust", Some(6), "utf8").unwrap();
    assert_eq!(handle.read_file_string("utf8").unwrap(), "hello rustd!");
    let mut vector_buffers = [Buffer::alloc(5), Buffer::alloc(1)];
    assert_eq!(handle.readv(&mut vector_buffers, Some(0)).unwrap(), 6);
    assert_eq!(vector_buffers[0].to_string(Some("utf8")).unwrap(), "hello");
    assert_eq!(vector_buffers[1].to_string(Some("utf8")).unwrap(), " ");
    let mut vector_result_buffers = [Buffer::alloc(5), Buffer::alloc(1)];
    let vector_result = handle
        .readv_result(&mut vector_result_buffers, Some(0))
        .unwrap();
    assert_eq!(vector_result.bytes_read, 6);
    assert_eq!(
        vector_result.buffers[0].to_string(Some("utf8")).unwrap(),
        "hello"
    );
    assert_eq!(
        handle
            .writev(
                &[
                    Buffer::from_string("r", Some("utf8")).unwrap(),
                    Buffer::from_string("u", Some("utf8")).unwrap(),
                ],
                Some(6),
            )
            .unwrap(),
        2
    );
    let writev_result = handle
        .writev_result(
            &[
                Buffer::from_string("s", Some("utf8")).unwrap(),
                Buffer::from_string("t", Some("utf8")).unwrap(),
            ],
            Some(6),
        )
        .unwrap();
    assert_eq!(writev_result.bytes_written, 2);
    let written = handle
        .write_buffer(
            &Buffer::from_string("!!", Some("utf8")).unwrap(),
            0,
            2,
            Some(10),
        )
        .unwrap();
    assert_eq!(written, 2);
    assert_eq!(handle.read_file_string("utf8").unwrap(), "hello stst!!");
    let write_result = handle
        .write_buffer_with_options(
            &Buffer::from_string("ru", Some("utf8")).unwrap(),
            fs_promises::WriteOptions::buffer(0, 2, Some(6)),
        )
        .unwrap();
    assert_eq!(write_result.bytes_written, 2);
    let string_write_result = handle
        .write_string_with_options("st", fs_promises::WriteOptions::string(Some(8), "utf8"))
        .unwrap();
    assert_eq!(string_write_result.bytes_written, 2);
    assert_eq!(handle.read_file_string("utf8").unwrap(), "hello rust!!");
    handle.append_file_string("?", "utf8").unwrap();
    handle
        .append_file_buffer(&Buffer::from_string("#", Some("utf8")).unwrap())
        .unwrap();
    assert_eq!(handle.read_file_buffer().unwrap().len(), 14);
    let readable_web = handle.readable_web_stream().unwrap();
    assert_eq!(readable_web.chunks().len(), 1);
    let readable_web_with_options = handle
        .readable_web_stream_with_options(fs_promises::ReadableWebStreamOptions::default())
        .unwrap();
    assert_eq!(readable_web_with_options.chunks().len(), 1);
    assert!(!handle.writable_web_stream().closed());
    let mut read_stream = handle.create_read_stream().unwrap();
    assert!(!read_stream.read().unwrap().is_empty());
    let mut ranged_stream = handle
        .create_read_stream_with_options(fs_promises::ReadStreamOptions {
            stream: fs_promises::FsStreamOptions {
                start: Some(0),
                end: Some(4),
                ..fs_promises::FsStreamOptions::default()
            },
        })
        .unwrap();
    assert_eq!(
        ranged_stream
            .read()
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "hello"
    );
    let mut write_stream = handle.create_write_stream();
    assert!(write_stream.write(Buffer::from_string("stream", Some("utf8")).unwrap()));
    assert_eq!(write_stream.chunks().len(), 1);
    let write_stream_with_options = handle
        .create_write_stream_with_options(fs_promises::WriteStreamOptions::default())
        .unwrap();
    assert!(!write_stream_with_options.closed());
    assert_eq!(
        handle.read_lines("utf8").unwrap(),
        vec!["hello rust!!?#".to_string()]
    );
    assert_eq!(
        handle
            .read_lines_with_options(fs_promises::ReadStreamOptions {
                stream: fs_promises::FsStreamOptions {
                    encoding: Some("utf8".to_string()),
                    ..fs_promises::FsStreamOptions::default()
                },
            })
            .unwrap(),
        vec!["hello rust!!?#".to_string()]
    );
    let pulled = handle.pull(4).unwrap().to_vec();
    assert!(pulled.len() >= 3);
    let pulled_with_options = handle
        .pull_with_options(fs_promises::PullOptions {
            start: Some(6),
            chunk_size: 2,
            limit: Some(4),
            ..fs_promises::PullOptions::default()
        })
        .unwrap()
        .to_vec();
    assert_eq!(pulled_with_options.len(), 2);
    let mut writer = handle.writer();
    writer.seek(10);
    assert_eq!(writer.write_string("?#", "utf8").unwrap(), 2);
    assert_eq!(writer.position(), Some(12));
    let mut writer_with_options = handle.writer_with_options(fs_promises::WriterOptions {
        start: Some(10),
        ..fs_promises::WriterOptions::default()
    });
    assert_eq!(writer_with_options.position(), Some(10));
    assert_eq!(
        writer_with_options
            .write_buffer(&Buffer::from_string("?#", Some("utf8")).unwrap())
            .unwrap(),
        2
    );
    handle.sync().unwrap();
    handle.datasync().unwrap();
    handle.truncate(10).unwrap();
    assert_eq!(fs_promises::fstat(handle.fd()).unwrap().size, 10);
    assert_eq!(
        fs_promises::fstat_with_options(handle.fd(), fs_promises::StatOptions::default())
            .unwrap()
            .size,
        10
    );
    fs_promises::fsync(handle.fd()).unwrap();
    fs_promises::fdatasync(handle.fd()).unwrap();
    fs_promises::ftruncate(handle.fd(), 10).unwrap();
    fs_promises::fchmod(handle.fd(), 0o600).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let metadata = std::fs::metadata(&file_text).unwrap();
        fs_promises::fchown(handle.fd(), metadata.uid(), metadata.gid()).unwrap();
    }
    fs_promises::futimes(handle.fd(), 1_600_000_015.0, 1_600_000_016.0).unwrap();
    handle.close().unwrap();
    assert_eq!(
        fs_promises::read_file_string(&file_text, "utf8").unwrap(),
        "hello rust"
    );

    let direct_fd = fs_promises::open(&file_text, "r+").unwrap().fd();
    let mut direct_read_buffer = Buffer::alloc(5);
    assert_eq!(
        fs_promises::read(direct_fd, &mut direct_read_buffer, 0, 5, Some(0)).unwrap(),
        5
    );
    assert_eq!(direct_read_buffer.to_string(Some("utf8")).unwrap(), "hello");
    let direct_read_result = fs_promises::read_with_options(
        direct_fd,
        Buffer::alloc(5),
        fs_promises::ReadOptions {
            offset: 0,
            length: 5,
            position: Some(0),
        },
    )
    .unwrap();
    assert_eq!(direct_read_result.bytes_read, 5);
    assert_eq!(
        direct_read_result.buffer.to_string(Some("utf8")).unwrap(),
        "hello"
    );
    assert_eq!(
        fs_promises::write_string(direct_fd, "ABCDE", Some(0), "utf8").unwrap(),
        5
    );
    assert_eq!(
        fs_promises::write_string_with_options(
            direct_fd,
            "hi",
            fs_promises::WriteOptions::string(Some(0), "utf8")
        )
        .unwrap()
        .bytes_written,
        2
    );
    let direct_buffer = Buffer::from_string("!!", Some("utf8")).unwrap();
    assert_eq!(
        fs_promises::write_buffer(direct_fd, &direct_buffer, 0, 2, Some(2)).unwrap(),
        2
    );
    assert_eq!(
        fs_promises::write_buffer_with_options(
            direct_fd,
            &direct_buffer,
            fs_promises::WriteOptions::buffer(0, 1, Some(4))
        )
        .unwrap()
        .bytes_written,
        1
    );
    let mut direct_readv_buffers = [Buffer::alloc(2), Buffer::alloc(3)];
    assert_eq!(
        fs_promises::readv(direct_fd, &mut direct_readv_buffers, Some(0)).unwrap(),
        5
    );
    let mut direct_readv_result_buffers = [Buffer::alloc(2), Buffer::alloc(3)];
    assert_eq!(
        fs_promises::readv_result(direct_fd, &mut direct_readv_result_buffers, Some(0))
            .unwrap()
            .bytes_read,
        5
    );
    assert_eq!(
        fs_promises::writev(
            direct_fd,
            &[
                Buffer::from_string("O", Some("utf8")).unwrap(),
                Buffer::from_string("K", Some("utf8")).unwrap(),
            ],
            Some(0)
        )
        .unwrap(),
        2
    );
    assert_eq!(
        fs_promises::writev_result(
            direct_fd,
            &[
                Buffer::from_string("1", Some("utf8")).unwrap(),
                Buffer::from_string("2", Some("utf8")).unwrap(),
            ],
            Some(2)
        )
        .unwrap()
        .bytes_written,
        2
    );
    fs_promises::close(direct_fd).unwrap();
    fs_promises::write_file_string(&file_text, "hello rust", "utf8").unwrap();
    fs_promises::truncate(&file_text, 5).unwrap();
    assert_eq!(
        fs_promises::read_file_string(&file_text, "utf8").unwrap(),
        "hello"
    );

    let nested = root.join("nested");
    let nested_text = nested.to_string_lossy().to_string();
    fs_promises::mkdir_with_options(
        &nested_text,
        fs_promises::MakeDirectoryOptions {
            recursive: false,
            mode: 0o755,
        },
    )
    .unwrap();
    let nested_file = nested.join("n.txt");
    fs_promises::write_file_string(&nested_file.to_string_lossy(), "n", "utf8").unwrap();
    let mut dir = fs_promises::opendir_handle_with_options(
        &nested_text,
        fs_promises::OpenDirOptions::default(),
    )
    .unwrap();
    assert_eq!(dir.path(), nested_text);
    let first = dir.read().unwrap().unwrap();
    assert_eq!(first.name, "n.txt");
    assert!(dir.read().unwrap().is_none());
    assert_eq!(dir.entries().len(), 1);
    dir.close();
    assert!(dir.closed());
    assert!(dir.read().is_err());
    let copied_dir = root.join("copied");
    fs_promises::cp_with_options(
        &nested_text,
        &copied_dir.to_string_lossy(),
        &fs_promises::CopySyncOptions {
            base: fs_promises::CopyOptionsBase {
                recursive: true,
                ..fs_promises::CopyOptionsBase::default()
            },
            filter: Some(fs_promises::CopyFilter::AcceptAll),
        },
    )
    .unwrap();
    assert!(
        fs_promises::stat(&copied_dir.join("n.txt").to_string_lossy())
            .unwrap()
            .is_file()
    );
    let copied_dir_two = root.join("copied2");
    fs_promises::copy_with_options(
        &nested_text,
        &copied_dir_two.to_string_lossy(),
        &fs_promises::CopyOptions {
            base: fs_promises::CopyOptionsBase {
                recursive: true,
                ..fs_promises::CopyOptionsBase::default()
            },
            filter: Some(fs_promises::CopyFilter::AcceptAll),
        },
    )
    .unwrap();
    assert!(
        fs_promises::stat(&copied_dir_two.join("n.txt").to_string_lossy())
            .unwrap()
            .is_file()
    );
    assert!(fs_promises::lstat(&file_text).unwrap().is_file());
    assert!(
        fs_promises::lstat_with_options(&file_text, fs_promises::StatOptions::default())
            .unwrap()
            .unwrap()
            .is_file()
    );

    let made = fs_promises::mkdtemp(&root.join("tmp-").to_string_lossy()).unwrap();
    assert!(fs_promises::stat(&made).unwrap().is_directory());
    fs_promises::rmdir(&made).unwrap();
    let mut disposable =
        fs_promises::mkdtemp_disposable(&root.join("disposable-").to_string_lossy()).unwrap();
    assert!(fs_promises::stat(&disposable.path).unwrap().is_directory());
    disposable.remove().unwrap();
    assert!(disposable.removed());
    assert!(fs_promises::stat_with_options(
        &disposable.path,
        fs_promises::StatOptions {
            throw_if_no_entry: false,
            ..fs_promises::StatOptions::default()
        },
    )
    .unwrap()
    .is_none());

    let glob_pattern = root.join("*.txt").to_string_lossy().to_string();
    assert!(fs_promises::glob(&glob_pattern)
        .unwrap()
        .iter()
        .any(|path| path.ends_with("a.txt")));
    let mut watcher = fs_promises::watch_with_options(
        &file_text,
        fs_promises::WatchOptions {
            persistent: false,
            ..fs_promises::WatchOptions::default()
        },
    )
    .unwrap();
    assert!(!watcher.has_ref());
    watcher.close();
    assert!(watcher.closed());
    let mut stat_watcher =
        fs_promises::watch_file_with_options(&file_text, fs_promises::WatchFileOptions::default())
            .unwrap();
    assert!(stat_watcher.has_ref());
    stat_watcher.close();
    let file_change = fs_promises::FileChangeInfo {
        event_type: "change".to_string(),
        filename: Some("a.txt".to_string()),
    };
    assert_eq!(file_change.filename.as_deref(), Some("a.txt"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let symlink = root.join("symlink.txt");
        let symlink_text = symlink.to_string_lossy().to_string();
        fs_promises::symlink(&file_text, &symlink_text).unwrap();
        assert_eq!(fs_promises::readlink(&symlink_text).unwrap(), file_text);
        let metadata = std::fs::symlink_metadata(&symlink_text).unwrap();
        fs_promises::lchown(&symlink_text, metadata.uid(), metadata.gid()).unwrap();
    }

    fs_promises::rm(&root_text, true, false).unwrap();
}
