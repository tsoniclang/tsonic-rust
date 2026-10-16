import { fileURLToPath } from "node:url";

const allocationSupport = fileURLToPath(new URL("../../../rust-runtime/tests/helpers/allocation_counts.rs", import.meta.url));

export const nativeAllocationSupport = `
#[path = ${JSON.stringify(allocationSupport)}]
pub mod allocation_counts;
`;

export const nativeOwnershipCostSupport = `
${nativeAllocationSupport}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Cost {
    allocations: usize,
    allocated_bytes: usize,
    reallocations: usize,
    deallocations: usize,
    deallocated_bytes: usize,
}

fn measure<Value>(operation: impl FnOnce() -> Value) -> (Value, Cost) {
    let (value, counts) = allocation_counts::measure(|| std::hint::black_box(operation()));
    (value, Cost {
        allocations: counts.allocations,
        allocated_bytes: counts.requested_bytes(),
        reallocations: counts.reallocations,
        deallocations: counts.deallocations,
        deallocated_bytes: counts.released_bytes(),
    })
}
`;
