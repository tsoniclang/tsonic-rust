use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use tsonic_js::JsValue;

type Subscriber = Box<dyn FnMut(&JsValue)>;
type SubscriberMap = BTreeMap<String, Vec<Subscriber>>;

thread_local! {
    static SUBSCRIBERS: RefCell<SubscriberMap> = RefCell::new(BTreeMap::new());
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Channel {
    name: String,
}

impl Channel {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn has_subscribers(&self) -> bool {
        has_subscribers(&self.name)
    }

    pub fn subscribe<F>(&self, subscriber: F)
    where
        F: FnMut(&JsValue) + 'static,
    {
        subscribe(&self.name, subscriber);
    }

    pub fn publish(&self, message: &JsValue) -> bool {
        publish(&self.name, message)
    }
}

pub fn channel(name: impl Into<String>) -> Channel {
    Channel { name: name.into() }
}

pub fn subscribe<F>(name: &str, subscriber: F)
where
    F: FnMut(&JsValue) + 'static,
{
    SUBSCRIBERS.with(|subscribers| {
        subscribers
            .borrow_mut()
            .entry(name.to_string())
            .or_default()
            .push(Box::new(subscriber));
    });
}

pub fn has_subscribers(name: &str) -> bool {
    SUBSCRIBERS.with(|subscribers| {
        subscribers
            .borrow()
            .get(name)
            .is_some_and(|items| !items.is_empty())
    })
}

pub fn publish(name: &str, message: &JsValue) -> bool {
    SUBSCRIBERS.with(|subscribers| {
        let mut subscribers = subscribers.borrow_mut();
        let Some(items) = subscribers.get_mut(name) else {
            return false;
        };
        for item in items {
            item(message);
        }
        true
    })
}

pub fn unsubscribe_all(name: &str) {
    SUBSCRIBERS.with(|subscribers| {
        subscribers.borrow_mut().remove(name);
    });
}

pub fn channel_names() -> Vec<String> {
    SUBSCRIBERS.with(|subscribers| {
        subscribers
            .borrow()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    })
}
