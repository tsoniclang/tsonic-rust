use std::sync::atomic::{AtomicI32, Ordering};

static GLOBAL_COUNT: AtomicI32 = AtomicI32::new(0);

pub fn global_count() -> i32 {
    GLOBAL_COUNT.load(Ordering::SeqCst)
}

pub fn open_resource() -> String {
    String::from("resource")
}

pub fn dispose_borrowed(value: &str) {
    assert_eq!(value, "resource");
    GLOBAL_COUNT.fetch_add(1, Ordering::SeqCst);
}

pub fn open_number(value: i32) -> i32 {
    value
}

pub fn dispose_number(value: usize) {
    GLOBAL_COUNT.store(value as i32, Ordering::SeqCst);
}

pub struct Resource(String);

impl Resource {
    pub fn truncate(&mut self, length: usize) {
        assert_eq!(length, 0);
        self.0.clear();
        GLOBAL_COUNT.fetch_add(1, Ordering::SeqCst);
    }
}

pub fn open_custom_resource() -> Resource {
    Resource(String::from("resource"))
}
