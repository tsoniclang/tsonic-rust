use std::cell::Cell;

use tsonic_node::{buffer::Buffer, dns, stream, timers};

#[test]
fn timers_run_callbacks_and_expose_handle_state() {
    let called = Cell::new(false);
    let mut timeout = timers::set_timeout(|| called.set(true), 0);
    assert!(called.get());
    assert!(timeout.id() > 0);
    assert_eq!(timeout.delay_ms(), 0);
    assert!(timeout.has_ref());
    timeout.unref();
    assert!(!timeout.has_ref());
    timeout.r#ref();
    timers::clear_timeout(&mut timeout);
    assert!(!timeout.has_ref());
    timeout.on_timeout(|| called.set(false));
    assert!(!called.get());

    let (_, value) = timers::promises::set_timeout_value(0, "done");
    assert_eq!(value, "done");
    let aborted_called = Cell::new(false);
    let aborted = timers::set_timeout_with_options(
        || aborted_called.set(true),
        0,
        timers::TimerOptions {
            r#ref: true,
            signal_aborted: true,
        },
    );
    assert!(!aborted_called.get());
    assert!(!aborted.has_ref());
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
    immediate.on_immediate(|| count.set(count.get() + 1));
    assert_eq!(count.get(), 3);
    timers::clear_immediate(&mut immediate);
    assert!(!immediate.has_ref());
    let immediate_options = timers::set_immediate_with_options(
        || count.set(count.get() + 1),
        timers::TimerOptions {
            r#ref: false,
            signal_aborted: false,
        },
    );
    assert_eq!(count.get(), 4);
    assert!(!immediate_options.has_ref());

    let mut another = timers::set_interval(|| {}, 0);
    timers::clear_interval(&mut another);
    assert!(!another.has_ref());
    let interval_options = timers::set_interval_with_options(
        || count.set(count.get() + 1),
        0,
        timers::TimerOptions {
            r#ref: false,
            signal_aborted: false,
        },
    );
    assert_eq!(count.get(), 5);
    assert!(!interval_options.has_ref());

    let (_, values) = timers::promises::set_interval_values(0, "tick", 3);
    assert_eq!(values, vec!["tick", "tick", "tick"]);
    let (_, value) = timers::promises::set_immediate_value("immediate");
    assert_eq!(value, "immediate");
    let (_, value) = timers::promises::set_immediate_value_with_options(
        "immediate options",
        timers::TimerOptions {
            r#ref: false,
            signal_aborted: false,
        },
    );
    assert_eq!(value, "immediate options");
    let (unrefed, value) = timers::promises::set_timeout_value_with_options(
        0,
        "quiet",
        timers::TimerOptions {
            r#ref: false,
            signal_aborted: false,
        },
    );
    assert_eq!(value, "quiet");
    assert!(!unrefed.has_ref());
    let (unrefed_interval, values) = timers::promises::set_interval_values_with_options(
        0,
        "quiet tick",
        2,
        timers::TimerOptions {
            r#ref: false,
            signal_aborted: false,
        },
    );
    assert_eq!(values, vec!["quiet tick", "quiet tick"]);
    assert!(!unrefed_interval.has_ref());
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
fn stream_consumers_cover_buffer_text_array_buffer_blob_and_json() {
    let chunks = || {
        stream::Readable::from_chunks(vec![
            Buffer::from_string("{\"ok\":", Some("utf8")).unwrap(),
            Buffer::from_string("true}", Some("utf8")).unwrap(),
        ])
    };

    let mut readable = chunks();
    assert_eq!(
        stream::consumers::buffer(&mut readable)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "{\"ok\":true}"
    );

    let mut readable = chunks();
    assert_eq!(
        stream::consumers::array_buffer(&mut readable)
            .unwrap()
            .as_bytes(),
        b"{\"ok\":true}"
    );

    let mut readable = chunks();
    let blob = stream::consumers::blob(&mut readable, "application/json").unwrap();
    assert_eq!(blob.content_type(), "application/json");
    assert_eq!(blob.text().unwrap(), "{\"ok\":true}");

    let mut readable = chunks();
    assert_eq!(
        stream::consumers::json(&mut readable, Some("utf8"))
            .unwrap()
            .inspect(),
        "{ok: true}"
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
fn stream_state_options_and_backpressure_are_explicit_carriers() {
    let mut readable = stream::Readable::from_chunks_with_options(
        vec![Buffer::from_string("b", Some("utf8")).unwrap()],
        stream::StreamOptions {
            high_water_mark: 2,
            object_mode: false,
            emit_close: true,
            auto_destroy: true,
            allow_half_open: false,
            default_encoding: "utf8".to_string(),
        },
    );
    readable.unshift(Buffer::from_string("a", Some("utf8")).unwrap());
    assert_eq!(readable.readable_length(), 2);
    assert_eq!(readable.readable_high_water_mark(), 2);
    readable.set_encoding("UTF8");
    assert_eq!(readable.readable_encoding(), Some("utf8"));
    readable.pause();
    assert!(readable.is_paused());
    assert!(readable.read().is_none());
    readable.resume();
    assert_eq!(readable.take(1)[0].to_string(Some("utf8")).unwrap(), "a");
    assert!(!readable.push(Buffer::from_string("c", Some("utf8")).unwrap()));
    assert_eq!(readable.to_array().len(), 2);
    assert!(readable.readable_ended());
    readable.destroy_with_error("boom");
    assert!(readable.destroyed());
    assert_eq!(readable.errored(), Some("boom"));
    assert!(stream::Readable::wrap(readable).closed());

    let mut writable = stream::Writable::with_options(stream::StreamOptions {
        high_water_mark: 1,
        object_mode: false,
        emit_close: true,
        auto_destroy: true,
        allow_half_open: false,
        default_encoding: "utf8".to_string(),
    });
    assert_eq!(writable.writable_high_water_mark(), 1);
    assert!(!writable.write(Buffer::from_string("x", Some("utf8")).unwrap()));
    assert!(writable.writable_need_drain());
    writable.clear_drain();
    assert!(!writable.writable_need_drain());
    writable.cork();
    writable.cork();
    assert_eq!(writable.writable_corked(), 2);
    writable.uncork();
    assert_eq!(writable.writable_corked(), 1);
    writable.set_default_encoding("latin1");
    assert_eq!(writable.default_encoding(), "latin1");
    assert!(!writable.write_str("y", Some("utf8")));
    assert!(!writable.writev(&[Buffer::from_string("z", Some("utf8")).unwrap()]));
    assert_eq!(writable.writable_length(), 3);
    assert!(writable.flush());
    let finalized = Cell::new(false);
    writable.final_callback(|| finalized.set(true));
    assert!(finalized.get());
    assert!(writable.writable_ended());
    assert!(writable.writable_finished());
    assert!(writable.closed());

    let constructed = Cell::new(false);
    writable.construct_callback(|| constructed.set(true));
    assert!(constructed.get());
    writable.destroy_with_error("closed");
    assert!(writable.destroyed());
    assert_eq!(writable.errored(), Some("closed"));
}

#[test]
fn stream_readable_functional_operators_are_closed_buffer_transforms() {
    let chunks = || {
        stream::Readable::from(vec![
            Buffer::from_string("a", Some("utf8")).unwrap(),
            Buffer::from_string("bb", Some("utf8")).unwrap(),
            Buffer::from_string("ccc", Some("utf8")).unwrap(),
        ])
    };

    let mut readable = chunks();
    let mapped = readable.map(|chunk| {
        Buffer::from_string(
            &chunk.to_string(Some("utf8")).unwrap().to_ascii_uppercase(),
            Some("utf8"),
        )
        .unwrap()
    });
    assert_eq!(
        mapped
            .to_vec()
            .into_iter()
            .map(|chunk| chunk.to_string(Some("utf8")).unwrap())
            .collect::<Vec<_>>(),
        vec!["A", "BB", "CCC"]
    );

    let mut readable = chunks();
    assert_eq!(
        readable
            .filter(|chunk| chunk.len() > 1)
            .to_vec()
            .into_iter()
            .map(|chunk| chunk.to_string(Some("utf8")).unwrap())
            .collect::<Vec<_>>(),
        vec!["bb", "ccc"]
    );

    let mut readable = chunks();
    assert_eq!(
        readable
            .flat_map(|chunk| vec![chunk.clone(), chunk])
            .to_vec()
            .len(),
        6
    );

    let mut readable = chunks();
    assert_eq!(
        readable
            .drop(1)
            .into_iter()
            .map(|chunk| chunk.to_string(Some("utf8")).unwrap())
            .collect::<Vec<_>>(),
        vec!["bb", "ccc"]
    );

    let mut readable = chunks();
    assert!(readable.every(|chunk| !chunk.is_empty()));
    let mut readable = chunks();
    assert!(readable.some(|chunk| chunk.len() == 2));
    let mut readable = chunks();
    assert_eq!(
        readable
            .find(|chunk| chunk.len() == 3)
            .unwrap()
            .to_string(Some("utf8"))
            .unwrap(),
        "ccc"
    );
    let mut readable = chunks();
    assert_eq!(readable.reduce(0, |total, chunk| total + chunk.len()), 6);

    let mut seen = Vec::new();
    let mut readable = chunks();
    readable.for_each(|chunk| seen.push(chunk.to_string(Some("utf8")).unwrap()));
    assert_eq!(seen, vec!["a", "bb", "ccc"]);

    let composed = chunks()
        .compose(|mut readable| readable.map(|chunk| Buffer::from_bytes(vec![chunk.len() as u8])));
    assert_eq!(
        composed
            .to_vec()
            .into_iter()
            .map(|chunk| chunk.as_bytes()[0])
            .collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
}

#[test]
fn web_streams_support_reader_writer_pipe_and_transform_shapes() {
    let mut readable = stream::web::ReadableStream::from_chunks(vec![
        Buffer::from_string("a", Some("utf8")).unwrap(),
        Buffer::from_string("b", Some("utf8")).unwrap(),
    ]);
    assert!(!readable.locked());
    {
        let mut reader = readable.get_reader().unwrap();
        assert_eq!(reader.read().unwrap().to_string(Some("utf8")).unwrap(), "a");
        reader.release_lock();
    }
    assert!(!readable.locked());

    let mut writable = stream::web::WritableStream::new();
    {
        let mut writer = writable.get_writer().unwrap();
        writer
            .write(Buffer::from_string("x", Some("utf8")).unwrap())
            .unwrap();
        writer.close();
    }
    assert!(writable.closed());
    assert_eq!(writable.chunks().len(), 1);
    assert!(writable
        .write(Buffer::from_string("late", Some("utf8")).unwrap())
        .is_err());

    let mut source = stream::web::ReadableStream::from_chunks(vec![
        Buffer::from_string("p", Some("utf8")).unwrap(),
        Buffer::from_string("q", Some("utf8")).unwrap(),
    ]);
    let mut destination = stream::web::WritableStream::new();
    source.pipe_to(&mut destination).unwrap();
    assert!(destination.closed());
    assert_eq!(destination.chunks().len(), 2);

    let mut transform = stream::web::TransformStream::new();
    transform
        .write_passthrough(Buffer::from_string("z", Some("utf8")).unwrap())
        .unwrap();
    assert_eq!(transform.readable().chunks().len(), 1);
    assert_eq!(transform.writable().chunks().len(), 1);
}

#[test]
fn dns_lookup_uses_platform_resolver_without_shelling_out() {
    let lookup = dns::lookup("localhost").unwrap();
    assert!(lookup.family == 4 || lookup.family == 6);
    assert!(!lookup.address.is_empty());
    assert!(dns::resolve4("localhost").is_ok() || dns::resolve6("localhost").is_ok());
    assert!(
        dns::resolve("localhost", Some("A")).is_ok()
            || dns::resolve("localhost", Some("AAAA")).is_ok()
    );
    assert!(dns::reverse("127.0.0.1")
        .unwrap()
        .contains(&"127.0.0.1".to_string()));

    dns::set_default_result_order(dns::DefaultResultOrder::Ipv4First);
    assert_eq!(dns::get_default_result_order().as_str(), "ipv4first");
    dns::set_default_result_order(dns::DefaultResultOrder::Verbatim);

    let mut resolver = dns::Resolver::new();
    resolver.set_servers(&["1.1.1.1", "8.8.8.8"]);
    assert_eq!(resolver.get_servers(), vec!["1.1.1.1", "8.8.8.8"]);
    resolver.set_local_address(Some("127.0.0.1"), Some("::1"));
    assert_eq!(resolver.local_addresses(), (Some("127.0.0.1"), Some("::1")));
    assert!(resolver.lookup("localhost").is_ok());
    assert!(resolver.resolve4("localhost").is_ok() || resolver.resolve6("localhost").is_ok());
    assert!(
        resolver.resolve("localhost", Some("A")).is_ok()
            || resolver.resolve("localhost", Some("AAAA")).is_ok()
    );
    assert!(resolver.reverse("127.0.0.1").is_ok());
    resolver.cancel();
    assert!(resolver.cancelled());

    assert!(dns::resolve_cname("localhost").is_err());
    assert!(dns::resolve_mx("localhost").is_err());
    assert!(dns::resolve_txt("localhost").is_err());
    assert!(dns::resolve_srv("localhost").is_err());
    assert!(dns::resolve_ns("localhost").is_err());
    assert!(dns::resolve_ptr("localhost").is_err());
    assert!(dns::resolve_caa("localhost").is_err());
    assert!(dns::resolve_naptr("localhost").is_err());
    assert!(dns::resolve_soa("localhost").is_err());
    assert!(dns::resolve_tlsa("localhost").is_err());
    assert!(dns::resolve_any("localhost").is_ok());
    assert_eq!(
        dns::lookup_service("127.0.0.1", 80).unwrap(),
        ("127.0.0.1".to_string(), "80".to_string())
    );
    assert!(dns::promises::lookup_now("localhost").is_ok());
    assert!(
        dns::promises::resolve_now("localhost", Some("A")).is_ok()
            || dns::promises::resolve_now("localhost", Some("AAAA")).is_ok()
    );
    assert!(dns::promises::resolve_ns_now("localhost").is_err());
    assert!(dns::promises::resolve_ptr_now("localhost").is_err());
    assert!(dns::promises::resolve_caa_now("localhost").is_err());
    assert!(dns::promises::resolve_naptr_now("localhost").is_err());
    assert!(dns::promises::resolve_soa_now("localhost").is_err());
    assert!(dns::promises::resolve_tlsa_now("localhost").is_err());
    assert!(dns::promises::resolve_any_now("localhost").is_ok());
    assert!(dns::promises::lookup_service_now("127.0.0.1", 443).is_ok());
    assert!(dns::promises::reverse_now("127.0.0.1").is_ok());
}
