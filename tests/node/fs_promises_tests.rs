use std::time::{SystemTime, UNIX_EPOCH};

use tsonic_node::fs_promises;

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
    assert_eq!(
        fs_promises::read_file_string(&file_text, "utf8").unwrap(),
        "hello world"
    );
    assert_eq!(fs_promises::stat(&file_text).unwrap().size, 11);
    assert_eq!(fs_promises::readdir(&root_text).unwrap(), vec!["a.txt"]);
    assert_eq!(fs_promises::opendir(&root_text).unwrap()[0].name, "a.txt");
    fs_promises::rm(&root_text, true, false).unwrap();
}
