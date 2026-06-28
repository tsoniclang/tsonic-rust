use std::cell::Cell;

use tsonic_node::{buffer::Buffer, dns, stream, timers};

#[test]
fn timers_run_callbacks_and_expose_handle_state() {
    let called = Cell::new(false);
    let mut timeout = timers::set_timeout(|| called.set(true), 0);
    assert!(called.get());
    assert!(timeout.id() > 0);
    assert!(timeout.has_ref());
    timeout.unref();
    assert!(!timeout.has_ref());
    timeout.r#ref();
    timers::clear_timeout(&mut timeout);
    assert!(!timeout.has_ref());

    let (_, value) = timers::promises::set_timeout_value(0, "done");
    assert_eq!(value, "done");
}

#[test]
fn stream_pipeline_moves_closed_buffer_chunks() {
    let mut readable = stream::Readable::from_chunks(vec![
        Buffer::from_string("hello", Some("utf8")).unwrap(),
        Buffer::from_string(" world", Some("utf8")).unwrap(),
    ]);
    let mut writable = stream::Writable::new();
    stream::pipeline(&mut readable, &mut writable).unwrap();
    assert!(readable.is_ended());
    assert_eq!(writable.chunks().len(), 2);

    let mut readable = stream::Readable::from_chunks(writable.chunks().to_vec());
    assert_eq!(
        stream::consumers::text(&mut readable, Some("utf8")).unwrap(),
        "hello world"
    );
}

#[test]
fn dns_lookup_uses_platform_resolver_without_shelling_out() {
    let lookup = dns::lookup("localhost").unwrap();
    assert!(lookup.family == 4 || lookup.family == 6);
    assert!(!lookup.address.is_empty());
    assert!(dns::resolve4("localhost").is_ok() || dns::resolve6("localhost").is_ok());
}
