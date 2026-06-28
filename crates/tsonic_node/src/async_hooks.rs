use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_ASYNC_ID: AtomicU64 = AtomicU64::new(1);

pub type InitCallback = Box<dyn FnMut(u64, &str, u64)>;
pub type AsyncIdCallback = Box<dyn FnMut(u64)>;

#[derive(Default)]
pub struct HookCallbacks {
    pub init: Option<InitCallback>,
    pub before: Option<AsyncIdCallback>,
    pub after: Option<AsyncIdCallback>,
    pub destroy: Option<AsyncIdCallback>,
    pub promise_resolve: Option<AsyncIdCallback>,
}

#[derive(Default)]
pub struct AsyncHook {
    callbacks: HookCallbacks,
    enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AsyncResource {
    async_id: u64,
    trigger_async_id: u64,
    resource_type: String,
    destroyed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AsyncResourceOptions {
    pub trigger_async_id: Option<u64>,
    pub require_manual_destroy: bool,
}

pub mod async_wrap_providers {
    pub const NONE: u32 = 0;
    pub const DIRHANDLE: u32 = 1;
    pub const DNSCHANNEL: u32 = 2;
    pub const ELDHISTOGRAM: u32 = 3;
    pub const FILEHANDLE: u32 = 4;
    pub const FILEHANDLECLOSEREQ: u32 = 5;
    pub const FSREQCALLBACK: u32 = 6;
    pub const FSREQPROMISE: u32 = 7;
    pub const GETADDRINFOREQWRAP: u32 = 8;
    pub const HTTPCLIENTREQUEST: u32 = 9;
    pub const HTTPINCOMINGMESSAGE: u32 = 10;
    pub const MESSAGEPORT: u32 = 11;
    pub const PIPEWRAP: u32 = 12;
    pub const PROCESSWRAP: u32 = 13;
    pub const PROMISE: u32 = 14;
    pub const QUERYWRAP: u32 = 15;
    pub const RANDOMBYTESREQUEST: u32 = 16;
    pub const SIGNALWRAP: u32 = 17;
    pub const TCPWRAP: u32 = 18;
    pub const TLSWRAP: u32 = 19;
    pub const TTYWRAP: u32 = 20;
    pub const UDPWRAP: u32 = 21;
    pub const WORKER: u32 = 22;
    pub const ZLIB: u32 = 23;
}

impl AsyncHook {
    pub fn new(callbacks: HookCallbacks) -> Self {
        Self {
            callbacks,
            enabled: false,
        }
    }

    pub fn enable(&mut self) -> &mut Self {
        self.enabled = true;
        self
    }

    pub fn disable(&mut self) -> &mut Self {
        self.enabled = false;
        self
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn emit_init(&mut self, async_id: u64, resource_type: &str, trigger_async_id: u64) {
        if self.enabled {
            if let Some(callback) = &mut self.callbacks.init {
                callback(async_id, resource_type, trigger_async_id);
            }
        }
    }

    pub fn emit_before(&mut self, async_id: u64) {
        if self.enabled {
            if let Some(callback) = &mut self.callbacks.before {
                callback(async_id);
            }
        }
    }

    pub fn emit_after(&mut self, async_id: u64) {
        if self.enabled {
            if let Some(callback) = &mut self.callbacks.after {
                callback(async_id);
            }
        }
    }

    pub fn emit_destroy(&mut self, async_id: u64) {
        if self.enabled {
            if let Some(callback) = &mut self.callbacks.destroy {
                callback(async_id);
            }
        }
    }

    pub fn emit_promise_resolve(&mut self, async_id: u64) {
        if self.enabled {
            if let Some(callback) = &mut self.callbacks.promise_resolve {
                callback(async_id);
            }
        }
    }
}

impl AsyncResource {
    pub fn new(resource_type: impl Into<String>, options: Option<AsyncResourceOptions>) -> Self {
        let options = options.unwrap_or(AsyncResourceOptions {
            trigger_async_id: None,
            require_manual_destroy: false,
        });
        Self {
            async_id: NEXT_ASYNC_ID.fetch_add(1, Ordering::SeqCst),
            trigger_async_id: options.trigger_async_id.unwrap_or(0),
            resource_type: resource_type.into(),
            destroyed: false,
        }
    }

    pub fn async_id(&self) -> u64 {
        self.async_id
    }

    pub fn trigger_async_id(&self) -> u64 {
        self.trigger_async_id
    }

    pub fn resource_type(&self) -> &str {
        &self.resource_type
    }

    pub fn run_in_async_scope<R>(&self, callback: impl FnOnce() -> R) -> R {
        callback()
    }

    pub fn bind<F>(&self, function: F) -> BoundAsyncFunction<F> {
        BoundAsyncFunction {
            async_id: self.async_id,
            function,
        }
    }

    pub fn emit_destroy(&mut self) -> &mut Self {
        self.destroyed = true;
        self
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }
}

pub struct BoundAsyncFunction<F> {
    async_id: u64,
    function: F,
}

impl<F> BoundAsyncFunction<F> {
    pub fn async_id(&self) -> u64 {
        self.async_id
    }

    pub fn call<R>(&self, callback: impl FnOnce(&F) -> R) -> R {
        callback(&self.function)
    }
}

pub fn create_hook(callbacks: HookCallbacks) -> AsyncHook {
    AsyncHook::new(callbacks)
}

pub fn execution_async_id() -> u64 {
    0
}

pub fn trigger_async_id() -> u64 {
    0
}

#[derive(Debug, Clone)]
pub struct AsyncLocalStorage<T: Clone> {
    stack: RefCell<Vec<T>>,
    name: Option<String>,
    default_value: Option<T>,
}

impl<T: Clone> Default for AsyncLocalStorage<T> {
    fn default() -> Self {
        Self {
            stack: RefCell::new(Vec::new()),
            name: None,
            default_value: None,
        }
    }
}

impl<T: Clone> AsyncLocalStorage<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_options(name: Option<String>, default_value: Option<T>) -> Self {
        Self {
            stack: RefCell::new(Vec::new()),
            name,
            default_value,
        }
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn run<R>(&self, store: T, callback: impl FnOnce() -> R) -> R {
        self.stack.borrow_mut().push(store);
        let result = callback();
        self.stack.borrow_mut().pop();
        result
    }

    pub fn enter_with(&self, store: T) {
        self.stack.borrow_mut().push(store);
    }

    pub fn exit<R>(&self, callback: impl FnOnce() -> R) -> R {
        let previous = self.stack.borrow_mut().pop();
        let result = callback();
        if let Some(previous) = previous {
            self.stack.borrow_mut().push(previous);
        }
        result
    }

    pub fn get_store(&self) -> Option<T> {
        self.stack
            .borrow()
            .last()
            .cloned()
            .or_else(|| self.default_value.clone())
    }

    pub fn disable(&self) {
        self.stack.borrow_mut().clear();
    }

    pub fn with_scope(&self, store: T) -> RunScope<'_, T> {
        self.enter_with(store);
        RunScope {
            storage: self,
            disposed: false,
        }
    }
}

pub struct RunScope<'a, T: Clone> {
    storage: &'a AsyncLocalStorage<T>,
    disposed: bool,
}

impl<T: Clone> RunScope<'_, T> {
    pub fn dispose(&mut self) {
        if !self.disposed {
            self.storage.stack.borrow_mut().pop();
            self.disposed = true;
        }
    }
}

impl<T: Clone> Drop for RunScope<'_, T> {
    fn drop(&mut self) {
        self.dispose();
    }
}
