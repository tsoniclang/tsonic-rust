import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const allocationSupport = fileURLToPath(new URL("../../../rust-runtime/tests/helpers/allocation_counts.rs", import.meta.url));

export function nativeAllocationSupport(projectRoot) {
  const projectSupport = join(projectRoot, "allocation_counts.rs");
  copyFileSync(allocationSupport, projectSupport);
  return `#[path = ${JSON.stringify(projectSupport)}]
pub mod allocation_counts;
`;
}

export function nativeOwnershipCostSupport(projectRoot) {
  return `${nativeAllocationSupport(projectRoot)}
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
    (
        value,
        Cost {
            allocations: counts.allocations,
            allocated_bytes: counts.requested_bytes(),
            reallocations: counts.reallocations,
            deallocations: counts.deallocations,
            deallocated_bytes: counts.released_bytes(),
        },
    )
}
`;
}
