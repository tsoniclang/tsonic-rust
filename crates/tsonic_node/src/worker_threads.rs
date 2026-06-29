use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};

use tsonic_js::JsValue;

use crate::error::{NodeError, NodeResult};

pub struct MessagePort {
    sender: Sender<JsValue>,
    receiver: Receiver<JsValue>,
    closed: bool,
    refed: Cell<bool>,
}

impl MessagePort {
    pub fn post_message(&self, value: JsValue) -> NodeResult<()> {
        if self.closed {
            return Err(NodeError::new(
                "ERR_CLOSED_MESSAGE_PORT",
                "message port is closed",
            ));
        }
        self.sender
            .send(value)
            .map_err(|error| NodeError::new("ERR_CLOSED_MESSAGE_PORT", error.to_string()))
    }

    pub fn receive_message(&self) -> Option<JsValue> {
        self.receiver.try_recv().ok()
    }

    pub fn close(&mut self) {
        self.closed = true;
        self.refed.set(false);
    }

    pub fn start(&self) {}

    pub fn unref(&self) {
        self.refed.set(false);
    }

    pub fn r#ref(&self) {
        self.refed.set(true);
    }

    pub fn has_ref(&self) -> bool {
        self.refed.get()
    }
}

pub struct MessageChannel {
    pub port1: MessagePort,
    pub port2: MessagePort,
}

impl MessageChannel {
    pub fn new() -> Self {
        let (sender1, receiver1) = mpsc::channel();
        let (sender2, receiver2) = mpsc::channel();
        Self {
            port1: MessagePort {
                sender: sender1,
                receiver: receiver2,
                closed: false,
                refed: Cell::new(true),
            },
            port2: MessagePort {
                sender: sender2,
                receiver: receiver1,
                closed: false,
                refed: Cell::new(true),
            },
        }
    }
}

impl Default for MessageChannel {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ResourceLimits {
    pub max_old_generation_size_mb: Option<usize>,
    pub max_young_generation_size_mb: Option<usize>,
    pub code_range_size_mb: Option<usize>,
    pub stack_size_mb: Option<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkerOptions {
    pub name: Option<String>,
    pub argv: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub worker_data: JsValue,
    pub resource_limits: ResourceLimits,
}

impl Default for WorkerOptions {
    fn default() -> Self {
        Self {
            name: None,
            argv: Vec::new(),
            env: BTreeMap::new(),
            worker_data: JsValue::Undefined,
            resource_limits: ResourceLimits::default(),
        }
    }
}

pub struct Worker<T> {
    handle: Option<JoinHandle<T>>,
    thread_id: u64,
    name: Option<String>,
    resource_limits: ResourceLimits,
    refed: bool,
}

impl<T: Send + 'static> Worker<T> {
    pub fn spawn(task: impl FnOnce() -> T + Send + 'static) -> Self {
        Self::spawn_with_options(task, WorkerOptions::default())
    }

    pub fn spawn_with_options(
        task: impl FnOnce() -> T + Send + 'static,
        options: WorkerOptions,
    ) -> Self {
        Self {
            handle: Some(thread::spawn(task)),
            thread_id: NEXT_THREAD_ID.fetch_add(1, Ordering::SeqCst),
            name: options.name,
            resource_limits: options.resource_limits,
            refed: true,
        }
    }

    pub fn join(mut self) -> NodeResult<T> {
        let handle = self
            .handle
            .take()
            .ok_or_else(|| NodeError::new("ERR_WORKER_NOT_RUNNING", "worker already joined"))?;
        handle
            .join()
            .map_err(|_| NodeError::new("ERR_WORKER_FAILURE", "worker panicked"))
    }

    pub fn thread_id(&self) -> u64 {
        self.thread_id
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn resource_limits(&self) -> &ResourceLimits {
        &self.resource_limits
    }

    pub fn unref(&mut self) {
        self.refed = false;
    }

    pub fn r#ref(&mut self) {
        self.refed = true;
    }

    pub fn has_ref(&self) -> bool {
        self.refed
    }
}

pub fn receive_message_on_port(port: &MessagePort) -> Option<JsValue> {
    port.receive_message()
}

pub fn is_main_thread() -> bool {
    true
}

pub fn parent_port() -> Option<MessagePort> {
    None
}

pub fn worker_data() -> JsValue {
    JsValue::Undefined
}

pub fn set_environment_data(key: &str, value: JsValue) {
    environment_data()
        .lock()
        .unwrap()
        .insert(key.to_string(), value);
}

pub fn get_environment_data(key: &str) -> Option<JsValue> {
    environment_data().lock().unwrap().get(key).cloned()
}

pub fn mark_as_untransferable_token(token: &str) {
    untransferable_tokens()
        .lock()
        .unwrap()
        .insert(token.to_string());
}

pub fn is_marked_as_untransferable_token(token: &str) -> bool {
    untransferable_tokens().lock().unwrap().contains(token)
}

pub fn move_message_port_to_context(port: MessagePort) -> MessagePort {
    port
}

#[derive(Debug, Clone)]
pub struct BroadcastChannel {
    name: String,
}

impl BroadcastChannel {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn post_message(&self, value: JsValue) {
        broadcast_table()
            .lock()
            .unwrap()
            .entry(self.name.clone())
            .or_default()
            .push(value);
    }

    pub fn receive_message(&self) -> Option<JsValue> {
        let mut table = broadcast_table().lock().unwrap();
        table.get_mut(&self.name).and_then(|values| {
            if values.is_empty() {
                None
            } else {
                Some(values.remove(0))
            }
        })
    }

    pub fn close(&self) {}
}

static BROADCAST_TABLE: OnceLock<Mutex<std::collections::BTreeMap<String, Vec<JsValue>>>> =
    OnceLock::new();
static ENVIRONMENT_DATA: OnceLock<Mutex<BTreeMap<String, JsValue>>> = OnceLock::new();
static UNTRANSFERABLE_TOKENS: OnceLock<Mutex<BTreeSet<String>>> = OnceLock::new();
static NEXT_THREAD_ID: AtomicU64 = AtomicU64::new(1);

fn broadcast_table() -> &'static Mutex<std::collections::BTreeMap<String, Vec<JsValue>>> {
    BROADCAST_TABLE.get_or_init(|| Mutex::new(std::collections::BTreeMap::new()))
}

fn environment_data() -> &'static Mutex<BTreeMap<String, JsValue>> {
    ENVIRONMENT_DATA.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn untransferable_tokens() -> &'static Mutex<BTreeSet<String>> {
    UNTRANSFERABLE_TOKENS.get_or_init(|| Mutex::new(BTreeSet::new()))
}
