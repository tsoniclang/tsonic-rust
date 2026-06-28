use std::time::{SystemTime, UNIX_EPOCH};

use tsonic_node::{buffer::Buffer, fs_promises};

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
    fs_promises::append_file_string(&file_text, " world", "utf8").unwrap();
    fs_promises::append_file_buffer(&file_text, &Buffer::from_string("!", Some("utf8")).unwrap())
        .unwrap();
    assert_eq!(
        fs_promises::read_file_string(&file_text, "utf8").unwrap(),
        "hello world!"
    );
    assert_eq!(fs_promises::stat(&file_text).unwrap().size, 12);
    fs_promises::access(&file_text).unwrap();
    fs_promises::chmod(&file_text, 0o600).unwrap();
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
    fs_promises::unlink(&link_text).unwrap();

    assert_eq!(fs_promises::readdir(&root_text).unwrap(), vec!["a.txt"]);
    assert_eq!(fs_promises::opendir(&root_text).unwrap()[0].name, "a.txt");
    let statfs = fs_promises::statfs(&file_text).unwrap();
    assert!(statfs.bsize > 0);

    let handle = fs_promises::open(&file_text, "r+").unwrap();
    assert_eq!(handle.stat().unwrap().size, 12);
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
    handle.write_string("rust", Some(6), "utf8").unwrap();
    handle.sync().unwrap();
    handle.datasync().unwrap();
    handle.truncate(10).unwrap();
    handle.close().unwrap();
    assert_eq!(
        fs_promises::read_file_string(&file_text, "utf8").unwrap(),
        "hello rust"
    );
    fs_promises::truncate(&file_text, 5).unwrap();
    assert_eq!(
        fs_promises::read_file_string(&file_text, "utf8").unwrap(),
        "hello"
    );

    let nested = root.join("nested");
    let nested_text = nested.to_string_lossy().to_string();
    fs_promises::mkdir(&nested_text, false).unwrap();
    let nested_file = nested.join("n.txt");
    fs_promises::write_file_string(&nested_file.to_string_lossy(), "n", "utf8").unwrap();
    let copied_dir = root.join("copied");
    fs_promises::cp(&nested_text, &copied_dir.to_string_lossy(), true).unwrap();
    assert!(
        fs_promises::stat(&copied_dir.join("n.txt").to_string_lossy())
            .unwrap()
            .is_file()
    );
    assert!(fs_promises::lstat(&file_text).unwrap().is_file());

    let made = fs_promises::mkdtemp(&root.join("tmp-").to_string_lossy()).unwrap();
    assert!(fs_promises::stat(&made).unwrap().is_directory());
    fs_promises::rmdir(&made).unwrap();

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
