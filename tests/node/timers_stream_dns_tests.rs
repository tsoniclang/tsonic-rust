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
fn timers_cover_interval_immediate_and_scheduler_shapes() {
    let count = Cell::new(0);
    let mut interval = timers::set_interval(|| count.set(count.get() + 1), 0);
    assert_eq!(count.get(), 1);
    assert!(interval.has_ref());
    interval.refresh().close();
    assert!(!interval.has_ref());

    let mut immediate = timers::set_immediate(|| count.set(count.get() + 1));
    assert_eq!(count.get(), 2);
    timers::clear_immediate(&mut immediate);
    assert!(!immediate.has_ref());

    let mut another = timers::set_interval(|| {}, 0);
    timers::clear_interval(&mut another);
    assert!(!another.has_ref());

    let (_, values) = timers::promises::set_interval_values(0, "tick", 3);
    assert_eq!(values, vec!["tick", "tick", "tick"]);
    let (_, value) = timers::promises::set_immediate_value("immediate");
    assert_eq!(value, "immediate");
    timers::promises::scheduler::wait(0);
    timers::promises::scheduler::yield_now();
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
fn stream_classes_promises_and_web_bridges_use_closed_buffers() {
    let mut pass = stream::PassThrough::new();
    assert!(pass.write(Buffer::from_string("a", Some("utf8")).unwrap()));
    assert_eq!(pass.read().unwrap().to_string(Some("utf8")).unwrap(), "a");
    pass.end();

    let mut transform = stream::Transform::new(|chunk| {
        Buffer::from_string(
            &chunk.to_string(Some("utf8")).unwrap().to_ascii_uppercase(),
            Some("utf8"),
        )
        .unwrap()
    });
    assert!(transform.write(Buffer::from_string("hello", Some("utf8")).unwrap()));
    assert_eq!(
        transform.read().unwrap().to_string(Some("utf8")).unwrap(),
        "HELLO"
    );

    let mut duplex = stream::Duplex::new(stream::Readable::from(vec![]), stream::Writable::new());
    assert!(duplex.write(Buffer::from_string("x", Some("utf8")).unwrap()));
    duplex.end();
    assert_eq!(duplex.writable_chunks().len(), 1);

    let mut readable =
        stream::Readable::from(vec![Buffer::from_string("web", Some("utf8")).unwrap()]);
    let mut writable = stream::Writable::new();
    stream::promises::pipeline(&mut readable, &mut writable).unwrap();
    assert!(stream::promises::finished(&readable, &writable));

    let web_readable =
        stream::web::readable_to_web(stream::Readable::from(writable.chunks().to_vec()));
    assert_eq!(web_readable.chunks().len(), 1);
    let native_readable = stream::web::readable_from_web(web_readable);
    assert_eq!(native_readable.to_vec().len(), 1);
    let web_writable = stream::web::writable_to_web(writable.clone());
    assert_eq!(web_writable.chunks().len(), 1);
    let native_writable = stream::web::writable_from_web(web_writable);
    assert_eq!(native_writable.chunks().len(), 1);
}

#[test]
fn dns_lookup_uses_platform_resolver_without_shelling_out() {
    let lookup = dns::lookup("localhost").unwrap();
    assert!(lookup.family == 4 || lookup.family == 6);
    assert!(!lookup.address.is_empty());
    assert!(dns::resolve4("localhost").is_ok() || dns::resolve6("localhost").is_ok());
}
