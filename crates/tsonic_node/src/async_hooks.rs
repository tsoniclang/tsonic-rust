use std::cell::RefCell;

#[derive(Debug, Clone)]
pub struct AsyncLocalStorage<T: Clone> {
    stack: RefCell<Vec<T>>,
}

impl<T: Clone> Default for AsyncLocalStorage<T> {
    fn default() -> Self {
        Self {
            stack: RefCell::new(Vec::new()),
        }
    }
}

impl<T: Clone> AsyncLocalStorage<T> {
    pub fn new() -> Self {
        Self::default()
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
        self.stack.borrow().last().cloned()
    }

    pub fn disable(&self) {
        self.stack.borrow_mut().clear();
    }
}
