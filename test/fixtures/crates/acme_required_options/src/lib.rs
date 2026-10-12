use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

static CREATED: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone)]
pub struct Input(Arc<()>);

pub struct Options {
    pub input: Input,
    pub label: Option<String>,
    pub enabled: Option<bool>,
}

pub fn create_input() -> Input {
    CREATED.fetch_add(1, Ordering::SeqCst);
    Input(Arc::new(()))
}

pub fn observe(options: Options, expected: &Input) -> bool {
    CREATED.load(Ordering::SeqCst) == 1
        && Arc::ptr_eq(&options.input.0, &expected.0)
        && options.label.is_none()
        && options.enabled.is_none()
}
