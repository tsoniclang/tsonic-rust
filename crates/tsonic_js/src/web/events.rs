use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::array_buffer::ArrayBuffer;
use crate::errors::{type_error, JsResult};
use crate::json;
use crate::value::JsValue;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomException {
    name: String,
    message: String,
    code: u16,
}

impl DomException {
    pub const INDEX_SIZE_ERR: u16 = 1;
    pub const DOMSTRING_SIZE_ERR: u16 = 2;
    pub const HIERARCHY_REQUEST_ERR: u16 = 3;
    pub const WRONG_DOCUMENT_ERR: u16 = 4;
    pub const INVALID_CHARACTER_ERR: u16 = 5;
    pub const NO_DATA_ALLOWED_ERR: u16 = 6;
    pub const NO_MODIFICATION_ALLOWED_ERR: u16 = 7;
    pub const NOT_FOUND_ERR: u16 = 8;
    pub const NOT_SUPPORTED_ERR: u16 = 9;
    pub const INUSE_ATTRIBUTE_ERR: u16 = 10;
    pub const INVALID_STATE_ERR: u16 = 11;
    pub const SYNTAX_ERR: u16 = 12;
    pub const INVALID_MODIFICATION_ERR: u16 = 13;
    pub const NAMESPACE_ERR: u16 = 14;
    pub const INVALID_ACCESS_ERR: u16 = 15;
    pub const VALIDATION_ERR: u16 = 16;
    pub const TYPE_MISMATCH_ERR: u16 = 17;
    pub const SECURITY_ERR: u16 = 18;
    pub const NETWORK_ERR: u16 = 19;
    pub const ABORT_ERR: u16 = 20;
    pub const URL_MISMATCH_ERR: u16 = 21;
    pub const QUOTA_EXCEEDED_ERR: u16 = 22;
    pub const TIMEOUT_ERR: u16 = 23;
    pub const INVALID_NODE_TYPE_ERR: u16 = 24;
    pub const DATA_CLONE_ERR: u16 = 25;

    pub fn new(message: impl Into<String>, name: impl Into<String>) -> Self {
        let name = name.into();
        let code = dom_exception_code(&name);
        Self {
            name,
            message: message.into(),
            code,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn code(&self) -> u16 {
        self.code
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    event_type: String,
    bubbles: bool,
    cancelable: bool,
    composed: bool,
    default_prevented: bool,
    propagation_stopped: bool,
    immediate_propagation_stopped: bool,
    time_stamp: f64,
    is_trusted: bool,
    event_phase: u8,
    target: Option<String>,
    current_target: Option<String>,
    src_element: Option<String>,
}

impl Event {
    pub fn new(event_type: impl Into<String>, init: EventInit) -> Self {
        Self {
            event_type: event_type.into(),
            bubbles: init.bubbles,
            cancelable: init.cancelable,
            composed: init.composed,
            default_prevented: false,
            propagation_stopped: false,
            immediate_propagation_stopped: false,
            time_stamp: now_millis(),
            is_trusted: false,
            event_phase: 0,
            target: None,
            current_target: None,
            src_element: None,
        }
    }

    pub fn event_type(&self) -> &str {
        &self.event_type
    }

    pub fn bubbles(&self) -> bool {
        self.bubbles
    }

    pub fn cancelable(&self) -> bool {
        self.cancelable
    }

    pub fn composed(&self) -> bool {
        self.composed
    }

    pub fn default_prevented(&self) -> bool {
        self.default_prevented
    }

    pub fn cancel_bubble(&self) -> bool {
        self.propagation_stopped
    }

    pub fn return_value(&self) -> bool {
        !self.default_prevented
    }

    pub fn time_stamp(&self) -> f64 {
        self.time_stamp
    }

    pub fn is_trusted(&self) -> bool {
        self.is_trusted
    }

    pub fn event_phase(&self) -> u8 {
        self.event_phase
    }

    pub fn target(&self) -> Option<&str> {
        self.target.as_deref()
    }

    pub fn current_target(&self) -> Option<&str> {
        self.current_target.as_deref()
    }

    pub fn src_element(&self) -> Option<&str> {
        self.src_element.as_deref()
    }

    pub fn composed_path(&self) -> Vec<String> {
        self.target.iter().cloned().collect()
    }

    pub fn prevent_default(&mut self) {
        if self.cancelable {
            self.default_prevented = true;
        }
    }

    pub fn stop_propagation(&mut self) {
        self.propagation_stopped = true;
    }

    pub fn stop_immediate_propagation(&mut self) {
        self.immediate_propagation_stopped = true;
        self.propagation_stopped = true;
    }

    pub fn init_event(&mut self, event_type: impl Into<String>, bubbles: bool, cancelable: bool) {
        self.event_type = event_type.into();
        self.bubbles = bubbles;
        self.cancelable = cancelable;
        self.default_prevented = false;
        self.propagation_stopped = false;
        self.immediate_propagation_stopped = false;
        self.event_phase = 0;
        self.target = None;
        self.current_target = None;
        self.src_element = None;
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EventInit {
    pub bubbles: bool,
    pub cancelable: bool,
    pub composed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CustomEvent {
    event: Event,
    detail: JsValue,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CustomEventInit {
    pub event: EventInit,
    pub detail: Option<JsValue>,
}

impl CustomEvent {
    pub fn new(event_type: impl Into<String>, detail: JsValue, init: EventInit) -> Self {
        Self {
            event: Event::new(event_type, init),
            detail,
        }
    }

    pub fn event(&self) -> &Event {
        &self.event
    }

    pub fn event_mut(&mut self) -> &mut Event {
        &mut self.event
    }

    pub fn detail(&self) -> &JsValue {
        &self.detail
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EventListenerOptions {
    pub capture: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AddEventListenerOptions {
    pub capture: bool,
    pub once: bool,
    pub passive: bool,
    pub signal_aborted: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EventListenerObject;

impl EventListenerObject {
    pub fn handle_event(event: &mut Event, callback: impl FnOnce(&mut Event)) {
        callback(event);
    }
}

type EventCallback = dyn FnMut(&mut Event) + Send;

struct ListenerEntry {
    id: u64,
    event_type: String,
    once: bool,
    callback: Box<EventCallback>,
}

pub struct EventTarget {
    next_listener_id: u64,
    listeners: Vec<ListenerEntry>,
}

impl Default for EventTarget {
    fn default() -> Self {
        Self::new()
    }
}

impl EventTarget {
    pub fn new() -> Self {
        Self {
            next_listener_id: 1,
            listeners: Vec::new(),
        }
    }

    pub fn add_event_listener(
        &mut self,
        event_type: impl Into<String>,
        callback: impl FnMut(&mut Event) + Send + 'static,
        options: AddEventListenerOptions,
    ) -> u64 {
        let id = self.next_listener_id;
        self.next_listener_id += 1;
        self.listeners.push(ListenerEntry {
            id,
            event_type: event_type.into(),
            once: options.once,
            callback: Box::new(callback),
        });
        id
    }

    pub fn remove_event_listener(&mut self, listener_id: u64) -> bool {
        let before = self.listeners.len();
        self.listeners.retain(|listener| listener.id != listener_id);
        before != self.listeners.len()
    }

    pub fn dispatch_event(&mut self, event: &mut Event) -> bool {
        event.event_phase = 2;
        if event.target.is_none() {
            event.target = Some(event.event_type.clone());
            event.src_element = event.target.clone();
        }
        event.current_target = event.target.clone();
        let mut remove_ids = Vec::new();
        for listener in &mut self.listeners {
            if listener.event_type != event.event_type {
                continue;
            }
            (listener.callback)(event);
            if listener.once {
                remove_ids.push(listener.id);
            }
            if event.immediate_propagation_stopped {
                break;
            }
        }
        for id in remove_ids {
            self.remove_event_listener(id);
        }
        event.event_phase = 0;
        event.current_target = None;
        !event.default_prevented()
    }
}

#[derive(Debug, Clone)]
struct AbortState {
    aborted: bool,
    reason: JsValue,
}

#[derive(Debug, Clone)]
pub struct AbortSignal {
    state: Arc<Mutex<AbortState>>,
}

impl AbortSignal {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(AbortState {
                aborted: false,
                reason: JsValue::Undefined,
            })),
        }
    }

    pub fn aborted(&self) -> bool {
        self.state.lock().expect("abort signal lock").aborted
    }

    pub fn reason(&self) -> JsValue {
        self.state.lock().expect("abort signal lock").reason.clone()
    }

    pub fn throw_if_aborted(&self) -> JsResult<()> {
        if self.aborted() {
            Err(type_error(format!("operation aborted: {}", self.reason())))
        } else {
            Ok(())
        }
    }

    pub fn abort(reason: JsValue) -> Self {
        let signal = Self::new();
        signal.mark_aborted(reason);
        signal
    }

    pub fn timeout(_milliseconds: u64) -> Self {
        Self::abort(JsValue::String("TimeoutError".to_string()))
    }

    pub fn any(signals: &[AbortSignal]) -> Self {
        for signal in signals {
            if signal.aborted() {
                return Self::abort(signal.reason());
            }
        }
        Self::new()
    }

    fn mark_aborted(&self, reason: JsValue) {
        let mut state = self.state.lock().expect("abort signal lock");
        if !state.aborted {
            state.aborted = true;
            state.reason = reason;
        }
    }
}

impl Default for AbortSignal {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct AbortController {
    signal: AbortSignal,
}

impl AbortController {
    pub fn new() -> Self {
        Self {
            signal: AbortSignal::new(),
        }
    }

    pub fn signal(&self) -> AbortSignal {
        self.signal.clone()
    }

    pub fn abort(&self, reason: JsValue) {
        self.signal.mark_aborted(reason);
    }
}

impl Default for AbortController {
    fn default() -> Self {
        Self::new()
    }
}
