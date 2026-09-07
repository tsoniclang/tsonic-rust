use std::cell::{Cell, RefCell, UnsafeCell};
use std::rc::{Rc, Weak};
use tsonic_rust_runtime::raw_memory::RawPointer;
use tsonic_rust_runtime::{raw_memory, Location};

struct Region {
    values: UnsafeCell<[u32; 2]>,
}

thread_local! {
    static LAST: RefCell<Weak<Region>> = const { RefCell::new(Weak::new()) };
    static LIVE: Cell<u32> = const { Cell::new(0) };
}

impl Drop for Region {
    fn drop(&mut self) {
        LIVE.with(|live| live.set(live.get() - 1));
    }
}

pub fn acquire(value: u32) -> RawPointer {
    let owner = Rc::new(Region {
        values: UnsafeCell::new([value, 0]),
    });
    LIVE.with(|live| live.set(live.get() + 1));
    LAST.with(|last| *last.borrow_mut() = Rc::downgrade(&owner));
    let address = owner.values.get().cast::<u8>();
    unsafe { RawPointer::from_external(address, 8, owner) }.expect("non-null native region")
}

fn read(index: usize) -> u32 {
    LAST.with(|last| {
        let owner = last.borrow().upgrade().expect("native region was released");
        unsafe { (*owner.values.get())[index] }
    })
}

pub fn read_original() -> u32 {
    read(0)
}

pub fn read_second() -> u32 {
    read(1)
}

pub fn live_leases() -> u32 {
    LIVE.with(Cell::get)
}

pub fn collect() {}

pub fn relay<Value>(pointer: Location<Value>) -> Location<Value> {
    pointer
}

pub fn identity<Value>(value: Value) -> Value {
    value
}

pub fn location(value: u32) -> Location<u32> {
    let raw = acquire(value);
    unsafe { raw_memory::reinterpret_raw_location(Some(&raw), 4, 4, 64, true) }
        .expect("non-null native region")
}
