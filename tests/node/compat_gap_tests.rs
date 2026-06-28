use std::time::{SystemTime, UNIX_EPOCH};

use tsonic_node::{buffer, fs, path, process, punycode, stream};

#[test]
fn buffer_transcode_converts_between_supported_encodings() {
    let source = buffer::Buffer::from_string("hello", Some("utf8")).unwrap();
    let utf16 = buffer::transcode(&source, "utf8", "utf16le").unwrap();
    assert_eq!(utf16.len(), 10);
    assert_eq!(utf16.to_string(Some("utf16le")).unwrap(), "hello");
    let restored = buffer::transcode(&utf16, "utf16le", "utf8").unwrap();
    assert_eq!(restored.to_string(Some("utf8")).unwrap(), "hello");
}

#[test]
fn path_matches_glob_handles_common_star_and_question_patterns() {
    assert!(path::matches_glob("src/index.ts", "src/*.ts"));
    assert!(path::matches_glob("src/a.ts", "src/?.ts"));
    assert!(!path::matches_glob("src/long.ts", "src/?.ts"));
}

#[test]
fn fs_stream_and_callback_shapes_are_backed_by_real_file_io() {
    let root = std::env::current_dir().unwrap().join(".temp").join(format!(
        "tsonic-rust-compat-gap-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let root_text = root.to_string_lossy().to_string();
    fs::mkdir_sync(&root_text, true).unwrap();
    let file = root.join("stream.txt");
    let file_text = file.to_string_lossy().to_string();

    let mut write_result = None;
    fs::write_file_callback_string(&file_text, "hello", "utf8", |result| {
        write_result = Some(result)
    });
    write_result.unwrap().unwrap();

    let mut read_result = None;
    fs::read_file_callback_string(&file_text, "utf8", |result| read_result = Some(result));
    assert_eq!(read_result.unwrap().unwrap(), "hello");

    let mut readable = fs::create_read_stream(&file_text).unwrap();
    assert_eq!(
        stream::consumers::text(&mut readable, Some("utf8")).unwrap(),
        "hello"
    );
    let mut writable = fs::create_write_stream();
    assert!(writable.write(buffer::Buffer::from_string("x", Some("utf8")).unwrap()));
    assert_eq!(writable.chunks().len(), 1);

    fs::rm_sync(&root_text, true, false).unwrap();
}

#[test]
fn process_stdio_helpers_are_closed_stream_shapes() {
    let mut stdout = process::stdout();
    assert!(stdout.write(buffer::Buffer::from_string("line", Some("utf8")).unwrap()));
    assert_eq!(stdout.chunks().len(), 1);
    let stderr = process::stderr();
    assert!(stderr.chunks().is_empty());
    assert!(!process::stdin_is_tty());
}

#[test]
fn punycode_to_ascii_and_unicode_use_known_vectors() {
    assert_eq!(punycode::to_ascii("mañana.com"), "xn--maana-pta.com");
    assert_eq!(
        punycode::to_ascii("bücher.example"),
        "xn--bcher-kva.example"
    );
    assert_eq!(punycode::to_unicode("xn--maana-pta.com"), "mañana.com");
    assert_eq!(punycode::to_unicode("plain.example"), "plain.example");
}
