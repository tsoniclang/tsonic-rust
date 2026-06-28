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
