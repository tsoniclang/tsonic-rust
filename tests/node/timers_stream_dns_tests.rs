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
    assert!(stream::promises::finished_with_options(
        &readable,
        &writable,
        &stream::FinishedOptions::default()
    ));

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
fn stream_promises_options_and_transform_chains_are_explicit() {
    fn uppercase(chunk: Buffer) -> Buffer {
        Buffer::from_string(
            &chunk.to_string(Some("utf8")).unwrap().to_ascii_uppercase(),
            Some("utf8"),
        )
        .unwrap()
    }

    fn suffix(chunk: Buffer) -> Buffer {
        Buffer::from_string(
            &(chunk.to_string(Some("utf8")).unwrap() + "!"),
            Some("utf8"),
        )
        .unwrap()
    }

    let mut readable = stream::Readable::from(vec![
        Buffer::from_string("a", Some("utf8")).unwrap(),
        Buffer::from_string("b", Some("utf8")).unwrap(),
    ]);
    let mut writable = stream::Writable::new();
    let written = stream::promises::pipeline_with_options(
        &mut readable,
        &mut writable,
        &stream::promises::PipelineOptions {
            end: false,
            signal_aborted: false,
        },
    )
    .unwrap();
    assert_eq!(written, 2);
    assert!(!writable.writable_ended());
    assert!(stream::promises::finished_with_options(
        &readable,
        &writable,
        &stream::FinishedOptions {
            readable: true,
            writable: false,
            error: true,
            cleanup: true,
        }
    ));

    let mut readable =
        stream::Readable::from(vec![Buffer::from_string("x", Some("utf8")).unwrap()]);
    let mut writable = stream::Writable::new();
    stream::promises::pipeline_transform(
        &mut readable,
        uppercase,
        &mut writable,
        &stream::promises::PipelineOptions::default(),
    )
    .unwrap();
    assert_eq!(writable.chunks()[0].to_string(Some("utf8")).unwrap(), "X");
    assert!(writable.writable_ended());

    let mut readable =
        stream::Readable::from(vec![Buffer::from_string("y", Some("utf8")).unwrap()]);
    let mut writable = stream::Writable::new();
    stream::promises::pipeline_transforms(
        &mut readable,
        &[uppercase, suffix],
        &mut writable,
        &stream::promises::PipelineOptions::default(),
    )
    .unwrap();
    assert_eq!(writable.chunks()[0].to_string(Some("utf8")).unwrap(), "Y!");

    let mut readable =
        stream::Readable::from(vec![Buffer::from_string("z", Some("utf8")).unwrap()]);
    let mut writable = stream::Writable::new();
    let error = stream::promises::pipeline_with_options(
        &mut readable,
        &mut writable,
        &stream::promises::PipelineOptions {
            end: true,
            signal_aborted: true,
        },
    )
    .unwrap_err();
    assert_eq!(error.code(), "ABORT_ERR");
    assert_eq!(readable.readable_length(), 1);
    assert!(writable.chunks().is_empty());
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
    assert!(!readable.readable_object_mode());
    assert_eq!(readable.readable_flowing(), Some(true));
    assert!(!readable.readable_did_read());
    readable.set_encoding("UTF8");
    assert_eq!(readable.readable_encoding(), Some("utf8"));
    readable
        .add_listener("data")
        .once("end")
        .prepend_listener("close");
    assert_eq!(readable.listener_count("data"), 1);
    assert!(readable.emit("data"));
    assert_eq!(readable.listeners("end"), vec!["end".to_string()]);
    assert_eq!(readable.raw_listeners("close"), vec!["close".to_string()]);
    assert_eq!(
        readable.event_names(),
        vec!["close".to_string(), "data".to_string(), "end".to_string()]
    );
    readable.off("data");
    assert_eq!(readable.listener_count("data"), 0);
    readable.pause();
    assert!(readable.is_paused());
    assert_eq!(readable.readable_flowing(), Some(false));
    assert!(readable.read().is_none());
    readable.resume();
    assert_eq!(readable.take(1)[0].to_string(Some("utf8")).unwrap(), "a");
    assert!(readable.readable_did_read());
    assert!(!readable.push(Buffer::from_string("c", Some("utf8")).unwrap()));
    assert_eq!(readable.to_array().len(), 2);
    assert!(readable.readable_ended());
    readable.destroy_with_error("boom");
    assert!(readable.destroyed());
    assert_eq!(readable.errored(), Some("boom"));
    assert!(stream::Readable::wrap(readable).closed());

    let mut writable = stream::Writable::with_options(stream::StreamOptions {
        high_water_mark: 1,
        object_mode: true,
        emit_close: true,
        auto_destroy: true,
        allow_half_open: false,
        default_encoding: "utf8".to_string(),
    });
    assert_eq!(writable.writable_high_water_mark(), 1);
    assert!(writable.writable_object_mode());
    writable
        .add_listener("drain")
        .prepend_once_listener("finish")
        .on("finish");
    assert_eq!(writable.listener_count("finish"), 2);
    assert!(writable.emit("finish"));
    assert_eq!(writable.raw_listeners("drain"), vec!["drain".to_string()]);
    writable.remove_all_listeners(Some("finish"));
    assert_eq!(writable.listener_count("finish"), 0);
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
    assert!(stream::is_destroyed(
        &stream::Readable::from(vec![]),
        &writable
    ));
    assert!(stream::is_errored(
        &stream::Readable::from(vec![]),
        &writable
    ));
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
    let composed = stream::compose(chunks(), |mut readable| {
        stream::Readable::from(readable.take(2))
    });
    assert_eq!(composed.to_vec().len(), 2);
    let mut aborted = chunks();
    stream::add_abort_signal(&mut aborted, true);
    assert_eq!(aborted.errored(), Some("aborted"));
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
        let next = reader.read_result();
        assert!(!next.done);
        assert_eq!(next.value.unwrap().to_string(Some("utf8")).unwrap(), "b");
        assert!(reader.read_result().done);
        assert!(reader.closed());
        reader.release_lock();
    }
    assert!(!readable.locked());
    let (_left, _right) = readable.tee();
    let mut cancelable =
        stream::web::ReadableStream::from_chunks(vec![
            Buffer::from_string("x", Some("utf8")).unwrap()
        ]);
    cancelable.cancel_with_reason("done");
    assert!(cancelable.canceled());

    let mut writable = stream::web::WritableStream::new();
    {
        let mut writer = writable.get_writer().unwrap();
        assert!(writer.ready());
        assert!(writer.desired_size().is_some());
        writer
            .write(Buffer::from_string("x", Some("utf8")).unwrap())
            .unwrap();
        writer.close();
        assert!(writer.closed());
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
    source
        .pipe_to_with_options(&mut destination, &stream::web::StreamPipeOptions::default())
        .unwrap();
    assert!(destination.closed());
    assert_eq!(destination.chunks().len(), 2);

    let mut transform = stream::web::TransformStream::new();
    transform
        .write_passthrough(Buffer::from_string("z", Some("utf8")).unwrap())
        .unwrap();
    assert_eq!(transform.readable().chunks().len(), 1);
    assert_eq!(transform.writable().chunks().len(), 1);

    let mut default_controller = stream::web::ReadableStreamDefaultController::new();
    default_controller
        .enqueue(Buffer::from_string("c", Some("utf8")).unwrap())
        .unwrap();
    assert!(default_controller.desired_size().is_some());
    default_controller.close();
    assert!(default_controller.desired_size().is_none());

    let mut byte_controller = stream::web::ReadableByteStreamController::new();
    byte_controller
        .enqueue(Buffer::from_string("bytes", Some("utf8")).unwrap())
        .unwrap();
    let mut byob = stream::web::ReadableStreamBYOBRequest::new(Buffer::alloc(8));
    byob.respond(4);
    assert_eq!(byob.bytes_written(), 4);
    byob.respond_with_new_view(Buffer::from_bytes(vec![1, 2, 3]));
    assert_eq!(byob.view().unwrap().len(), 3);
    byte_controller.set_byob_request(byob);
    assert!(byte_controller.byob_request().is_some());

    let mut writable_controller = stream::web::WritableStreamDefaultController::new();
    assert!(!writable_controller.signal_aborted());
    writable_controller.abort_signal();
    writable_controller.error("closed");
    assert_eq!(writable_controller.errored(), Some("closed"));

    let mut transform_controller = stream::web::TransformStreamDefaultController::new();
    transform_controller
        .enqueue(Buffer::from_string("t", Some("utf8")).unwrap())
        .unwrap();
    assert_eq!(transform_controller.chunks().len(), 1);
    transform_controller.terminate();
    assert!(transform_controller.desired_size().is_none());

    let count = stream::web::CountQueuingStrategy::new(stream::web::QueuingStrategyInit {
        high_water_mark: 2,
    });
    assert_eq!(count.high_water_mark(), 2);
    assert_eq!(count.size(), 1);
    let byte_length =
        stream::web::ByteLengthQueuingStrategy::new(stream::web::QueuingStrategyInit {
            high_water_mark: 10,
        });
    assert_eq!(
        byte_length.size(&Buffer::from_string("abc", Some("utf8")).unwrap()),
        3
    );
    let encoder = stream::web::TextEncoderStream::default();
    assert!(!encoder.readable().locked());
    let decoder = stream::web::TextDecoderStream::default();
    assert!(!decoder.writable().closed());
    let gzip = stream::web::CompressionStream::new("gzip");
    assert_eq!(gzip.format(), "gzip");
}

#[test]
fn dns_lookup_uses_platform_resolver_without_shelling_out() {
    let lookup = dns::lookup("localhost").unwrap();
    assert!(lookup.family == 4 || lookup.family == 6);
    assert!(!lookup.address.is_empty());
    let lookup_options = dns::LookupOptions {
        family: Some(lookup.family),
        hints: Some(0),
        all: false,
        verbatim: Some(true),
        order: Some(dns::DefaultResultOrder::Verbatim),
    };
    let one = dns::lookup_one("localhost", lookup_options).unwrap();
    assert_eq!(one.family, lookup.family);
    let all = dns::lookup_all(
        "localhost",
        dns::LookupOptions {
            all: true,
            ..lookup_options
        },
    )
    .unwrap();
    assert!(!all.is_empty());
    assert!(matches!(
        dns::lookup_with_options("localhost", lookup_options).unwrap(),
        dns::LookupResult::One(_)
    ));
    assert!(dns::resolve4("localhost").is_ok() || dns::resolve6("localhost").is_ok());
    assert!(
        dns::resolve4_with_ttl("localhost").is_ok() || dns::resolve6_with_ttl("localhost").is_ok()
    );
    assert!(matches!(
        dns::resolve4_with_options("localhost", dns::ResolveOptions { ttl: false })
            .or_else(|_| dns::resolve6_with_options(
                "localhost",
                dns::ResolveOptions { ttl: false }
            ))
            .unwrap(),
        dns::ResolveAddressResult::Addresses(_)
    ));
    assert!(dns::ResolveWithTtlOptions::default().ttl);
    assert!(
        dns::resolve("localhost", Some("A")).is_ok()
            || dns::resolve("localhost", Some("AAAA")).is_ok()
    );
    assert!(dns::reverse("127.0.0.1")
        .unwrap()
        .contains(&"127.0.0.1".to_string()));

    dns::set_default_result_order(dns::DefaultResultOrder::Ipv4First);
    assert_eq!(dns::get_default_result_order().as_str(), "ipv4first");
    dns::set_default_result_order(dns::DefaultResultOrder::Ipv6First);
    assert_eq!(dns::get_default_result_order().as_str(), "ipv6first");
    dns::set_default_result_order(dns::DefaultResultOrder::Verbatim);

    let mut resolver = dns::Resolver::new();
    let resolver_with_options = dns::Resolver::with_options(dns::ResolverOptions {
        timeout: Some(250),
        tries: Some(2),
        max_timeout: Some(1_000),
    });
    assert_eq!(resolver_with_options.options().timeout, Some(250));
    assert_eq!(resolver_with_options.options().tries, Some(2));
    assert_eq!(resolver_with_options.options().max_timeout, Some(1_000));
    assert_eq!(
        resolver
            .lookup_one("localhost", lookup_options)
            .unwrap()
            .family,
        lookup.family
    );
    assert!(!resolver
        .lookup_all(
            "localhost",
            dns::LookupOptions {
                all: true,
                ..lookup_options
            },
        )
        .unwrap()
        .is_empty());
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
    assert!(
        resolver.resolve4_with_ttl("localhost").is_ok()
            || resolver.resolve6_with_ttl("localhost").is_ok()
    );
    assert!(matches!(
        resolver
            .resolve4_with_options("localhost", dns::ResolveOptions { ttl: false })
            .or_else(
                |_| resolver.resolve6_with_options("localhost", dns::ResolveOptions { ttl: false })
            )
            .unwrap(),
        dns::ResolveAddressResult::Addresses(_)
    ));
    assert!(resolver.reverse("127.0.0.1").is_ok());
    resolver.cancel();
    assert!(resolver.cancelled());

    let mx = dns::MxRecord {
        priority: 10,
        exchange: "mail.example".to_string(),
    };
    assert_eq!(mx.exchange, "mail.example");
    let srv = dns::SrvRecord {
        priority: 1,
        weight: 2,
        port: 443,
        name: "svc.example".to_string(),
    };
    assert_eq!((srv.priority, srv.weight, srv.port), (1, 2, 443));
    let caa = dns::CaaRecord {
        critical: 0,
        issue: Some("letsencrypt.org".to_string()),
        issue_wild: None,
        iodef: Some("mailto:ops@example".to_string()),
        contact_email: Some("ops@example".to_string()),
        contact_phone: None,
    };
    assert_eq!(caa.issue.as_deref(), Some("letsencrypt.org"));
    assert_eq!(caa.iodef.as_deref(), Some("mailto:ops@example"));
    let naptr = dns::NaptrRecord {
        flags: "s".to_string(),
        service: "SIP+D2U".to_string(),
        regexp: String::new(),
        replacement: "_sip._udp.example".to_string(),
        order: 100,
        preference: 50,
    };
    assert_eq!((naptr.order, naptr.preference), (100, 50));
    let soa = dns::SoaRecord {
        nsname: "ns.example".to_string(),
        hostmaster: "hostmaster.example".to_string(),
        serial: 1,
        refresh: 2,
        retry: 3,
        expire: 4,
        minttl: 5,
    };
    assert_eq!(soa.minttl, 5);
    let tlsa = dns::TlsaRecord {
        cert_usage: 3,
        selector: 1,
        match_type: 1,
        data: vec![1, 2],
    };
    assert_eq!(tlsa.match_type, 1);
    let ttl = dns::RecordWithTtl {
        address: "127.0.0.1".to_string(),
        ttl: 60,
    };
    assert_eq!(ttl.ttl, 60);
    assert_eq!(
        dns::AnyARecord {
            address: "127.0.0.1".to_string()
        }
        .record_type(),
        "A"
    );
    assert_eq!(
        dns::AnyAaaaRecord {
            address: "::1".to_string()
        }
        .record_type(),
        "AAAA"
    );
    assert_eq!(
        dns::AnyCnameRecord {
            value: "alias".to_string()
        }
        .record_type(),
        "CNAME"
    );
    assert_eq!(
        dns::AnyCnameRecord {
            value: "alias".to_string()
        }
        .value,
        "alias"
    );
    assert_eq!(
        dns::AnyNsRecord {
            value: "ns".to_string()
        }
        .record_type(),
        "NS"
    );
    assert_eq!(
        dns::AnyNsRecord {
            value: "ns".to_string()
        }
        .value,
        "ns"
    );
    assert_eq!(
        dns::AnyPtrRecord {
            value: "ptr".to_string()
        }
        .record_type(),
        "PTR"
    );
    assert_eq!(
        dns::AnyPtrRecord {
            value: "ptr".to_string()
        }
        .value,
        "ptr"
    );
    assert_eq!(
        dns::AnyMxRecord {
            priority: 10,
            exchange: "mail".to_string()
        }
        .record_type(),
        "MX"
    );
    assert_eq!(
        dns::AnySrvRecord {
            priority: 1,
            weight: 2,
            port: 443,
            name: "svc".to_string()
        }
        .record_type(),
        "SRV"
    );
    assert_eq!(
        dns::AnyTxtRecord {
            entries: vec!["txt".to_string()]
        }
        .record_type(),
        "TXT"
    );
    assert_eq!(
        dns::AnyTxtRecord {
            entries: vec!["txt".to_string()]
        }
        .entries,
        vec!["txt".to_string()]
    );
    assert_eq!(
        dns::AnySoaRecord {
            nsname: "ns".to_string(),
            hostmaster: "hostmaster".to_string(),
            serial: 1,
            refresh: 2,
            retry: 3,
            expire: 4,
            minttl: 5,
        }
        .record_type(),
        "SOA"
    );
    assert_eq!(
        dns::AnyCaaRecord {
            critical: 0,
            issue: None,
            issue_wild: None,
            iodef: Some("mailto:ops@example".to_string()),
            contact_email: None,
            contact_phone: None,
        }
        .record_type(),
        "CAA"
    );
    assert_eq!(
        dns::AnyNaptrRecord {
            flags: "s".to_string(),
            service: "svc".to_string(),
            regexp: String::new(),
            replacement: "r".to_string(),
            order: 1,
            preference: 2,
        }
        .record_type(),
        "NAPTR"
    );
    assert_eq!(
        dns::AnyTlsaRecord {
            cert_usage: 3,
            selector: 1,
            match_type: 1,
            data: vec![1],
        }
        .record_type(),
        "TLSA"
    );

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
    assert!(dns::promises::lookup_one_now("localhost", lookup_options).is_ok());
    assert!(dns::promises::lookup_all_now(
        "localhost",
        dns::LookupOptions {
            all: true,
            ..lookup_options
        }
    )
    .is_ok());
    assert!(
        dns::promises::resolve_now("localhost", Some("A")).is_ok()
            || dns::promises::resolve_now("localhost", Some("AAAA")).is_ok()
    );
    assert!(
        dns::promises::resolve4_with_ttl_now("localhost").is_ok()
            || dns::promises::resolve6_with_ttl_now("localhost").is_ok()
    );
    assert!(matches!(
        dns::promises::resolve4_with_options_now("localhost", dns::ResolveOptions { ttl: false },)
            .or_else(|_| dns::promises::resolve6_with_options_now(
                "localhost",
                dns::ResolveOptions { ttl: false },
            ))
            .unwrap(),
        dns::ResolveAddressResult::Addresses(_)
    ));
    assert!(dns::promises::resolve_ns_now("localhost").is_err());
    assert!(dns::promises::resolve_ptr_now("localhost").is_err());
    assert!(dns::promises::resolve_caa_now("localhost").is_err());
    assert!(dns::promises::resolve_naptr_now("localhost").is_err());
    assert!(dns::promises::resolve_soa_now("localhost").is_err());
    assert!(dns::promises::resolve_tlsa_now("localhost").is_err());
    assert!(dns::promises::resolve_any_now("localhost").is_ok());
    assert!(dns::promises::lookup_service_now("127.0.0.1", 443).is_ok());
    assert!(dns::promises::reverse_now("127.0.0.1").is_ok());

    let mut promise_resolver = dns::promises::Resolver::with_options(dns::ResolverOptions {
        timeout: Some(500),
        tries: Some(3),
        max_timeout: Some(2_000),
    });
    assert_eq!(promise_resolver.options().tries, Some(3));
    assert!(promise_resolver
        .lookup_one("localhost", lookup_options)
        .is_ok());
    assert!(promise_resolver
        .lookup_all(
            "localhost",
            dns::LookupOptions {
                all: true,
                ..lookup_options
            },
        )
        .is_ok());
    promise_resolver.set_servers(&["9.9.9.9"]);
    assert_eq!(promise_resolver.get_servers(), vec!["9.9.9.9"]);
    promise_resolver.set_local_address(Some("127.0.0.1"), None);
    assert!(promise_resolver.lookup("localhost").is_ok());
    assert!(
        promise_resolver.resolve("localhost", Some("A")).is_ok()
            || promise_resolver.resolve("localhost", Some("AAAA")).is_ok()
    );
    assert!(
        promise_resolver.resolve4("localhost").is_ok()
            || promise_resolver.resolve6("localhost").is_ok()
    );
    assert!(
        promise_resolver.resolve4_with_ttl("localhost").is_ok()
            || promise_resolver.resolve6_with_ttl("localhost").is_ok()
    );
    assert!(matches!(
        promise_resolver
            .resolve4_with_options("localhost", dns::ResolveOptions { ttl: false })
            .or_else(|_| {
                promise_resolver
                    .resolve6_with_options("localhost", dns::ResolveOptions { ttl: false })
            })
            .unwrap(),
        dns::ResolveAddressResult::Addresses(_)
    ));
    assert!(promise_resolver.resolve_cname("localhost").is_err());
    assert!(promise_resolver.resolve_mx("localhost").is_err());
    assert!(promise_resolver.resolve_txt("localhost").is_err());
    assert!(promise_resolver.resolve_srv("localhost").is_err());
    assert!(promise_resolver.resolve_ns("localhost").is_err());
    assert!(promise_resolver.resolve_ptr("localhost").is_err());
    assert!(promise_resolver.resolve_caa("localhost").is_err());
    assert!(promise_resolver.resolve_naptr("localhost").is_err());
    assert!(promise_resolver.resolve_soa("localhost").is_err());
    assert!(promise_resolver.resolve_tlsa("localhost").is_err());
    assert!(promise_resolver.resolve_any("localhost").is_ok());
    assert!(promise_resolver.reverse("127.0.0.1").is_ok());
    promise_resolver.cancel();
    assert!(promise_resolver.cancelled());
}
