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
