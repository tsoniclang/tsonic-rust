use std::collections::BTreeMap;

use crate::buffer::Buffer;
use crate::error::NodeResult;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StreamEventState {
    listeners: BTreeMap<String, usize>,
}

impl StreamEventState {
    pub fn add_listener(&mut self, event: &str) {
        *self.listeners.entry(event.to_string()).or_default() += 1;
    }

    pub fn remove_listener(&mut self, event: &str) {
        if let Some(count) = self.listeners.get_mut(event) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.listeners.remove(event);
            }
        }
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) {
        if let Some(event) = event {
            self.listeners.remove(event);
        } else {
            self.listeners.clear();
        }
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.listeners.get(event).copied().unwrap_or(0)
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        vec![event.to_string(); self.listener_count(event)]
    }

    pub fn event_names(&self) -> Vec<String> {
        self.listeners.keys().cloned().collect()
    }

    pub fn emit(&self, event: &str) -> bool {
        self.listener_count(event) > 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamOptions {
    pub high_water_mark: usize,
    pub object_mode: bool,
    pub emit_close: bool,
    pub auto_destroy: bool,
    pub allow_half_open: bool,
    pub default_encoding: String,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            high_water_mark: 16 * 1024,
            object_mode: false,
            emit_close: true,
            auto_destroy: true,
            allow_half_open: false,
            default_encoding: "utf8".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinishedOptions {
    pub error: bool,
    pub readable: bool,
    pub writable: bool,
    pub cleanup: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Abortable {
    pub signal_aborted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadableOperatorOptions {
    pub high_water_mark: Option<usize>,
    pub concurrency: Option<usize>,
    pub signal_aborted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadableIteratorOptions {
    pub destroy_on_return: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipeOptions {
    pub end: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadableOptions {
    pub stream: StreamOptions,
    pub encoding: Option<String>,
    pub signal_aborted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WritableOptions {
    pub stream: StreamOptions,
    pub decode_strings: bool,
    pub signal_aborted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DuplexOptions {
    pub stream: StreamOptions,
    pub readable_high_water_mark: Option<usize>,
    pub writable_high_water_mark: Option<usize>,
    pub readable_object_mode: bool,
    pub writable_object_mode: bool,
    pub allow_half_open: bool,
    pub writable_corked: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransformOptions {
    pub stream: StreamOptions,
    pub readable_object_mode: bool,
    pub writable_object_mode: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadableToWebOptions {
    pub r#type: Option<String>,
    pub high_water_mark: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WritableToWebOptions {
    pub high_water_mark: Option<usize>,
}

impl Default for FinishedOptions {
    fn default() -> Self {
        Self {
            error: true,
            readable: true,
            writable: true,
            cleanup: false,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Readable {
    chunks: Vec<Buffer>,
    index: usize,
    options: StreamOptions,
    paused: bool,
    destroyed: bool,
    errored: Option<String>,
    encoding: Option<String>,
    did_read: bool,
    events: StreamEventState,
}

impl Readable {
    pub fn from_chunks(chunks: Vec<Buffer>) -> Self {
        Self {
            chunks,
            index: 0,
            options: StreamOptions::default(),
            paused: false,
            destroyed: false,
            errored: None,
            encoding: None,
            did_read: false,
            events: StreamEventState::default(),
        }
    }

    pub fn from_chunks_with_options(chunks: Vec<Buffer>, options: StreamOptions) -> Self {
        Self {
            options,
            ..Self::from_chunks(chunks)
        }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        if self.paused || self.destroyed {
            return None;
        }
        let chunk = self.chunks.get(self.index).cloned();
        if chunk.is_some() {
            self.index += 1;
            self.did_read = true;
        }
        chunk
    }

    pub fn is_ended(&self) -> bool {
        self.index >= self.chunks.len()
    }

    pub fn readable(&self) -> bool {
        !self.destroyed && !self.is_ended()
    }

    pub fn readable_ended(&self) -> bool {
        self.is_ended()
    }

    pub fn readable_length(&self) -> usize {
        self.chunks.len().saturating_sub(self.index)
    }

    pub fn readable_high_water_mark(&self) -> usize {
        self.options.high_water_mark
    }

    pub fn readable_object_mode(&self) -> bool {
        self.options.object_mode
    }

    pub fn readable_flowing(&self) -> Option<bool> {
        if self.destroyed {
            None
        } else {
            Some(!self.paused)
        }
    }

    pub fn readable_did_read(&self) -> bool {
        self.did_read
    }

    pub fn readable_aborted(&self) -> bool {
        self.destroyed && !self.is_ended()
    }

    pub fn readable_encoding(&self) -> Option<&str> {
        self.encoding.as_deref()
    }

    pub fn from(chunks: Vec<Buffer>) -> Self {
        Self::from_chunks(chunks)
    }

    pub fn pipe(&mut self, writable: &mut Writable) -> NodeResult<()> {
        pipeline(self, writable)
    }

    pub fn unpipe(&mut self, _writable: &mut Writable) -> NodeResult<()> {
        Ok(())
    }

    pub fn add_listener(&mut self, event: &str) -> &mut Self {
        self.events.add_listener(event);
        self
    }

    pub fn on(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn once(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_listener(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_once_listener(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn remove_listener(&mut self, event: &str) -> &mut Self {
        self.events.remove_listener(event);
        self
    }

    pub fn off(&mut self, event: &str) -> &mut Self {
        self.remove_listener(event)
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.events.remove_all_listeners(event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        self.events.listeners(event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<String> {
        self.events.listeners(event)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.events.listener_count(event)
    }

    pub fn event_names(&self) -> Vec<String> {
        self.events.event_names()
    }

    pub fn emit(&self, event: &str) -> bool {
        self.events.emit(event)
    }

    pub fn destroy(&mut self) {
        self.index = self.chunks.len();
        self.destroyed = true;
    }

    pub fn destroy_with_error(&mut self, error: impl Into<String>) {
        self.errored = Some(error.into());
        self.destroy();
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn closed(&self) -> bool {
        self.destroyed || self.is_ended()
    }

    pub fn errored(&self) -> Option<&str> {
        self.errored.as_deref()
    }

    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self) {
        self.paused = false;
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn set_encoding(&mut self, encoding: &str) {
        self.encoding = Some(encoding.to_ascii_lowercase());
    }

    pub fn push(&mut self, chunk: Buffer) -> bool {
        if self.destroyed {
            return false;
        }
        self.chunks.push(chunk);
        self.readable_length() < self.options.high_water_mark
    }

    pub fn unshift(&mut self, chunk: Buffer) {
        self.chunks.insert(self.index, chunk);
    }

    pub fn wrap(readable: Readable) -> Self {
        readable
    }

    pub fn iterator(&mut self) -> Vec<Buffer> {
        self.drain_remaining()
    }

    pub fn take(&mut self, limit: usize) -> Vec<Buffer> {
        let mut out = Vec::new();
        while out.len() < limit {
            let Some(chunk) = self.read() else {
                break;
            };
            out.push(chunk);
        }
        out
    }

    pub fn drop(&mut self, limit: usize) -> Vec<Buffer> {
        for _ in 0..limit {
            if self.read().is_none() {
                break;
            }
        }
        self.drain_remaining()
    }

    pub fn map(&mut self, mapper: impl Fn(Buffer) -> Buffer) -> Readable {
        let chunks = self
            .drain_remaining()
            .into_iter()
            .map(mapper)
            .collect::<Vec<_>>();
        Readable::from_chunks_with_options(chunks, self.options.clone())
    }

    pub fn filter(&mut self, predicate: impl Fn(&Buffer) -> bool) -> Readable {
        let chunks = self
            .drain_remaining()
            .into_iter()
            .filter(predicate)
            .collect::<Vec<_>>();
        Readable::from_chunks_with_options(chunks, self.options.clone())
    }

    pub fn flat_map(&mut self, mapper: impl Fn(Buffer) -> Vec<Buffer>) -> Readable {
        let chunks = self
            .drain_remaining()
            .into_iter()
            .flat_map(mapper)
            .collect::<Vec<_>>();
        Readable::from_chunks_with_options(chunks, self.options.clone())
    }

    pub fn for_each(&mut self, mut callback: impl FnMut(Buffer)) {
        while let Some(chunk) = self.read() {
            callback(chunk);
        }
    }

    pub fn every(&mut self, predicate: impl Fn(&Buffer) -> bool) -> bool {
        self.drain_remaining().iter().all(predicate)
    }

    pub fn some(&mut self, predicate: impl Fn(&Buffer) -> bool) -> bool {
        self.drain_remaining().iter().any(predicate)
    }

    pub fn find(&mut self, predicate: impl Fn(&Buffer) -> bool) -> Option<Buffer> {
        self.drain_remaining().into_iter().find(predicate)
    }

    pub fn reduce<T>(&mut self, initial: T, reducer: impl Fn(T, Buffer) -> T) -> T {
        self.drain_remaining().into_iter().fold(initial, reducer)
    }

    pub fn compose(self, next: impl Fn(Readable) -> Readable) -> Readable {
        next(self)
    }

    pub fn to_array(&mut self) -> Vec<Buffer> {
        self.drain_remaining()
    }

    pub fn to_vec(mut self) -> Vec<Buffer> {
        self.drain_remaining()
    }

    fn drain_remaining(&mut self) -> Vec<Buffer> {
        let mut out = Vec::new();
        while let Some(chunk) = self.read() {
            out.push(chunk);
        }
        out
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Writable {
    chunks: Vec<Buffer>,
    ended: bool,
    options: StreamOptions,
    destroyed: bool,
    errored: Option<String>,
    corked: usize,
    need_drain: bool,
    events: StreamEventState,
}

impl Writable {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_options(options: StreamOptions) -> Self {
        Self {
            options,
            ..Self::default()
        }
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        if self.ended || self.destroyed {
            return false;
        }
        self.chunks.push(chunk);
        self.need_drain = self.chunks.len() >= self.options.high_water_mark;
        !self.need_drain
    }

    pub fn writev(&mut self, chunks: &[Buffer]) -> bool {
        let mut ok = true;
        for chunk in chunks {
            ok = self.write(chunk.clone()) && ok;
        }
        ok
    }

    pub fn cork(&mut self) {
        self.corked += 1;
    }

    pub fn uncork(&mut self) {
        self.corked = self.corked.saturating_sub(1);
    }

    pub fn writable_corked(&self) -> usize {
        self.corked
    }

    pub fn set_default_encoding(&mut self, encoding: &str) {
        self.options.default_encoding = encoding.to_ascii_lowercase();
    }

    pub fn default_encoding(&self) -> &str {
        &self.options.default_encoding
    }

    pub fn writable_high_water_mark(&self) -> usize {
        self.options.high_water_mark
    }

    pub fn writable_object_mode(&self) -> bool {
        self.options.object_mode
    }

    pub fn writable_length(&self) -> usize {
        self.chunks.len()
    }

    pub fn writable_need_drain(&self) -> bool {
        self.need_drain
    }

    pub fn writable(&self) -> bool {
        !self.ended && !self.destroyed
    }

    pub fn writable_ended(&self) -> bool {
        self.ended
    }

    pub fn writable_finished(&self) -> bool {
        self.ended && !self.destroyed
    }

    pub fn writable_aborted(&self) -> bool {
        self.destroyed && !self.ended
    }

    pub fn emit_close(&self) -> bool {
        self.options.emit_close
    }

    pub fn errored(&self) -> Option<&str> {
        self.errored.as_deref()
    }

    pub fn closed(&self) -> bool {
        self.ended || self.destroyed
    }

    pub fn destroyed(&self) -> bool {
        self.destroyed
    }

    pub fn clear_drain(&mut self) {
        self.need_drain = false;
    }

    pub fn final_callback(&mut self, callback: impl FnOnce()) {
        self.end();
        callback();
    }

    pub fn construct_callback(&self, callback: impl FnOnce()) {
        callback();
    }

    pub fn add_listener(&mut self, event: &str) -> &mut Self {
        self.events.add_listener(event);
        self
    }

    pub fn on(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn once(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_listener(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_once_listener(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn remove_listener(&mut self, event: &str) -> &mut Self {
        self.events.remove_listener(event);
        self
    }

    pub fn off(&mut self, event: &str) -> &mut Self {
        self.remove_listener(event)
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.events.remove_all_listeners(event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        self.events.listeners(event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<String> {
        self.events.listeners(event)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.events.listener_count(event)
    }

    pub fn event_names(&self) -> Vec<String> {
        self.events.event_names()
    }

    pub fn emit(&self, event: &str) -> bool {
        self.events.emit(event)
    }

    pub fn destroy_with_error(&mut self, error: impl Into<String>) {
        self.errored = Some(error.into());
        self.destroy();
    }

    pub fn add_chunk(&mut self, chunk: Buffer) -> bool {
        self.write(chunk)
    }

    pub fn write_str(&mut self, value: &str, encoding: Option<&str>) -> bool {
        match Buffer::from_string(value, encoding) {
            Ok(buffer) => self.write(buffer),
            Err(_) => false,
        }
    }

    pub fn flush(&mut self) -> bool {
        self.clear_drain();
        true
    }

    pub fn end(&mut self) {
        self.ended = true;
    }

    pub fn destroy(&mut self) {
        self.destroyed = true;
        self.ended = true;
    }

    pub fn is_ended(&self) -> bool {
        self.ended
    }

    pub fn chunks(&self) -> &[Buffer] {
        &self.chunks
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Duplex {
    readable: Readable,
    writable: Writable,
    allow_half_open: bool,
    events: StreamEventState,
}

impl Duplex {
    pub fn new(readable: Readable, writable: Writable) -> Self {
        Self {
            readable,
            writable,
            allow_half_open: false,
            events: StreamEventState::default(),
        }
    }

    pub fn with_options(
        readable: Readable,
        mut writable: Writable,
        options: DuplexOptions,
    ) -> Self {
        for _ in 0..options.writable_corked {
            writable.cork();
        }
        Self {
            readable,
            writable,
            allow_half_open: options.allow_half_open,
            events: StreamEventState::default(),
        }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        self.readable.read()
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        self.writable.write(chunk)
    }

    pub fn end(&mut self) {
        self.writable.end();
    }

    pub fn writable_chunks(&self) -> &[Buffer] {
        self.writable.chunks()
    }

    pub fn allow_half_open(&self) -> bool {
        self.allow_half_open
    }

    pub fn readable(&self) -> bool {
        self.readable.readable()
    }

    pub fn writable(&self) -> bool {
        self.writable.writable()
    }

    pub fn destroyed(&self) -> bool {
        self.readable.destroyed() || self.writable.destroyed()
    }

    pub fn destroy(&mut self) {
        self.readable.destroy();
        self.writable.destroy();
    }

    pub fn add_listener(&mut self, event: &str) -> &mut Self {
        self.events.add_listener(event);
        self
    }

    pub fn on(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn once(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_listener(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn prepend_once_listener(&mut self, event: &str) -> &mut Self {
        self.add_listener(event)
    }

    pub fn remove_listener(&mut self, event: &str) -> &mut Self {
        self.events.remove_listener(event);
        self
    }

    pub fn off(&mut self, event: &str) -> &mut Self {
        self.remove_listener(event)
    }

    pub fn remove_all_listeners(&mut self, event: Option<&str>) -> &mut Self {
        self.events.remove_all_listeners(event);
        self
    }

    pub fn listeners(&self, event: &str) -> Vec<String> {
        self.events.listeners(event)
    }

    pub fn raw_listeners(&self, event: &str) -> Vec<String> {
        self.events.listeners(event)
    }

    pub fn listener_count(&self, event: &str) -> usize {
        self.events.listener_count(event)
    }

    pub fn event_names(&self) -> Vec<String> {
        self.events.event_names()
    }

    pub fn emit(&self, event: &str) -> bool {
        self.events.emit(event)
    }
}

#[derive(Clone)]
pub struct Transform {
    transform: fn(Buffer) -> Buffer,
    readable: Readable,
    writable: Writable,
}

impl Transform {
    pub fn new(transform: fn(Buffer) -> Buffer) -> Self {
        Self {
            transform,
            readable: Readable::default(),
            writable: Writable::new(),
        }
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        let transformed = (self.transform)(chunk);
        self.writable.write(transformed.clone()) && {
            self.readable.chunks.push(transformed);
            true
        }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        self.readable.read()
    }

    pub fn end(&mut self) {
        self.writable.end();
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PassThrough {
    inner: Duplex,
}

impl PassThrough {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn write(&mut self, chunk: Buffer) -> bool {
        let readable_chunk = chunk.clone();
        self.inner.write(chunk) && {
            self.inner.readable.chunks.push(readable_chunk);
            true
        }
    }

    pub fn read(&mut self) -> Option<Buffer> {
        self.inner.read()
    }

    pub fn end(&mut self) {
        self.inner.end();
    }
}

pub fn pipeline(readable: &mut Readable, writable: &mut Writable) -> NodeResult<()> {
    while let Some(chunk) = readable.read() {
        if !writable.write(chunk) {
            break;
        }
    }
    writable.end();
    Ok(())
}

pub fn finished(readable: &Readable, writable: &Writable) -> bool {
    readable.is_ended() && writable.is_ended()
}

pub fn finished_with_options(
    readable: &Readable,
    writable: &Writable,
    options: &FinishedOptions,
) -> bool {
    if options.error && (readable.errored().is_some() || writable.errored().is_some()) {
        return false;
    }
    if options.readable && !readable.is_ended() {
        return false;
    }
    if options.writable && !writable.is_ended() {
        return false;
    }
    true
}

pub fn is_readable(readable: &Readable) -> bool {
    readable.readable()
}

pub fn is_writable(writable: &Writable) -> bool {
    writable.writable()
}

pub fn is_errored(readable: &Readable, writable: &Writable) -> bool {
    readable.errored().is_some() || writable.errored().is_some()
}

pub fn is_destroyed(readable: &Readable, writable: &Writable) -> bool {
    readable.destroyed() || writable.destroyed()
}

pub fn compose(readable: Readable, next: impl Fn(Readable) -> Readable) -> Readable {
    readable.compose(next)
}

pub fn add_abort_signal(readable: &mut Readable, signal_aborted: bool) {
    if signal_aborted {
        readable.destroy_with_error("aborted");
    }
}

pub mod promises {
    use super::{
        finished_with_options as finished_sync_with_options, pipeline as pipeline_sync,
        FinishedOptions, Readable, Writable,
    };
    use crate::buffer::Buffer;
    use crate::error::{NodeError, NodeResult};

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct PipelineOptions {
        pub end: bool,
        pub signal_aborted: bool,
    }

    impl Default for PipelineOptions {
        fn default() -> Self {
            Self {
                end: true,
                signal_aborted: false,
            }
        }
    }

    pub fn pipeline(readable: &mut Readable, writable: &mut Writable) -> NodeResult<()> {
        pipeline_sync(readable, writable)
    }

    pub fn pipeline_with_options(
        readable: &mut Readable,
        writable: &mut Writable,
        options: &PipelineOptions,
    ) -> NodeResult<usize> {
        pipeline_transforms(readable, &[], writable, options)
    }

    pub fn pipeline_transform(
        readable: &mut Readable,
        transform: impl FnMut(Buffer) -> Buffer,
        writable: &mut Writable,
        options: &PipelineOptions,
    ) -> NodeResult<usize> {
        pipeline_transform_impl(readable, transform, writable, options)
    }

    pub fn pipeline_transforms(
        readable: &mut Readable,
        transforms: &[fn(Buffer) -> Buffer],
        writable: &mut Writable,
        options: &PipelineOptions,
    ) -> NodeResult<usize> {
        pipeline_transform_impl(
            readable,
            |mut chunk| {
                for transform in transforms {
                    chunk = transform(chunk);
                }
                chunk
            },
            writable,
            options,
        )
    }

    pub fn finished(readable: &Readable, writable: &Writable) -> bool {
        super::finished(readable, writable)
    }

    pub fn finished_with_options(
        readable: &Readable,
        writable: &Writable,
        options: &FinishedOptions,
    ) -> bool {
        finished_sync_with_options(readable, writable, options)
    }

    fn pipeline_transform_impl(
        readable: &mut Readable,
        mut transform: impl FnMut(Buffer) -> Buffer,
        writable: &mut Writable,
        options: &PipelineOptions,
    ) -> NodeResult<usize> {
        if options.signal_aborted {
            return Err(NodeError::new("ABORT_ERR", "pipeline aborted"));
        }

        let mut written = 0;
        while let Some(chunk) = readable.read() {
            if !writable.write(transform(chunk)) {
                written += 1;
                break;
            }
            written += 1;
        }
        if options.end {
            writable.end();
        }
        Ok(written)
    }
}

pub mod web {
    use super::{Readable, Writable};
    use crate::buffer::Buffer;
    use crate::error::{NodeError, NodeResult};

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct QueuingStrategy {
        pub high_water_mark: Option<usize>,
        pub size: Option<usize>,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct QueuingStrategyInit {
        pub high_water_mark: usize,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct CountQueuingStrategy {
        high_water_mark: usize,
    }

    impl CountQueuingStrategy {
        pub fn new(init: QueuingStrategyInit) -> Self {
            Self {
                high_water_mark: init.high_water_mark,
            }
        }

        pub fn high_water_mark(&self) -> usize {
            self.high_water_mark
        }

        pub fn size(&self) -> usize {
            1
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct ByteLengthQueuingStrategy {
        high_water_mark: usize,
    }

    impl ByteLengthQueuingStrategy {
        pub fn new(init: QueuingStrategyInit) -> Self {
            Self {
                high_water_mark: init.high_water_mark,
            }
        }

        pub fn high_water_mark(&self) -> usize {
            self.high_water_mark
        }

        pub fn size(&self, chunk: &Buffer) -> usize {
            chunk.len()
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq, Default)]
    pub struct StreamPipeOptions {
        pub prevent_abort: bool,
        pub prevent_cancel: bool,
        pub prevent_close: bool,
        pub signal_aborted: bool,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Default)]
    pub struct ReadableStreamGetReaderOptions {
        pub mode: Option<String>,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Default)]
    pub struct ReadableStreamIteratorOptions {
        pub prevent_cancel: bool,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Default)]
    pub struct ReadableStreamBYOBReaderReadOptions {
        pub min: Option<usize>,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct ReadableStreamReadResult {
        pub done: bool,
        pub value: Option<Buffer>,
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct ReadableStream {
        chunks: Vec<Buffer>,
        index: usize,
        locked: bool,
        canceled: bool,
    }

    impl ReadableStream {
        pub fn from_chunks(chunks: Vec<Buffer>) -> Self {
            Self {
                chunks,
                index: 0,
                locked: false,
                canceled: false,
            }
        }

        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }

        pub fn locked(&self) -> bool {
            self.locked
        }

        pub fn canceled(&self) -> bool {
            self.canceled
        }

        pub fn get_reader(&mut self) -> NodeResult<ReadableStreamDefaultReader<'_>> {
            if self.locked {
                return Err(NodeError::new("ERR_INVALID_STATE", "stream is locked"));
            }
            self.locked = true;
            Ok(ReadableStreamDefaultReader {
                stream: self,
                released: false,
            })
        }

        pub fn get_reader_with_options(
            &mut self,
            options: ReadableStreamGetReaderOptions,
        ) -> NodeResult<ReadableStreamDefaultReader<'_>> {
            if options.mode.as_deref() == Some("byob") {
                return Err(NodeError::new(
                    "ERR_INVALID_ARG_VALUE",
                    "BYOB reader requires byte stream controller",
                ));
            }
            self.get_reader()
        }

        pub fn cancel(&mut self) {
            self.canceled = true;
            self.index = self.chunks.len();
        }

        pub fn cancel_with_reason(&mut self, _reason: &str) {
            self.cancel();
        }

        pub fn values(&mut self) -> Vec<Buffer> {
            let mut values = Vec::new();
            while self.index < self.chunks.len() {
                values.push(self.chunks[self.index].clone());
                self.index += 1;
            }
            values
        }

        pub fn values_with_options(
            &mut self,
            _options: ReadableStreamIteratorOptions,
        ) -> Vec<Buffer> {
            self.values()
        }

        pub fn pipe_to(&mut self, destination: &mut WritableStream) -> NodeResult<()> {
            let chunks = self.values();
            for chunk in chunks {
                destination.write(chunk)?;
            }
            destination.close();
            Ok(())
        }

        pub fn pipe_to_with_options(
            &mut self,
            destination: &mut WritableStream,
            options: &StreamPipeOptions,
        ) -> NodeResult<()> {
            if options.signal_aborted {
                if !options.prevent_cancel {
                    self.cancel();
                }
                if !options.prevent_abort {
                    destination.abort();
                }
                return Err(NodeError::new("ABORT_ERR", "pipeTo aborted"));
            }
            let chunks = self.values();
            for chunk in chunks {
                destination.write(chunk)?;
            }
            if !options.prevent_close {
                destination.close();
            }
            Ok(())
        }

        pub fn tee(&self) -> (ReadableStream, ReadableStream) {
            (self.clone(), self.clone())
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct WritableStream {
        chunks: Vec<Buffer>,
        locked: bool,
        closed: bool,
        aborted: bool,
    }

    impl WritableStream {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }

        pub fn locked(&self) -> bool {
            self.locked
        }

        pub fn closed(&self) -> bool {
            self.closed
        }

        pub fn aborted(&self) -> bool {
            self.aborted
        }

        pub fn write(&mut self, chunk: Buffer) -> NodeResult<()> {
            if self.closed || self.aborted {
                return Err(NodeError::new(
                    "ERR_STREAM_WRITE_AFTER_END",
                    "cannot write after stream is closed",
                ));
            }
            self.chunks.push(chunk);
            Ok(())
        }

        pub fn close(&mut self) {
            self.closed = true;
        }

        pub fn abort(&mut self) {
            self.aborted = true;
            self.closed = true;
        }

        pub fn get_writer(&mut self) -> NodeResult<WritableStreamDefaultWriter<'_>> {
            if self.locked {
                return Err(NodeError::new("ERR_INVALID_STATE", "stream is locked"));
            }
            self.locked = true;
            Ok(WritableStreamDefaultWriter {
                stream: self,
                released: false,
            })
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct ReadableStreamDefaultController {
        chunks: Vec<Buffer>,
        closed: bool,
        errored: Option<String>,
    }

    impl ReadableStreamDefaultController {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn enqueue(&mut self, chunk: Buffer) -> NodeResult<()> {
            if self.closed {
                return Err(NodeError::new("ERR_INVALID_STATE", "controller is closed"));
            }
            self.chunks.push(chunk);
            Ok(())
        }

        pub fn close(&mut self) {
            self.closed = true;
        }

        pub fn error(&mut self, reason: impl Into<String>) {
            self.errored = Some(reason.into());
            self.closed = true;
        }

        pub fn desired_size(&self) -> Option<usize> {
            if self.closed {
                None
            } else {
                Some(usize::MAX.saturating_sub(self.chunks.len()))
            }
        }

        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct ReadableByteStreamController {
        inner: ReadableStreamDefaultController,
        byob_request: Option<ReadableStreamBYOBRequest>,
    }

    impl ReadableByteStreamController {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn enqueue(&mut self, chunk: Buffer) -> NodeResult<()> {
            self.inner.enqueue(chunk)
        }

        pub fn close(&mut self) {
            self.inner.close();
        }

        pub fn error(&mut self, reason: impl Into<String>) {
            self.inner.error(reason);
        }

        pub fn desired_size(&self) -> Option<usize> {
            self.inner.desired_size()
        }

        pub fn byob_request(&self) -> Option<&ReadableStreamBYOBRequest> {
            self.byob_request.as_ref()
        }

        pub fn set_byob_request(&mut self, request: ReadableStreamBYOBRequest) {
            self.byob_request = Some(request);
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct ReadableStreamBYOBRequest {
        view: Option<Buffer>,
        bytes_written: usize,
    }

    impl ReadableStreamBYOBRequest {
        pub fn new(view: Buffer) -> Self {
            Self {
                view: Some(view),
                bytes_written: 0,
            }
        }

        pub fn view(&self) -> Option<&Buffer> {
            self.view.as_ref()
        }

        pub fn respond(&mut self, bytes_written: usize) {
            self.bytes_written = bytes_written;
        }

        pub fn respond_with_new_view(&mut self, view: Buffer) {
            self.bytes_written = view.len();
            self.view = Some(view);
        }

        pub fn bytes_written(&self) -> usize {
            self.bytes_written
        }
    }

    pub struct ReadableStreamBYOBReader<'a> {
        stream: &'a mut ReadableStream,
        released: bool,
    }

    impl ReadableStreamBYOBReader<'_> {
        pub fn read(
            &mut self,
            view: Buffer,
            options: ReadableStreamBYOBReaderReadOptions,
        ) -> ReadableStreamReadResult {
            if self.released {
                return ReadableStreamReadResult {
                    done: true,
                    value: None,
                };
            }
            let mut buffer = self
                .stream
                .chunks
                .get(self.stream.index)
                .cloned()
                .unwrap_or(view);
            if let Some(min) = options.min {
                buffer = Buffer::from_bytes(buffer.as_bytes()[..buffer.len().min(min)].to_vec());
            }
            self.stream.index = self.stream.index.saturating_add(1);
            ReadableStreamReadResult {
                done: false,
                value: Some(buffer),
            }
        }

        pub fn release_lock(&mut self) {
            if !self.released {
                self.released = true;
                self.stream.locked = false;
            }
        }
    }

    impl Drop for ReadableStreamBYOBReader<'_> {
        fn drop(&mut self) {
            self.release_lock();
        }
    }

    pub struct ReadableStreamDefaultReader<'a> {
        stream: &'a mut ReadableStream,
        released: bool,
    }

    impl ReadableStreamDefaultReader<'_> {
        pub fn read(&mut self) -> Option<Buffer> {
            if self.released || self.stream.canceled {
                return None;
            }
            let chunk = self.stream.chunks.get(self.stream.index).cloned();
            if chunk.is_some() {
                self.stream.index += 1;
            }
            chunk
        }

        pub fn read_result(&mut self) -> ReadableStreamReadResult {
            match self.read() {
                Some(value) => ReadableStreamReadResult {
                    done: false,
                    value: Some(value),
                },
                None => ReadableStreamReadResult {
                    done: true,
                    value: None,
                },
            }
        }

        pub fn closed(&self) -> bool {
            self.released || self.stream.canceled || self.stream.index >= self.stream.chunks.len()
        }

        pub fn cancel(&mut self) {
            self.stream.cancel();
        }

        pub fn release_lock(&mut self) {
            if !self.released {
                self.released = true;
                self.stream.locked = false;
            }
        }
    }

    impl Drop for ReadableStreamDefaultReader<'_> {
        fn drop(&mut self) {
            self.release_lock();
        }
    }

    pub struct WritableStreamDefaultWriter<'a> {
        stream: &'a mut WritableStream,
        released: bool,
    }

    impl WritableStreamDefaultWriter<'_> {
        pub fn write(&mut self, chunk: Buffer) -> NodeResult<()> {
            if self.released {
                return Err(NodeError::new("ERR_INVALID_STATE", "writer lock released"));
            }
            self.stream.write(chunk)
        }

        pub fn ready(&self) -> bool {
            !self.released && !self.stream.aborted
        }

        pub fn closed(&self) -> bool {
            self.released || self.stream.closed
        }

        pub fn desired_size(&self) -> Option<usize> {
            if self.stream.closed || self.stream.aborted {
                None
            } else {
                Some(usize::MAX.saturating_sub(self.stream.chunks.len()))
            }
        }

        pub fn close(&mut self) {
            self.stream.close();
        }

        pub fn abort(&mut self) {
            self.stream.abort();
        }

        pub fn release_lock(&mut self) {
            if !self.released {
                self.released = true;
                self.stream.locked = false;
            }
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct WritableStreamDefaultController {
        signal_aborted: bool,
        errored: Option<String>,
    }

    impl WritableStreamDefaultController {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn signal_aborted(&self) -> bool {
            self.signal_aborted
        }

        pub fn abort_signal(&mut self) {
            self.signal_aborted = true;
        }

        pub fn error(&mut self, error: impl Into<String>) {
            self.errored = Some(error.into());
        }

        pub fn errored(&self) -> Option<&str> {
            self.errored.as_deref()
        }
    }

    impl Drop for WritableStreamDefaultWriter<'_> {
        fn drop(&mut self) {
            self.release_lock();
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct TransformStream {
        readable: ReadableStream,
        writable: WritableStream,
    }

    impl TransformStream {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn readable(&self) -> &ReadableStream {
            &self.readable
        }

        pub fn writable(&self) -> &WritableStream {
            &self.writable
        }

        pub fn write_passthrough(&mut self, chunk: Buffer) -> NodeResult<()> {
            self.writable.write(chunk.clone())?;
            self.readable.chunks.push(chunk);
            Ok(())
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Eq)]
    pub struct TransformStreamDefaultController {
        chunks: Vec<Buffer>,
        terminated: bool,
        errored: Option<String>,
    }

    impl TransformStreamDefaultController {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn enqueue(&mut self, chunk: Buffer) -> NodeResult<()> {
            if self.terminated {
                return Err(NodeError::new(
                    "ERR_INVALID_STATE",
                    "transform controller is terminated",
                ));
            }
            self.chunks.push(chunk);
            Ok(())
        }

        pub fn error(&mut self, reason: impl Into<String>) {
            self.errored = Some(reason.into());
            self.terminated = true;
        }

        pub fn terminate(&mut self) {
            self.terminated = true;
        }

        pub fn desired_size(&self) -> Option<usize> {
            if self.terminated {
                None
            } else {
                Some(usize::MAX.saturating_sub(self.chunks.len()))
            }
        }

        pub fn chunks(&self) -> &[Buffer] {
            &self.chunks
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct GenericTransformStream {
        pub readable: ReadableStream,
        pub writable: WritableStream,
    }

    pub type ReadableWritablePair = GenericTransformStream;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct TextEncoderStream {
        readable: ReadableStream,
        writable: WritableStream,
    }

    impl Default for TextEncoderStream {
        fn default() -> Self {
            Self {
                readable: ReadableStream::default(),
                writable: WritableStream::new(),
            }
        }
    }

    impl TextEncoderStream {
        pub fn readable(&self) -> &ReadableStream {
            &self.readable
        }

        pub fn writable(&self) -> &WritableStream {
            &self.writable
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct TextDecoderStream {
        readable: ReadableStream,
        writable: WritableStream,
    }

    impl Default for TextDecoderStream {
        fn default() -> Self {
            Self {
                readable: ReadableStream::default(),
                writable: WritableStream::new(),
            }
        }
    }

    impl TextDecoderStream {
        pub fn readable(&self) -> &ReadableStream {
            &self.readable
        }

        pub fn writable(&self) -> &WritableStream {
            &self.writable
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct CompressionStream {
        readable: ReadableStream,
        writable: WritableStream,
        format: String,
    }

    impl CompressionStream {
        pub fn new(format: &str) -> Self {
            Self {
                readable: ReadableStream::default(),
                writable: WritableStream::new(),
                format: format.to_string(),
            }
        }

        pub fn readable(&self) -> &ReadableStream {
            &self.readable
        }

        pub fn writable(&self) -> &WritableStream {
            &self.writable
        }

        pub fn format(&self) -> &str {
            &self.format
        }
    }

    pub type DecompressionStream = CompressionStream;

    pub fn readable_to_web(readable: Readable) -> ReadableStream {
        ReadableStream::from_chunks(readable.to_vec())
    }

    pub fn readable_from_web(stream: ReadableStream) -> Readable {
        Readable::from_chunks(stream.chunks)
    }

    pub fn writable_to_web(writable: Writable) -> WritableStream {
        let mut stream = WritableStream::new();
        stream.chunks = writable.chunks().to_vec();
        stream
    }

    pub fn writable_from_web(stream: WritableStream) -> Writable {
        let mut writable = Writable::new();
        for chunk in stream.chunks {
            writable.write(chunk);
        }
        writable
    }
}

pub mod consumers {
    use super::Readable;
    use crate::buffer::Buffer;
    use crate::error::{NodeError, NodeResult};
    use tsonic_js::json;
    use tsonic_js::web::{Blob, BlobPart};
    use tsonic_js::{ArrayBuffer, JsValue};

    pub fn buffer(readable: &mut Readable) -> NodeResult<Buffer> {
        let mut chunks = Vec::new();
        while let Some(chunk) = readable.read() {
            chunks.push(chunk);
        }
        Ok(Buffer::concat(&chunks))
    }

    pub fn text(readable: &mut Readable, encoding: Option<&str>) -> NodeResult<String> {
        buffer(readable)?.to_string(encoding)
    }

    pub fn array_buffer(readable: &mut Readable) -> NodeResult<ArrayBuffer> {
        Ok(ArrayBuffer::from_bytes(
            buffer(readable)?.as_bytes().to_vec(),
        ))
    }

    pub fn blob(readable: &mut Readable, content_type: impl Into<String>) -> NodeResult<Blob> {
        Ok(Blob::new(
            &[BlobPart::Bytes(buffer(readable)?.as_bytes().to_vec())],
            content_type,
        ))
    }

    pub fn json(readable: &mut Readable, encoding: Option<&str>) -> NodeResult<JsValue> {
        json::parse(&text(readable, encoding)?)
            .map_err(|error| NodeError::new("ERR_INVALID_JSON", error.to_string()))
    }
}
