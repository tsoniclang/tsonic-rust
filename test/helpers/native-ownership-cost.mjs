export const nativeOwnershipCostSupport = `
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Cost {
    allocations: usize,
    allocated_bytes: usize,
    reallocations: usize,
    deallocations: usize,
    deallocated_bytes: usize,
}

thread_local! {
    static ACTIVE: Cell<bool> = const { Cell::new(false) };
    static COST: Cell<Cost> = const { Cell::new(Cost {
        allocations: 0, allocated_bytes: 0, reallocations: 0,
        deallocations: 0, deallocated_bytes: 0,
    }) };
}

fn record(operation: impl FnOnce(&mut Cost)) {
    if ACTIVE.get() {
        let mut cost = COST.get();
        operation(&mut cost);
        COST.set(cost);
    }
}

struct Counting;
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record(|cost| {
            cost.allocations += 1;
            cost.allocated_bytes += layout.size();
        });
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        record(|cost| {
            cost.allocations += 1;
            cost.allocated_bytes += layout.size();
        });
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        record(|cost| {
            cost.reallocations += 1;
            cost.deallocated_bytes += layout.size();
            cost.allocated_bytes += size;
        });
        unsafe { System.realloc(pointer, layout, size) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        record(|cost| {
            cost.deallocations += 1;
            cost.deallocated_bytes += layout.size();
        });
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn measure<Value>(operation: impl FnOnce() -> Value) -> (Value, Cost) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) { ACTIVE.set(false); }
    }
    assert!(!ACTIVE.get());
    COST.set(Cost::default());
    ACTIVE.set(true);
    let reset = Reset;
    let value = std::hint::black_box(operation());
    drop(reset);
    (value, COST.get())
}
`;
