use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};

use tsonic_js::JsValue;

type Subscriber = Box<dyn FnMut(&JsValue)>;
type SubscriberMap = BTreeMap<String, Vec<SubscriberEntry>>;

struct SubscriberEntry {
    id: u64,
    callback: Subscriber,
}

thread_local! {
    static SUBSCRIBERS: RefCell<SubscriberMap> = const { RefCell::new(BTreeMap::new()) };
    static NEXT_SUBSCRIBER_ID: Cell<u64> = const { Cell::new(1) };
    static STORE_BINDINGS: RefCell<BTreeMap<String, usize>> = const { RefCell::new(BTreeMap::new()) };
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Channel {
    name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TraceCall {
    pub context: JsValue,
    pub this_arg: Option<JsValue>,
    pub position: Option<usize>,
}

impl TraceCall {
    pub fn new(context: JsValue) -> Self {
        Self {
            context,
            this_arg: None,
            position: None,
        }
    }
}

impl Channel {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn has_subscribers(&self) -> bool {
        has_subscribers(&self.name)
    }

    pub fn subscribe<F>(&self, subscriber: F) -> u64
    where
        F: FnMut(&JsValue) + 'static,
    {
        subscribe_with_id(&self.name, subscriber)
    }

    pub fn unsubscribe(&self, subscriber_id: u64) -> bool {
        unsubscribe(&self.name, subscriber_id)
    }

    pub fn publish(&self, message: &JsValue) -> bool {
        publish(&self.name, message)
    }

    pub fn bind_store(&self) {
        bind_store(&self.name);
    }

    pub fn unbind_store(&self) -> bool {
        unbind_store(&self.name)
    }

    pub fn bound_store_count(&self) -> usize {
        bound_store_count(&self.name)
    }

    pub fn trace<Result>(&self, call: &TraceCall, function: impl FnOnce() -> Result) -> Result {
        self.publish(&call.context);
        function()
    }
}

pub fn channel(name: impl Into<String>) -> Channel {
    Channel { name: name.into() }
}

pub fn subscribe<F>(name: &str, subscriber: F)
where
    F: FnMut(&JsValue) + 'static,
{
    let _ = subscribe_with_id(name, subscriber);
}

pub fn subscribe_with_id<F>(name: &str, subscriber: F) -> u64
where
    F: FnMut(&JsValue) + 'static,
{
    let id = next_subscriber_id();
    SUBSCRIBERS.with(|subscribers| {
        subscribers
            .borrow_mut()
            .entry(name.to_string())
            .or_default()
            .push(SubscriberEntry {
                id,
                callback: Box::new(subscriber),
            });
    });
    id
}

pub fn unsubscribe(name: &str, subscriber_id: u64) -> bool {
    SUBSCRIBERS.with(|subscribers| {
        let mut subscribers = subscribers.borrow_mut();
        let Some(items) = subscribers.get_mut(name) else {
            return false;
        };
        let before = items.len();
        items.retain(|entry| entry.id != subscriber_id);
        let is_empty = items.is_empty();
        let changed = before != items.len();
        if is_empty {
            subscribers.remove(name);
        }
        changed
    })
}

fn next_subscriber_id() -> u64 {
    NEXT_SUBSCRIBER_ID.with(|next| {
        let id = next.get();
        next.set(id + 1);
        id
    })
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
            (item.callback)(message);
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

pub fn bind_store(name: &str) {
    STORE_BINDINGS.with(|bindings| {
        let mut bindings = bindings.borrow_mut();
        *bindings.entry(name.to_string()).or_default() += 1;
    });
}

pub fn unbind_store(name: &str) -> bool {
    STORE_BINDINGS.with(|bindings| {
        let mut bindings = bindings.borrow_mut();
        let Some(count) = bindings.get_mut(name) else {
            return false;
        };
        *count = count.saturating_sub(1);
        if *count == 0 {
            bindings.remove(name);
        }
        true
    })
}

pub fn bound_store_count(name: &str) -> usize {
    STORE_BINDINGS.with(|bindings| bindings.borrow().get(name).copied().unwrap_or(0))
}

pub struct TracingChannelSubscribers {
    pub start: Option<Subscriber>,
    pub end: Option<Subscriber>,
    pub async_start: Option<Subscriber>,
    pub async_end: Option<Subscriber>,
    pub error: Option<Subscriber>,
}

impl TracingChannelSubscribers {
    pub fn empty() -> Self {
        Self {
            start: None,
            end: None,
            async_start: None,
            async_end: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TracingSubscription {
    start: Option<u64>,
    end: Option<u64>,
    async_start: Option<u64>,
    async_end: Option<u64>,
    error: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TracingChannel {
    name: String,
    start: Channel,
    end: Channel,
    async_start: Channel,
    async_end: Channel,
    error: Channel,
}

pub type TracingChannelCollection = TracingChannel;

impl TracingChannel {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn start(&self) -> &Channel {
        &self.start
    }

    pub fn end(&self) -> &Channel {
        &self.end
    }

    pub fn async_start(&self) -> &Channel {
        &self.async_start
    }

    pub fn async_end(&self) -> &Channel {
        &self.async_end
    }

    pub fn error(&self) -> &Channel {
        &self.error
    }

    pub fn has_subscribers(&self) -> bool {
        self.start.has_subscribers()
            || self.end.has_subscribers()
            || self.async_start.has_subscribers()
            || self.async_end.has_subscribers()
            || self.error.has_subscribers()
    }

    pub fn subscribe(&self, mut subscribers: TracingChannelSubscribers) -> TracingSubscription {
        TracingSubscription {
            start: subscribers
                .start
                .take()
                .map(|subscriber| subscribe_boxed(self.start.name(), subscriber)),
            end: subscribers
                .end
                .take()
                .map(|subscriber| subscribe_boxed(self.end.name(), subscriber)),
            async_start: subscribers
                .async_start
                .take()
                .map(|subscriber| subscribe_boxed(self.async_start.name(), subscriber)),
            async_end: subscribers
                .async_end
                .take()
                .map(|subscriber| subscribe_boxed(self.async_end.name(), subscriber)),
            error: subscribers
                .error
                .take()
                .map(|subscriber| subscribe_boxed(self.error.name(), subscriber)),
        }
    }

    pub fn unsubscribe(&self, subscription: &TracingSubscription) {
        if let Some(id) = subscription.start {
            self.start.unsubscribe(id);
        }
        if let Some(id) = subscription.end {
            self.end.unsubscribe(id);
        }
        if let Some(id) = subscription.async_start {
            self.async_start.unsubscribe(id);
        }
        if let Some(id) = subscription.async_end {
            self.async_end.unsubscribe(id);
        }
        if let Some(id) = subscription.error {
            self.error.unsubscribe(id);
        }
    }

    pub fn trace_sync<Result>(
        &self,
        call: &TraceCall,
        function: impl FnOnce() -> Result,
    ) -> Result {
        self.start.publish(&call.context);
        let result = function();
        self.end.publish(&call.context);
        result
    }

    pub fn trace_async<Result>(
        &self,
        call: &TraceCall,
        function: impl FnOnce() -> Result,
    ) -> Result {
        self.async_start.publish(&call.context);
        let result = function();
        self.async_end.publish(&call.context);
        result
    }

    pub fn trace_callback<Result>(
        &self,
        call: &TraceCall,
        function: impl FnOnce() -> Result,
    ) -> Result {
        self.trace_sync(call, function)
    }
}

pub fn tracing_channel(name: impl Into<String>) -> TracingChannel {
    let name = name.into();
    TracingChannel {
        start: channel(format!("{name}:start")),
        end: channel(format!("{name}:end")),
        async_start: channel(format!("{name}:async_start")),
        async_end: channel(format!("{name}:async_end")),
        error: channel(format!("{name}:error")),
        name,
    }
}

fn subscribe_boxed(name: &str, subscriber: Subscriber) -> u64 {
    let id = next_subscriber_id();
    SUBSCRIBERS.with(|subscribers| {
        subscribers
            .borrow_mut()
            .entry(name.to_string())
            .or_default()
            .push(SubscriberEntry {
                id,
                callback: subscriber,
            });
    });
    id
}
