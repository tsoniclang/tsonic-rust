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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blob {
    bytes: Vec<u8>,
    content_type: String,
}

impl Blob {
    pub fn new(parts: &[BlobPart], content_type: impl Into<String>) -> Self {
        let mut bytes = Vec::new();
        for part in parts {
            match part {
                BlobPart::Bytes(value) => bytes.extend_from_slice(value),
                BlobPart::Text(value) => bytes.extend_from_slice(value.as_bytes()),
                BlobPart::Blob(value) => bytes.extend_from_slice(&value.bytes),
            }
        }
        Self {
            bytes,
            content_type: content_type.into().to_ascii_lowercase(),
        }
    }

    pub fn from_text(text: impl Into<String>) -> Self {
        Self::new(&[BlobPart::Text(text.into())], "text/plain")
    }

    pub fn size(&self) -> usize {
        self.bytes.len()
    }

    pub fn content_type(&self) -> &str {
        &self.content_type
    }

    pub fn text(&self) -> JsResult<String> {
        String::from_utf8(self.bytes.clone()).map_err(|_| type_error("Blob text is not UTF-8"))
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        ArrayBuffer::from_bytes(self.bytes.clone())
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn slice(&self, start: usize, end: Option<usize>, content_type: impl Into<String>) -> Self {
        let start = start.min(self.bytes.len());
        let end = end
            .unwrap_or(self.bytes.len())
            .min(self.bytes.len())
            .max(start);
        Self {
            bytes: self.bytes[start..end].to_vec(),
            content_type: content_type.into().to_ascii_lowercase(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobPart {
    Bytes(Vec<u8>),
    Text(String),
    Blob(Blob),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct File {
    blob: Blob,
    name: String,
    last_modified: i64,
}

impl File {
    pub fn new(
        parts: &[BlobPart],
        name: impl Into<String>,
        content_type: impl Into<String>,
        last_modified: i64,
    ) -> Self {
        Self {
            blob: Blob::new(parts, content_type),
            name: name.into(),
            last_modified,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn last_modified(&self) -> i64 {
        self.last_modified
    }

    pub fn blob(&self) -> &Blob {
        &self.blob
    }

    pub fn size(&self) -> usize {
        self.blob.size()
    }

    pub fn content_type(&self) -> &str {
        self.blob.content_type()
    }

    pub fn text(&self) -> JsResult<String> {
        self.blob.text()
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        self.blob.array_buffer()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Headers {
    entries: BTreeMap<String, Vec<String>>,
}

impl Headers {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_pairs<K, V>(pairs: impl IntoIterator<Item = (K, V)>) -> Self
    where
        K: Into<String>,
        V: Into<String>,
    {
        let mut headers = Self::new();
        for (key, value) in pairs {
            headers.append(key, value);
        }
        headers
    }

    pub fn append(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.entries
            .entry(normalize_header_name(key.into()))
            .or_default()
            .push(value.into());
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.entries
            .insert(normalize_header_name(key.into()), vec![value.into()]);
    }

    pub fn get(&self, key: impl AsRef<str>) -> Option<String> {
        self.entries
            .get(&normalize_header_name(key.as_ref()))
            .map(|values| values.join(", "))
    }

    pub fn get_all(&self, key: impl AsRef<str>) -> Vec<String> {
        self.entries
            .get(&normalize_header_name(key.as_ref()))
            .cloned()
            .unwrap_or_default()
    }

    pub fn has(&self, key: impl AsRef<str>) -> bool {
        self.entries
            .contains_key(&normalize_header_name(key.as_ref()))
    }

    pub fn delete(&mut self, key: impl AsRef<str>) {
        self.entries.remove(&normalize_header_name(key.as_ref()));
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }

    pub fn values(&self) -> Vec<String> {
        self.entries
            .values()
            .map(|values| values.join(", "))
            .collect()
    }

    pub fn entries(&self) -> Vec<(String, String)> {
        self.entries
            .iter()
            .map(|(key, values)| (key.clone(), values.join(", ")))
            .collect()
    }

    pub fn for_each(&self, mut callback: impl FnMut(&str, &str)) {
        for (key, value) in self.entries() {
            callback(&value, &key);
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FormData {
    entries: Vec<(String, FormDataValue)>,
}

impl FormData {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&mut self, key: impl Into<String>, value: FormDataValue) {
        self.entries.push((key.into(), value));
    }

    pub fn set(&mut self, key: impl Into<String>, value: FormDataValue) {
        let key = key.into();
        self.delete(&key);
        self.entries.push((key, value));
    }

    pub fn get(&self, key: &str) -> Option<FormDataValue> {
        self.entries
            .iter()
            .find(|(entry_key, _)| entry_key == key)
            .map(|(_, value)| value.clone())
    }

    pub fn get_all(&self, key: &str) -> Vec<FormDataValue> {
        self.entries
            .iter()
            .filter(|(entry_key, _)| entry_key == key)
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn has(&self, key: &str) -> bool {
        self.entries.iter().any(|(entry_key, _)| entry_key == key)
    }

    pub fn delete(&mut self, key: &str) {
        self.entries.retain(|(entry_key, _)| entry_key != key);
    }

    pub fn entries(&self) -> Vec<(String, FormDataValue)> {
        self.entries.clone()
    }

    pub fn keys(&self) -> Vec<String> {
        self.entries.iter().map(|(key, _)| key.clone()).collect()
    }

    pub fn values(&self) -> Vec<FormDataValue> {
        self.entries
            .iter()
            .map(|(_, value)| value.clone())
            .collect()
    }

    pub fn for_each(&self, mut callback: impl FnMut(&FormDataValue, &str)) {
        for (key, value) in &self.entries {
            callback(value, key);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormDataValue {
    String(String),
    File(File),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Body {
    Empty,
    Bytes(Vec<u8>),
    Text(String),
    Blob(Blob),
    FormData(FormData),
}

impl Body {
    pub fn bytes(&self) -> Vec<u8> {
        match self {
            Self::Empty => Vec::new(),
            Self::Bytes(value) => value.clone(),
            Self::Text(value) => value.as_bytes().to_vec(),
            Self::Blob(value) => value.bytes().to_vec(),
            Self::FormData(value) => value
                .entries()
                .into_iter()
                .map(|(key, value)| match value {
                    FormDataValue::String(value) => format!("{key}={value}"),
                    FormDataValue::File(file) => format!("{key}={}", file.name()),
                })
                .collect::<Vec<_>>()
                .join("&")
                .into_bytes(),
        }
    }

    pub fn text(&self) -> JsResult<String> {
        String::from_utf8(self.bytes()).map_err(|_| type_error("body is not UTF-8"))
    }

    pub fn json(&self) -> JsResult<JsValue> {
        json::parse(&self.text()?)
    }
}

#[derive(Debug, Clone)]
pub struct Request {
    url: String,
    method: String,
    headers: Headers,
    body: Body,
    signal: Option<AbortSignal>,
}

impl Request {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: "GET".to_string(),
            headers: Headers::new(),
            body: Body::Empty,
            signal: None,
        }
    }

    pub fn with_init(
        url: impl Into<String>,
        method: impl Into<String>,
        headers: Headers,
        body: Body,
        signal: Option<AbortSignal>,
    ) -> Self {
        Self {
            url: url.into(),
            method: method.into().to_ascii_uppercase(),
            headers,
            body,
            signal,
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn method(&self) -> &str {
        &self.method
    }

    pub fn headers(&self) -> &Headers {
        &self.headers
    }

    pub fn body(&self) -> &Body {
        &self.body
    }

    pub fn signal(&self) -> Option<AbortSignal> {
        self.signal.clone()
    }

    pub fn text(&self) -> JsResult<String> {
        self.body.text()
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        ArrayBuffer::from_bytes(self.body.bytes())
    }

    pub fn json(&self) -> JsResult<JsValue> {
        self.body.json()
    }

    pub fn clone_request(&self) -> Self {
        self.clone()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    status: u16,
    status_text: String,
    headers: Headers,
    body: Body,
}

impl Response {
    pub fn new(body: Body) -> Self {
        Self {
            status: 200,
            status_text: "OK".to_string(),
            headers: Headers::new(),
            body,
        }
    }

    pub fn with_init(
        status: u16,
        status_text: impl Into<String>,
        headers: Headers,
        body: Body,
    ) -> Self {
        Self {
            status,
            status_text: status_text.into(),
            headers,
            body,
        }
    }

    pub fn json(value: &JsValue) -> JsResult<Self> {
        let mut headers = Headers::new();
        headers.set("content-type", "application/json");
        Ok(Self::with_init(
            200,
            "OK",
            headers,
            Body::Text(json::stringify(value)?),
        ))
    }

    pub fn redirect(url: impl Into<String>, status: u16) -> Self {
        let mut headers = Headers::new();
        headers.set("location", url.into());
        Self::with_init(status, "Found", headers, Body::Empty)
    }

    pub fn error() -> Self {
        Self::with_init(0, "", Headers::new(), Body::Empty)
    }

    pub fn status(&self) -> u16 {
        self.status
    }

    pub fn ok(&self) -> bool {
        (200..=299).contains(&self.status)
    }

    pub fn status_text(&self) -> &str {
        &self.status_text
    }

    pub fn headers(&self) -> &Headers {
        &self.headers
    }

    pub fn text(&self) -> JsResult<String> {
        self.body.text()
    }

    pub fn array_buffer(&self) -> ArrayBuffer {
        ArrayBuffer::from_bytes(self.body.bytes())
    }

    pub fn json_body(&self) -> JsResult<JsValue> {
        self.body.json()
    }

    pub fn body(&self) -> &Body {
        &self.body
    }

    pub fn clone_response(&self) -> Self {
        self.clone()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Storage {
    entries: BTreeMap<String, String>,
}

impl Storage {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn length(&self) -> usize {
        self.entries.len()
    }

    pub fn key(&self, index: usize) -> Option<String> {
        self.entries.keys().nth(index).cloned()
    }

    pub fn get_item(&self, key: &str) -> Option<String> {
        self.entries.get(key).cloned()
    }

    pub fn set_item(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.entries.insert(key.into(), value.into());
    }

    pub fn remove_item(&mut self, key: &str) {
        self.entries.remove(key);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Navigator {
    user_agent: String,
    platform: String,
    language: String,
    languages: Vec<String>,
    hardware_concurrency: usize,
}

impl Navigator {
    pub fn new() -> Self {
        Self {
            user_agent: "TsonicRust".to_string(),
            platform: std::env::consts::OS.to_string(),
            language: "en-US".to_string(),
            languages: vec!["en-US".to_string()],
            hardware_concurrency: std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(1),
        }
    }

    pub fn user_agent(&self) -> &str {
        &self.user_agent
    }

    pub fn platform(&self) -> &str {
        &self.platform
    }

    pub fn language(&self) -> &str {
        &self.language
    }

    pub fn languages(&self) -> &[String] {
        &self.languages
    }

    pub fn hardware_concurrency(&self) -> usize {
        self.hardware_concurrency
    }
}

impl Default for Navigator {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportMeta {
    url: String,
    dirname: String,
    filename: String,
    main: bool,
}

impl ImportMeta {
    pub fn new(
        url: impl Into<String>,
        dirname: impl Into<String>,
        filename: impl Into<String>,
        main: bool,
    ) -> Self {
        Self {
            url: url.into(),
            dirname: dirname.into(),
            filename: filename.into(),
            main,
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn dirname(&self) -> &str {
        &self.dirname
    }

    pub fn filename(&self) -> &str {
        &self.filename
    }

    pub fn main(&self) -> bool {
        self.main
    }

    pub fn resolve(&self, specifier: &str) -> String {
        if specifier.starts_with("node:")
            || specifier.starts_with("file:")
            || specifier.starts_with("http://")
            || specifier.starts_with("https://")
        {
            return specifier.to_string();
        }
        if specifier.starts_with('/') {
            return format!("file://{specifier}");
        }
        let base = self.dirname.trim_end_matches('/');
        format!("file://{base}/{specifier}")
    }
}

fn normalize_header_name(key: impl AsRef<str>) -> String {
    key.as_ref().trim().to_ascii_lowercase()
}

fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn dom_exception_code(name: &str) -> u16 {
    match name {
        "IndexSizeError" => DomException::INDEX_SIZE_ERR,
        "DOMStringSizeError" => DomException::DOMSTRING_SIZE_ERR,
        "HierarchyRequestError" => DomException::HIERARCHY_REQUEST_ERR,
        "WrongDocumentError" => DomException::WRONG_DOCUMENT_ERR,
        "InvalidCharacterError" => DomException::INVALID_CHARACTER_ERR,
        "NoDataAllowedError" => DomException::NO_DATA_ALLOWED_ERR,
        "NoModificationAllowedError" => DomException::NO_MODIFICATION_ALLOWED_ERR,
        "NotFoundError" => DomException::NOT_FOUND_ERR,
        "NotSupportedError" => DomException::NOT_SUPPORTED_ERR,
        "InUseAttributeError" => DomException::INUSE_ATTRIBUTE_ERR,
        "InvalidStateError" => DomException::INVALID_STATE_ERR,
        "SyntaxError" => DomException::SYNTAX_ERR,
        "InvalidModificationError" => DomException::INVALID_MODIFICATION_ERR,
        "NamespaceError" => DomException::NAMESPACE_ERR,
        "InvalidAccessError" => DomException::INVALID_ACCESS_ERR,
        "ValidationError" => DomException::VALIDATION_ERR,
        "TypeMismatchError" => DomException::TYPE_MISMATCH_ERR,
        "SecurityError" => DomException::SECURITY_ERR,
        "NetworkError" => DomException::NETWORK_ERR,
        "AbortError" => DomException::ABORT_ERR,
        "URLMismatchError" => DomException::URL_MISMATCH_ERR,
        "QuotaExceededError" => DomException::QUOTA_EXCEEDED_ERR,
        "TimeoutError" => DomException::TIMEOUT_ERR,
        "InvalidNodeTypeError" => DomException::INVALID_NODE_TYPE_ERR,
        "DataCloneError" => DomException::DATA_CLONE_ERR,
        _ => 0,
    }
}
