use std::collections::BTreeMap;

use tsonic_js::JsValue;

#[derive(Default)]
pub struct EventEmitter {
    listeners: BTreeMap<String, Vec<Box<dyn FnMut(&[JsValue])>>>,
    max_listeners: Option<usize>,
}

impl EventEmitter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on<F>(&mut self, event: impl Into<String>, listener: F) -> &mut Self
    where
        F: FnMut(&[JsValue]) + 'static,
    {
        self.listeners
            .entry(event.into())
            .or_default()
            .push(Box::new(listener));
        self
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
        let mut called = false;
        self.on(event, move |args| {
            if called {
                return;
            }
            called = true;
            listener(args);
        })
    }

    pub fn emit(&mut self, event: &str, args: &[JsValue]) -> bool {
        let Some(listeners) = self.listeners.get_mut(event) else {
            return false;
        };
        for listener in listeners {
            listener(args);
        }
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
