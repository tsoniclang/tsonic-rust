use tsonic_node::path;

#[test]
fn posix_path_string_operations() {
    assert_eq!(path::posix::normalize("/a//b/../c/"), "/a/c/");
    assert_eq!(path::posix::join(&["/a", "b", "..", "c"]), "/a/c");
    assert_eq!(path::posix::dirname("/a/b.txt"), "/a");
    assert_eq!(path::posix::basename("/a/b.txt", Some(".txt")), "b");
    assert_eq!(path::posix::extname("/a/b.txt"), ".txt");
    assert_eq!(path::posix::relative("/a/b", "/a/c/d"), "../c/d");
}

#[test]
fn win32_path_string_operations() {
    assert!(path::win32::is_absolute("C:\\a"));
    assert_eq!(path::win32::join(&["a", "b", "..", "c"]), "a\\c");
    assert_eq!(path::win32::basename("C:\\a\\b.txt", Some(".txt")), "b");
}

#[test]
fn parse_and_format_roundtrip_basic_path() {
    let parsed = path::posix::parse("/tmp/file.txt");
    assert_eq!(parsed.root, "/");
    assert_eq!(parsed.dir, "/tmp");
    assert_eq!(parsed.base, "file.txt");
    assert_eq!(parsed.ext, ".txt");
    assert_eq!(parsed.name, "file");
    assert_eq!(path::posix::format(&parsed), "/tmp/file.txt");
    assert_eq!(path::to_namespaced_path("/tmp/file.txt"), "/tmp/file.txt");
}
