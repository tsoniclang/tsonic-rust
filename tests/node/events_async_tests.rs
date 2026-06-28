use std::cell::RefCell;
use std::rc::Rc;

use tsonic_js::JsValue;
use tsonic_node::{
    async_hooks::{self, AsyncLocalStorage},
    diagnostics_channel,
    events::{EventEmitter, EventEmitterAsyncResource, NodeEventTarget},
};

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

    let capturing = EventEmitter::with_options(tsonic_node::events::EventEmitterOptions {
        capture_rejections: true,
    });
    assert!(capturing.capture_rejections());
}

#[test]
fn node_event_target_and_async_resource_shapes_forward_events() {
    let seen = Rc::new(RefCell::new(Vec::new()));
    let mut target = NodeEventTarget::new();
    let target_seen = Rc::clone(&seen);
    target.on("message", move |args| {
        target_seen.borrow_mut().push(args[0].inspect());
    });
    target.set_max_listeners(4);
    assert_eq!(target.get_max_listeners(), Some(4));
    assert!(target.emit("message", &[JsValue::String("hello".to_string())]));
    assert_eq!(target.event_names(), vec!["message".to_string()]);
    assert_eq!(target.listener_count("message"), 1);
    assert_eq!(seen.borrow().as_slice(), &["\"hello\"".to_string()]);

    let mut resource =
        EventEmitterAsyncResource::new(tsonic_node::events::EventEmitterAsyncResourceOptions {
            name: Some("resource".to_string()),
            trigger_async_id: Some(10),
            require_manual_destroy: true,
            capture_rejections: true,
        });
    assert_eq!(resource.trigger_async_id(), 10);
    assert!(resource.async_id() > 0);
    assert!(resource.event_emitter().capture_rejections());
    let resource_seen = Rc::clone(&seen);
    resource.event_emitter_mut().on("done", move |_| {
        resource_seen.borrow_mut().push("done".to_string())
    });
    assert!(resource.event_emitter_mut().emit("done", &[]));
    resource.emit_destroy();
    assert!(resource.async_resource().destroyed());
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

    let storage =
        AsyncLocalStorage::with_options(Some("request".to_string()), Some("default".to_string()));
    assert_eq!(storage.name(), Some("request"));
    assert_eq!(storage.get_store().as_deref(), Some("default"));
    {
        let mut scope = storage.with_scope("scoped".to_string());
        assert_eq!(storage.get_store().as_deref(), Some("scoped"));
        scope.dispose();
    }
    assert_eq!(storage.get_store().as_deref(), Some("default"));
}

#[test]
fn async_hooks_resource_and_hook_callbacks_are_closed_shapes() {
    let seen = Rc::new(RefCell::new(Vec::new()));
    let init_seen = Rc::clone(&seen);
    let before_seen = Rc::clone(&seen);
    let after_seen = Rc::clone(&seen);
    let destroy_seen = Rc::clone(&seen);
    let promise_seen = Rc::clone(&seen);
    let mut hook = async_hooks::create_hook(async_hooks::HookCallbacks {
        init: Some(Box::new(move |id, resource_type, trigger| {
            init_seen
                .borrow_mut()
                .push(format!("init:{id}:{resource_type}:{trigger}"));
        })),
        before: Some(Box::new(move |id| {
            before_seen.borrow_mut().push(format!("before:{id}"))
        })),
        after: Some(Box::new(move |id| {
            after_seen.borrow_mut().push(format!("after:{id}"))
        })),
        destroy: Some(Box::new(move |id| {
            destroy_seen.borrow_mut().push(format!("destroy:{id}"));
        })),
        promise_resolve: Some(Box::new(move |id| {
            promise_seen.borrow_mut().push(format!("promise:{id}"));
        })),
    });
    assert!(!hook.enabled());
    hook.enable();

    let mut resource = async_hooks::AsyncResource::new(
        "HTTPCLIENTREQUEST",
        Some(async_hooks::AsyncResourceOptions {
            trigger_async_id: 7.into(),
            require_manual_destroy: true,
        }),
    );
    assert_eq!(resource.resource_type(), "HTTPCLIENTREQUEST");
    assert_eq!(resource.trigger_async_id(), 7);
    hook.emit_init(
        resource.async_id(),
        resource.resource_type(),
        resource.trigger_async_id(),
    );
    hook.emit_before(resource.async_id());
    assert_eq!(resource.run_in_async_scope(|| 5), 5);
    let bound = resource.bind(|value: i32| value + 1);
    assert_eq!(bound.async_id(), resource.async_id());
    assert_eq!(bound.call(|function| function(2)), 3);
    hook.emit_after(resource.async_id());
    hook.emit_promise_resolve(resource.async_id());
    resource.emit_destroy();
    hook.emit_destroy(resource.async_id());
    assert!(resource.destroyed());
    hook.disable();
    hook.emit_before(resource.async_id());
    assert_eq!(async_hooks::execution_async_id(), 0);
    assert_eq!(async_hooks::trigger_async_id(), 0);
    assert_eq!(async_hooks::async_wrap_providers::HTTPCLIENTREQUEST, 9);
    assert!(seen.borrow().iter().any(|entry| entry.starts_with("init:")));
    assert!(seen
        .borrow()
        .iter()
        .any(|entry| entry.starts_with("promise:")));
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
