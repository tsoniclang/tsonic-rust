use tsonic_js::value::JsValue;
use tsonic_node::buffer::Buffer;
use tsonic_node::sqlite::{DatabaseSync, SqlValue};

#[test]
fn zlib_gzip_and_deflate_round_trip_buffers() {
    let input = Buffer::from_string("framework ready compression", Some("utf8")).unwrap();

    let gzip = tsonic_node::zlib::gzip_sync(&input).unwrap();
    let gunzip = tsonic_node::zlib::gunzip_sync(&gzip).unwrap();
    assert_eq!(
        gunzip.to_string(Some("utf8")).unwrap(),
        "framework ready compression"
    );

    let deflate = tsonic_node::zlib::deflate_sync(&input).unwrap();
    let inflate = tsonic_node::zlib::inflate_sync(&deflate).unwrap();
    assert_eq!(
        inflate.to_string(Some("utf8")).unwrap(),
        "framework ready compression"
    );

    let raw = tsonic_node::zlib::deflate_raw_sync(&input).unwrap();
    let raw_inflate = tsonic_node::zlib::inflate_raw_sync(&raw).unwrap();
    assert_eq!(
        raw_inflate.to_string(Some("utf8")).unwrap(),
        "framework ready compression"
    );

    let unzip_gzip = tsonic_node::zlib::unzip_sync(&gzip).unwrap();
    assert_eq!(
        unzip_gzip.to_string(Some("utf8")).unwrap(),
        "framework ready compression"
    );
}

#[test]
fn zlib_string_helpers_use_buffer_encodings() {
    let compressed = tsonic_node::zlib::gzip_string_sync("mañana", "utf8").unwrap();
    assert_eq!(
        tsonic_node::zlib::gunzip_string_sync(&compressed, "utf8").unwrap(),
        "mañana"
    );
}

#[test]
fn zlib_brotli_round_trips_buffers() {
    let input = Buffer::from_string("brotli payload", Some("utf8")).unwrap();
    let compressed = tsonic_node::zlib::brotli_compress_sync(&input).unwrap();
    let decompressed = tsonic_node::zlib::brotli_decompress_sync(&compressed).unwrap();
    assert_eq!(
        decompressed.to_string(Some("utf8")).unwrap(),
        "brotli payload"
    );
}

#[test]
fn zlib_options_constants_and_class_carriers_are_closed_shapes() {
    let input = Buffer::from_string("class payload", Some("utf8")).unwrap();
    let options = tsonic_node::zlib::ZlibOptions {
        level: tsonic_node::zlib::constants::Z_BEST_SPEED,
        max_output_length: Some(1024),
        ..tsonic_node::zlib::ZlibOptions::default()
    };
    let compressed = tsonic_node::zlib::gzip_sync_with_options(&input, &options).unwrap();
    assert_eq!(
        tsonic_node::zlib::gunzip_sync(&compressed)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "class payload"
    );
    assert_eq!(tsonic_node::zlib::constants::GZIP, 3);
    assert_eq!(tsonic_node::zlib::constants::BROTLI_MODE_TEXT, 1);
    assert_eq!(tsonic_node::zlib::constants::ZSTD_CLEVEL_DEFAULT, 3);

    let mut gzip = tsonic_node::zlib::create_gzip(Some(options));
    let output = gzip.process(&input).unwrap();
    assert_eq!(gzip.bytes_written(), input.len());
    assert!(!gzip.closed());
    gzip.params(
        tsonic_node::zlib::constants::Z_BEST_COMPRESSION,
        tsonic_node::zlib::constants::Z_DEFAULT_STRATEGY,
        || {},
    );
    let flushed = std::cell::Cell::new(false);
    gzip.flush(Some(|| flushed.set(true)));
    assert!(flushed.get());
    gzip.reset();
    assert_eq!(gzip.bytes_written(), 0);
    let closed = std::cell::Cell::new(false);
    gzip.close(Some(|| closed.set(true)));
    assert!(closed.get());
    assert!(gzip.closed());

    let mut gunzip = tsonic_node::zlib::create_gunzip(None);
    assert_eq!(
        gunzip
            .process(&output)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "class payload"
    );

    let mut brotli = tsonic_node::zlib::create_brotli_compress(Some(Default::default()));
    let brotli_output = brotli.process(&input).unwrap();
    let mut brotli_decode = tsonic_node::zlib::create_brotli_decompress(Some(Default::default()));
    assert_eq!(
        brotli_decode
            .process(&brotli_output)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "class payload"
    );

    assert!(tsonic_node::zlib::zstd_compress_sync(&input).is_err());
    let mut zstd = tsonic_node::zlib::create_zstd_compress(Some(Default::default()));
    assert!(zstd.process(&input).is_err());
}

#[test]
fn sqlite_database_sync_exec_run_get_and_all() {
    let database = DatabaseSync::open(":memory:").unwrap();
    database
        .exec("create table users (id integer primary key, name text, score real, data blob)")
        .unwrap();

    let result = database
        .run(
            "insert into users (name, score, data) values (?1, ?2, ?3)",
            &[
                SqlValue::Text("ada".to_string()),
                SqlValue::Real(42.5),
                SqlValue::Blob(vec![1, 2, 3]),
            ],
        )
        .unwrap();
    assert_eq!(result.changes, 1);
    assert_eq!(result.last_insert_rowid, 1);

    let row = database
        .get(
            "select id, name, score, data from users where name = ?1",
            &[SqlValue::Text("ada".to_string())],
        )
        .unwrap()
        .unwrap();
    assert_eq!(row.get("id"), Some(&JsValue::Number(1.0)));
    assert_eq!(row.get("name"), Some(&JsValue::String("ada".to_string())));
    assert_eq!(row.get("score"), Some(&JsValue::Number(42.5)));

    let rows = database.all("select name from users", &[]).unwrap();
    assert_eq!(rows.len(), 1);
}
