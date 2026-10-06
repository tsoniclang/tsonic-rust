use core::cell::Cell;
use core::num::NonZeroUsize;
use tsonic_rust_runtime::dispatch_queue::{TaskBudget, TaskHandle, TaskQueue};
use tsonic_rust_runtime::CallableImplementation;

thread_local! {
    static CONSTRUCTIONS: Cell<i32> = const { Cell::new(0) };
}

pub struct Dispatch<TError>(TaskQueue<TError>);

pub struct DispatchHandle<TError>(TaskHandle<TError>);

pub struct Parent<TError>(Dispatch<TError>);

pub type ParentHandle<TError> = DispatchHandle<TError>;

#[derive(Clone, Default)]
pub struct Receiver {
    pub value: i32,
}

impl Receiver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue<TError: 'static>(
        &mut self,
        left: i32,
        root: &Dispatch<TError>,
        right: i32,
        callback: impl CallableImplementation<(), Result<(), TError>> + 'static,
    ) {
        self.value = left * 10 + right;
        enqueue(root.handle(), callback);
    }
}

impl<TError> Dispatch<TError> {
    pub fn new() -> Self {
        CONSTRUCTIONS.with(|count| count.set(count.get() + 1));
        Self(TaskQueue::new(TaskBudget::new(
            NonZeroUsize::new(128).unwrap(),
        )))
    }

    pub fn handle(&self) -> DispatchHandle<TError> {
        DispatchHandle(self.0.handle())
    }
}

impl<TError> Default for Dispatch<TError> {
    fn default() -> Self {
        Self::new()
    }
}

impl<TError> Parent<TError> {
    pub fn new() -> Self {
        Self(Dispatch::new())
    }

    pub fn child(&self) -> &Dispatch<TError> {
        &self.0
    }

    pub fn handle(&self) -> ParentHandle<TError> {
        self.0.handle()
    }
}

impl<TError> Default for Parent<TError> {
    fn default() -> Self {
        Self::new()
    }
}

pub fn constructions() -> i32 {
    CONSTRUCTIONS.with(Cell::get)
}

pub fn enqueue<TError: 'static>(
    handle: DispatchHandle<TError>,
    callback: impl CallableImplementation<(), Result<(), TError>> + 'static,
) {
    handle.0.enqueue(move || callback.invoke(())).unwrap();
}

pub fn poll<TError>(root: &Dispatch<TError>) -> Result<(), TError> {
    root.0.poll_ready().map(|_| ())
}
