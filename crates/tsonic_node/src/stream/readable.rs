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
