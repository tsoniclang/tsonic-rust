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

