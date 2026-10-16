use std::cell::Cell;
use std::ops::{Index, IndexMut};
use std::sync::atomic::{AtomicI32, Ordering};

static GLOBAL_COUNT: AtomicI32 = AtomicI32::new(0);
pub static mut STATIC_COUNT: i32 = 0;

pub struct Store {
    pub count: i32,
    values: [i32; 4],
    shared_count: Cell<i32>,
}

impl Store {
    pub fn new(_seed: String) -> Self {
        Self {
            count: 0,
            values: [0; 4],
            shared_count: Cell::new(0),
        }
    }

    pub fn get(&self, index: i32) -> i32 {
        self.values[index as usize]
    }

    pub fn set(&mut self, index: i32, value: i32) {
        self.values[index as usize] = value;
    }

    pub fn set_count(&mut self, value: i32) {
        self.count = value;
    }

    pub fn set_shared_count(&self, value: i32) {
        self.shared_count.set(value);
    }

    pub fn get_shared_count(&self) -> i32 {
        self.shared_count.get()
    }

    pub fn prepare(&mut self, value: i32) -> &mut Self {
        self.count = value;
        self
    }

    pub fn finish(&mut self) {
        self.count += 1;
    }
}

impl Index<i32> for Store {
    type Output = i32;

    fn index(&self, index: i32) -> &Self::Output {
        &self.values[index as usize]
    }
}

impl IndexMut<i32> for Store {
    fn index_mut(&mut self, index: i32) -> &mut Self::Output {
        &mut self.values[index as usize]
    }
}

pub fn set_count(store: &mut Store, value: i32) {
    store.count = value;
}

pub struct PendingWrite(i32);

pub fn begin_global(value: i32) -> PendingWrite {
    PendingWrite(value)
}

impl PendingWrite {
    pub fn finish(self) {
        GLOBAL_COUNT.store(self.0, Ordering::SeqCst);
    }
}

pub fn global_count() -> i32 {
    GLOBAL_COUNT.load(Ordering::SeqCst)
}

pub fn static_count() -> i32 {
    unsafe { STATIC_COUNT }
}

pub fn open_resource() -> String {
    String::from("resource")
}

pub fn dispose_borrowed(value: &str) {
    assert_eq!(value, "resource");
    GLOBAL_COUNT.fetch_add(1, Ordering::SeqCst);
}

pub fn dispose_with_argument(value: &mut String, argument: i32) {
    assert_eq!(argument, 0);
    value.clear();
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
