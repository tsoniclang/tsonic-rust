use std::collections::BTreeMap;

use tsonic_js::JsValue;

type Listener = Box<dyn FnMut(&[JsValue])>;
type ListenerMap = BTreeMap<String, Vec<ListenerEntry>>;

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
}

impl EventEmitter {
    pub fn new() -> Self {
        Self::default()
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
}

pub fn once<F>(emitter: &mut EventEmitter, event: impl Into<String>, listener: F)
where
    F: FnMut(&[JsValue]) + 'static,
{
    emitter.once(event, listener);
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
