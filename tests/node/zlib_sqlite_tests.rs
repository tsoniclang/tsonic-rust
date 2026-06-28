use tsonic_js::value::JsValue;
use tsonic_node::buffer::Buffer;
use tsonic_node::sqlite::{
    constants as sqlite_constants, ApplyChangesetOptions, CreateSessionOptions, DatabaseLimits,
    DatabaseSync, DatabaseSyncOptions, PrepareOptions, SqlValue,
};

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
    let tuned_deflate = tsonic_node::zlib::deflate_sync_with_options(
        &input,
        &tsonic_node::zlib::ZlibOptions {
            level: tsonic_node::zlib::constants::Z_BEST_SPEED,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        tsonic_node::zlib::inflate_sync(&tuned_deflate)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
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
    let known_constants = [
        tsonic_node::zlib::constants::BROTLI_DECODER_NO_ERROR,
        tsonic_node::zlib::constants::BROTLI_DECODER_RESULT_SUCCESS,
        tsonic_node::zlib::constants::BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS,
        tsonic_node::zlib::constants::BROTLI_PARAM_SIZE_HINT,
        tsonic_node::zlib::constants::Z_DEFAULT_LEVEL,
        tsonic_node::zlib::constants::ZLIB_VERNUM,
        tsonic_node::zlib::constants::ZSTD_c_compressionLevel,
        tsonic_node::zlib::constants::ZSTD_c_nbWorkers,
        tsonic_node::zlib::constants::ZSTD_d_windowLogMax,
        tsonic_node::zlib::constants::ZSTD_e_flush,
        tsonic_node::zlib::constants::ZSTD_error_no_error,
        tsonic_node::zlib::constants::ZSTD_error_srcSize_wrong,
        tsonic_node::zlib::constants::ZSTD_fast,
        tsonic_node::zlib::constants::ZSTD_btultra2,
    ];
    assert!(known_constants.iter().any(|value| *value > 0));
    let brotli_options = tsonic_node::zlib::BrotliOptions {
        flush: Some(tsonic_node::zlib::constants::BROTLI_OPERATION_FLUSH),
        finish_flush: Some(tsonic_node::zlib::constants::BROTLI_OPERATION_FINISH),
        chunk_size: 4096,
        max_output_length: Some(4096),
        info: true,
        ..Default::default()
    };
    assert_eq!(brotli_options.chunk_size, 4096);
    let zstd_options = tsonic_node::zlib::ZstdOptions {
        flush: Some(tsonic_node::zlib::constants::ZSTD_e_flush),
        finish_flush: Some(tsonic_node::zlib::constants::ZSTD_e_end),
        chunk_size: 1024,
        max_output_length: Some(1024),
        dictionary: Some(Buffer::from_bytes(vec![1, 2, 3])),
        info: true,
        ..Default::default()
    };
    assert_eq!(zstd_options.dictionary.unwrap().len(), 3);

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

    let mut deflate = tsonic_node::zlib::create_deflate(None);
    let deflated = deflate.process(&input).unwrap();
    let mut inflate = tsonic_node::zlib::create_inflate(None);
    assert_eq!(
        inflate
            .process(&deflated)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "class payload"
    );

    let mut deflate_raw = tsonic_node::zlib::create_deflate_raw(None);
    let raw = deflate_raw.process(&input).unwrap();
    let mut inflate_raw = tsonic_node::zlib::create_inflate_raw(None);
    assert_eq!(
        inflate_raw
            .process(&raw)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "class payload"
    );

    let mut gunzip = tsonic_node::zlib::create_gunzip(None);
    assert_eq!(
        gunzip
            .process(&output)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "class payload"
    );
    let mut unzip = tsonic_node::zlib::create_unzip(None);
    assert_eq!(
        unzip
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
    assert!(tsonic_node::zlib::zstd_decompress_sync(&input).is_err());
    let mut zstd = tsonic_node::zlib::create_zstd_compress(Some(Default::default()));
    assert!(zstd.process(&input).is_err());
    let mut unzstd = tsonic_node::zlib::create_zstd_decompress(Some(Default::default()));
    assert!(unzstd.process(&input).is_err());
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

#[test]
fn sqlite_statement_sessions_tag_store_and_constants_are_closed_shapes() {
    let database = DatabaseSync::open_with_options(
        ":memory:",
        DatabaseSyncOptions {
            open: true,
            read_bigints: true,
            return_arrays: true,
            allow_bare_named_parameters: true,
            allow_unknown_named_parameters: true,
            defensive: true,
            limits: Some(DatabaseLimits {
                variable_number: 999,
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(database.is_open());
    assert!(!database.is_transaction());
    assert_eq!(database.location(Some("main")).as_deref(), Some(":memory:"));
    assert_eq!(database.limits().variable_number, 999);

    database
        .exec("create table kv (id integer primary key, name text)")
        .unwrap();
    let statement = database.prepare(
        "insert into kv (name) values (?1)",
        Some(PrepareOptions {
            read_bigints: true,
            return_arrays: true,
            allow_bare_named_parameters: true,
            allow_unknown_named_parameters: true,
        }),
    );
    assert_eq!(statement.source_sql(), "insert into kv (name) values (?1)");
    assert_eq!(
        statement.expanded_sql(),
        "insert into kv (name) values (?1)"
    );
    statement.set_read_bigints(false);
    statement.set_return_arrays(false);
    statement.set_allow_bare_named_parameters(false);
    statement.set_allow_unknown_named_parameters(false);
    let inserted = statement
        .run(&[SqlValue::Text("alpha".to_string())])
        .unwrap();
    assert_eq!(inserted.changes, 1);
    assert_eq!(inserted.last_insert_rowid, 1);

    let select = database.prepare("select id, name from kv", None);
    let columns = select.columns().unwrap();
    assert_eq!(columns[0].name, "id");
    assert_eq!(select.iterate(&[]).unwrap().len(), 1);
    assert_eq!(
        select.get(&[]).unwrap().unwrap().get("name"),
        Some(&JsValue::String("alpha".to_string()))
    );

    let tag_store = database.create_tag_store(Some(2));
    assert_eq!(tag_store.capacity(), 2);
    tag_store
        .run(
            "insert into kv (name) values (?1)",
            &[SqlValue::Text("beta".to_string())],
        )
        .unwrap();
    assert_eq!(tag_store.size(), 1);
    assert_eq!(tag_store.all("select name from kv", &[]).unwrap().len(), 2);
    assert!(tag_store
        .get("select name from kv where name = 'beta'", &[])
        .unwrap()
        .is_some());
    tag_store.clear();
    assert_eq!(tag_store.size(), 0);

    let session = database.create_session(Some(CreateSessionOptions {
        db: Some("main".to_string()),
        table: Some("kv".to_string()),
    }));
    assert_eq!(session.db(), "main");
    assert_eq!(session.table(), Some("kv"));
    assert!(session.changeset().is_empty());
    assert!(session.patchset().is_empty());
    session.close();
    assert!(session.closed());

    assert!(database.apply_changeset(
        &[],
        Some(ApplyChangesetOptions {
            filter: Some(|table| table == "main"),
            on_conflict: Some(|code| code),
        }),
    ));
    database.enable_defensive(false);
    database.enable_load_extension(true);
    assert!(database.load_extension("x").is_err());
    database.function("identity", |args| {
        args.first().cloned().unwrap_or(SqlValue::Null)
    });
    database.aggregate(
        "sum_like",
        tsonic_node::sqlite::AggregateOptions {
            start: Some(SqlValue::Integer(0)),
            step: |acc, _args| acc,
            inverse: None,
            result: None,
        },
    );

    assert_eq!(sqlite_constants::SQLITE_OK, 0);
    assert_eq!(sqlite_constants::SQLITE_CREATE_TABLE, 2);
    assert_eq!(sqlite_constants::SQLITE_CHANGESET_ABORT, 2);
    database.close();
    assert!(!database.is_open());
    database.open_connection();
    assert!(database.is_open());
}
