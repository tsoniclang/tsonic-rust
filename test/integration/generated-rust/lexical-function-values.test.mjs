import assert from "node:assert/strict";
import test from "node:test";
import { nativeAllocationSupport } from "../../helpers/native-ownership-cost.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lexicalFunctionValuesSource } from "../../../../tsonic/test/fixtures/lexical-function-values.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`lexical function values retain activation identity and hoisting in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "lexical_function_values" } },
      files: { "index.ts": (`${lexicalFunctionValuesSource}
export function main(): void { if (!run()) throw new Error("lexical function identity"); }
` + "\nmain();\n") } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(`lexical-function-values-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
}

test("retained lexical counter has handwritten native allocation cost and allocation-free invocations", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "lib", crateName: "lexical_values" } },
    files: { "index.ts": lexicalFunctionValuesSource } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
  const root = writeGeneratedProject("lexical-function-value-cost", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/cost.rs"), `${nativeAllocationSupport}
use std::cell::Cell;
use std::rc::Rc;

#[test]
fn exact_native_environment_and_repeated_calls() {
    let (actual, calls, bytes) = allocation_counts::measure_value_requests(lexical_values::index::counter);
    let (_, native_calls, native_bytes) = allocation_counts::measure_value_requests(|| {
        let value = Cell::new(0);
        let counter: Rc<dyn Fn() -> i32> = Rc::new(move || {
            let next = value.get() + 1; value.set(next); next
        });
        counter
    });
    assert_eq!((calls, bytes), (native_calls, native_bytes));
    let (forwarded, calls, bytes) = allocation_counts::measure_value_requests(lexical_values::index::arrowCall);
    assert_eq!((calls, bytes), (native_calls, native_bytes));
    let (_, calls, bytes) = allocation_counts::measure_value_requests(|| {
        for expected in 1..=10000 { assert_eq!(forwarded.call(()).unwrap(), expected); }
    });
    assert_eq!((calls, bytes), (0, 0));
    let (absent, calls, bytes) = allocation_counts::measure_value_requests(|| lexical_values::index::branchCounter(std::hint::black_box(false)));
    assert!(absent.is_none());
    assert_eq!((calls, bytes), (0, 0));
    let (_, calls, bytes) = allocation_counts::measure_value_requests(|| {
        for expected in 1..=10000 { assert_eq!(actual.clone().call(()).unwrap(), expected); }
    });
    assert_eq!((calls, bytes), (0, 0));
    let (absent, calls, bytes) = allocation_counts::measure_value_requests(|| lexical_values::index::optionalCounter(std::hint::black_box(false)));
    assert!(absent.is_none());
    assert_eq!((calls, bytes), (0, 0));
    let (absent, calls, bytes) = allocation_counts::measure_value_requests(|| lexical_values::index::branchIdentity(std::hint::black_box(false)));
    assert!(absent.is_none());
    assert_eq!((calls, bytes), (0, 0));
    let (present, calls, bytes) = allocation_counts::measure_value_requests(|| lexical_values::index::branchIdentity(std::hint::black_box(true)));
    assert_eq!((calls, bytes), (native_calls, native_bytes));
    assert_eq!(present.unwrap().call(()).unwrap(), 1);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "cost"]);
});
