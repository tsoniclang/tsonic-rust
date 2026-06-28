use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use tsonic_js::JsValue;

use crate::async_hooks::{AsyncResource, AsyncResourceOptions};

type Listener = Box<dyn FnMut(&[JsValue])>;
type ListenerMap = BTreeMap<String, Vec<ListenerEntry>>;
static DEFAULT_MAX_LISTENERS: AtomicUsize = AtomicUsize::new(10);
static CAPTURE_REJECTIONS: AtomicBool = AtomicBool::new(false);

pub const ERROR_MONITOR: &str = "events.errorMonitor";
pub const CAPTURE_REJECTION_SYMBOL: &str = "events.captureRejectionSymbol";

struct ListenerEntry {
    id: usize,
    once: bool,
    callback: Listener,
}

#[derive(Default)]
pub struct EventEmitter {
    listeners: ListenerMap,
    max_listeners: Option<usize>,
    next_listener_id: usize,
    capture_rejections: bool,
}

impl EventEmitter {
    pub fn new() -> Self {
        Self {
            max_listeners: Some(default_max_listeners()),
            capture_rejections: capture_rejections(),
            ..Self::default()
        }
    }

    pub fn with_options(options: EventEmitterOptions) -> Self {
        Self {
            max_listeners: Some(default_max_listeners()),
            capture_rejections: options.capture_rejections,
            ..Self::default()
        }
    }

    pub fn capture_rejections(&self) -> bool {
        self.capture_rejections
    }

    pub fn on<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), false, false, listener);
        self
    }

    pub fn on_with_id<F>(&mut self, event: impl Into<String>, listener: F) -> usize
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), false, false, listener)
    }

    pub fn prepend_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), false, true, listener);
        self
    }

    pub fn prepend_listener_with_id<F>(&mut self, event: impl Into<String>, listener: F) -> usize
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), false, true, listener)
    }

    fn add_entry<F>(&mut self, event: String, once: bool, prepend: bool, listener: F) -> usize
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.next_listener_id += 1;
        let id = self.next_listener_id;
        let entry = ListenerEntry {
            id,
            once,
            callback: Box::new(listener),
        };
        let listeners = self.listeners.entry(event).or_default();
        if prepend {
            listeners.insert(0, entry);
        } else {
            listeners.push(entry);
        }
        id
    }

    pub fn off_by_id(&mut self, event: &str, listener_id: usize) -> &mut Self {
        if let Some(listeners) = self.listeners.get_mut(event) {
            listeners.retain(|listener| listener.id != listener_id);
        }
        self
    }

    pub fn remove_listener_by_id(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.off_by_id(event, listener_id)
    }

    pub fn remove_listener(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.off_by_id(event, listener_id)
    }

    pub fn off(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.off_by_id(event, listener_id)
    }

    pub fn listeners(&self, event: &str) -> Vec<usize> {
        self.listeners
            .get(event)
            .map(|listeners| listeners.iter().map(|listener| listener.id).collect())
            .unwrap_or_default()
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<usize> {
        self.listeners(event)
    }

    pub fn add_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.on(event, listener)
    }

    pub fn once<F>(&mut self, event: impl Into<String>, mut listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), true, false, move |args| listener(args));
        self
    }

    pub fn once_with_id<F>(&mut self, event: impl Into<String>, mut listener: F) -> usize
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), true, false, move |args| listener(args))
    }

    pub fn prepend_once_listener<F>(
        &mut self,
        event: impl Into<String>,
        mut listener: F,
    ) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), true, true, move |args| listener(args));
        self
    }

    pub fn prepend_once_listener_with_id<F>(
        &mut self,
        event: impl Into<String>,
        mut listener: F,
    ) -> usize
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.add_entry(event.into(), true, true, move |args| listener(args))
    }

    pub fn emit(&mut self, event: &str, args: &[JsValue]) -> bool {
        let Some(listeners) = self.listeners.get_mut(event) else {
            return false;
        };
        for listener in listeners.iter_mut() {
            (listener.callback)(args);
        }
        listeners.retain(|listener| !listener.once);
        true
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.listeners.get(event).map_or(0, Vec::len)
    }

    pub fn event_names(&self) -> Vec<String> {
        self.listeners.keys().cloned().collect()
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        if let Some(event) = event {
            self.listeners.remove(event);
        } else {
            self.listeners.clear();
        }
        self
    }

    pub fn set_max_listeners(&mut self, max: usize) -> &mut Self {
        self.max_listeners = Some(max);
        self
    }

    pub fn get_max_listeners(&self) -> Option<usize> {
        self.max_listeners
    }

    pub fn has_listeners(&self, event: &str) -> bool {
        self.listener_count(event) > 0
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EventEmitterOptions {
    pub capture_rejections: bool,
}

pub struct NodeEventTarget {
    emitter: EventEmitter,
}

impl Default for NodeEventTarget {
    fn default() -> Self {
        Self::new()
    }
}

impl NodeEventTarget {
    pub fn new() -> Self {
        Self {
            emitter: EventEmitter::new(),
        }
    }

    pub fn on<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.on(event, listener);
        self
    }

    pub fn add_listener<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.on(event, listener)
    }

    pub fn once<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.emitter.once(event, listener);
        self
    }

    pub fn off(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.emitter.off(event, listener_id);
        self
    }

    pub fn remove_listener(&mut self, event: &str, listener_id: usize) -> &mut Self {
        self.off(event, listener_id)
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.emitter.remove_all_listeners(event);
        self
    }

    pub fn emit(&mut self, event: &str, args: &[JsValue]) -> bool {
        self.emitter.emit(event, args)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.emitter.listener_count(event)
    }

    pub fn event_names(&self) -> Vec<String> {
        self.emitter.event_names()
    }

    pub fn set_max_listeners(&mut self, max: usize) {
        self.emitter.set_max_listeners(max);
    }

    pub fn get_max_listeners(&self) -> Option<usize> {
        self.emitter.get_max_listeners()
    }
}

pub struct EventEmitterAsyncResource {
    emitter: EventEmitter,
    async_resource: AsyncResource,
}

impl EventEmitterAsyncResource {
    pub fn new(options: EventEmitterAsyncResourceOptions) -> Self {
        let async_resource = AsyncResource::new(
            options.name.unwrap_or_else(|| "EventEmitter".to_string()),
            Some(AsyncResourceOptions {
                trigger_async_id: options.trigger_async_id,
                require_manual_destroy: options.require_manual_destroy,
            }),
        );
        Self {
            emitter: EventEmitter::with_options(EventEmitterOptions {
                capture_rejections: options.capture_rejections,
            }),
            async_resource,
        }
    }

    pub fn event_emitter(&self) -> &EventEmitter {
        &self.emitter
    }

    pub fn event_emitter_mut(&mut self) -> &mut EventEmitter {
        &mut self.emitter
    }

    pub fn async_resource(&self) -> &AsyncResource {
        &self.async_resource
    }

    pub fn async_id(&self) -> u64 {
        self.async_resource.async_id()
    }

    pub fn trigger_async_id(&self) -> u64 {
        self.async_resource.trigger_async_id()
    }

    pub fn emit_destroy(&mut self) {
        self.async_resource.emit_destroy();
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EventEmitterAsyncResourceOptions {
    pub name: Option<String>,
    pub trigger_async_id: Option<u64>,
    pub require_manual_destroy: bool,
    pub capture_rejections: bool,
}

pub fn once<F>(emitter: &mut EventEmitter, event: impl Into<String>, listener: F)
where
    F: FnMut(&[JsValue]) + 'static,
{
    emitter.once(event, listener);
}

pub fn on<F>(emitter: &mut EventEmitter, event: impl Into<String>, listener: F)
where
    F: FnMut(&[JsValue]) + 'static,
{
    emitter.on(event, listener);
}

pub fn listener_count(emitter: &EventEmitter, event: &str) -> usize {
    emitter.listener_count(event)
}

pub fn get_event_listeners(emitter: &EventEmitter, event: &str) -> Vec<usize> {
    emitter.listeners(event)
}

pub fn set_max_listeners(max: usize, emitters: &mut [&mut EventEmitter]) {
    for emitter in emitters {
        emitter.set_max_listeners(max);
    }
}

pub fn default_max_listeners() -> usize {
    DEFAULT_MAX_LISTENERS.load(Ordering::SeqCst)
}

pub fn set_default_max_listeners(max: usize) {
    DEFAULT_MAX_LISTENERS.store(max, Ordering::SeqCst);
}

pub fn capture_rejections() -> bool {
    CAPTURE_REJECTIONS.load(Ordering::SeqCst)
}

pub fn set_capture_rejections(value: bool) {
    CAPTURE_REJECTIONS.store(value, Ordering::SeqCst);
}

pub fn error_monitor() -> &'static str {
    ERROR_MONITOR
}

pub fn capture_rejection_symbol() -> &'static str {
    CAPTURE_REJECTION_SYMBOL
}
