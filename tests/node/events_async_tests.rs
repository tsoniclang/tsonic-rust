use std::cell::RefCell;
use std::rc::Rc;

use tsonic_js::JsValue;
use tsonic_node::{async_hooks::AsyncLocalStorage, diagnostics_channel, events::EventEmitter};

#[test]
fn event_emitter_dispatches_in_registration_order() {
    let seen = Rc::new(RefCell::new(Vec::new()));
    let mut emitter = EventEmitter::new();
    let first = Rc::clone(&seen);
    emitter.on("data", move |args| {
        first
            .borrow_mut()
            .push(format!("first:{}", args.first().unwrap()));
    });
    let second = Rc::clone(&seen);
    emitter.once("data", move |args| {
        second
            .borrow_mut()
            .push(format!("once:{}", args.first().unwrap()));
    });

    assert_eq!(emitter.listener_count("data"), 2);
    assert!(emitter.emit("data", &[JsValue::String("a".to_string())]));
    assert!(emitter.emit("data", &[JsValue::String("b".to_string())]));
    assert_eq!(
        seen.borrow().as_slice(),
        &[
            "first:\"a\"".to_string(),
            "once:\"a\"".to_string(),
            "first:\"b\"".to_string()
        ]
    );
    assert_eq!(emitter.event_names(), vec!["data".to_string()]);
    emitter.remove_all_listeners(Some("data"));
    assert_eq!(emitter.listener_count("data"), 0);
}

#[test]
fn event_emitter_supports_prepend_remove_and_static_helpers() {
    let seen = Rc::new(RefCell::new(Vec::new()));
    let mut emitter = EventEmitter::new();

    let first = Rc::clone(&seen);
    let first_id = emitter.on_with_id("ready", move |_| first.borrow_mut().push("first"));
    let prepended = Rc::clone(&seen);
    let prepended_id = emitter
        .prepend_listener_with_id("ready", move |_| prepended.borrow_mut().push("prepended"));
    let once = Rc::clone(&seen);
    emitter.prepend_once_listener("ready", move |_| once.borrow_mut().push("once"));

    assert_eq!(emitter.listeners("ready"), vec![3, prepended_id, first_id]);
    assert_eq!(
        tsonic_node::events::get_event_listeners(&emitter, "ready"),
        emitter.raw_listeners("ready")
    );
    assert!(emitter.emit("ready", &[]));
    assert!(emitter.emit("ready", &[]));
    assert_eq!(
        seen.borrow().as_slice(),
        &["once", "prepended", "first", "prepended", "first"]
    );

    emitter.off("ready", prepended_id);
    assert_eq!(emitter.listeners("ready"), vec![first_id]);
    emitter.remove_listener("ready", first_id);
    assert_eq!(emitter.listener_count("ready"), 0);

    let mut one = EventEmitter::new();
    let mut two = EventEmitter::new();
    tsonic_node::events::set_max_listeners(7, &mut [&mut one, &mut two]);
    assert_eq!(one.get_max_listeners(), Some(7));
    assert_eq!(two.get_max_listeners(), Some(7));
}

#[test]
fn async_local_storage_tracks_nested_store_scope() {
    let storage = AsyncLocalStorage::new();
    assert_eq!(storage.get_store(), None);
    let result = storage.run("outer".to_string(), || {
        assert_eq!(storage.get_store().as_deref(), Some("outer"));
        storage.run("inner".to_string(), || {
            assert_eq!(storage.get_store().as_deref(), Some("inner"));
            42
        })
    });
    assert_eq!(result, 42);
    assert_eq!(storage.get_store(), None);
}

#[test]
fn diagnostics_channel_publishes_to_named_subscribers() {
    let name = "tsonic.test.channel";
    diagnostics_channel::unsubscribe_all(name);
    let seen = Rc::new(RefCell::new(Vec::new()));
    let target = Rc::clone(&seen);
    let channel = diagnostics_channel::channel(name);
    channel.subscribe(move |message| target.borrow_mut().push(message.to_string()));

    assert!(channel.has_subscribers());
    assert!(channel.publish(&JsValue::String("payload".to_string())));
    assert_eq!(seen.borrow().as_slice(), &["\"payload\"".to_string()]);
    assert!(diagnostics_channel::channel_names().contains(&name.to_string()));
    diagnostics_channel::unsubscribe_all(name);
}
