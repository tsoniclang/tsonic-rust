import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRustThroughTargetPack } from "../../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../../helpers/native-ownership-cost.mjs";

test("native FnOnce transfers owned call operands without Clone or allocation while FnMut retains snapshots", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "once_owned_inputs" } },
    files: { "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
import { range } from "@tsonic/rust/lang.js";
import { Vec } from "@tsonic/rust/std/vec.js";
import { Result } from "@tsonic/rust/core/result.js";
function forward<Value>(value: Value): Value { return value; }
function add(left: nativeUint, right: nativeUint): nativeUint { return left + right; }
export function owned<Value>(status: Result<int32, int32>, seed: Value): Result<Value, int32> {
  return status.map(_item => forward(seed));
}
export function block<Value>(status: Result<int32, int32>, seed: Value): Result<Value, int32> {
  return status.map(_item => { const result = forward(seed); return result; });
}
export function wrapped<Value>(status: Result<int32, int32>, seed: Value): Result<Value, int32> {
  return status.map(_item => forward(((seed satisfies Value))));
}
export function vector(status: Result<int32, int32>, seed: Vec<int32>): Result<Vec<int32>, int32> {
  return status.map(_item => forward(seed));
}
export function increments(count: nativeUint, seed: nativeUint): Vec<nativeUint> {
  return range<nativeUint>(0, count).map(value => {
    seed = add(seed, value);
    return forward(seed);
  }).collect<Vec<nativeUint>>();
}
export function snapshots<Value>(count: nativeUint, seed: Value): Vec<Value> {
  return range<nativeUint>(0, count).map(_item => forward(seed)).collect<Vec<Value>>();
}
export function looped<Value>(status: Result<int32, int32>, count: nativeUint, seed: Value): Result<Vec<Value>, int32> {
  return status.map(_item => {
    const result = new Vec<Value>();
    for (let index: nativeUint = 0; index < count; index++) result.push(forward(seed));
    return result;
  });
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  const start = output.indexOf("pub fn owned");
  const repeated = output.indexOf("pub fn snapshots");
  assert.ok(start >= 0 && repeated > start);
  assert.doesNotMatch(output.slice(start, repeated), /Clone|\.clone\(|Cell|Location|Callable|Box::/u);
  assert.match(output.slice(repeated), /\.clone\(\)/u);
  assert.doesNotMatch(output, /Location::|Cell::|Callable::/u);
  const root = writeGeneratedProject("once-owned-inputs", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use once_owned_inputs::index;

#[derive(Default)]
struct Observations {
    clones: Cell<usize>,
    drops: Cell<usize>,
}

struct Foreign<'scope> {
    observed: &'scope Observations,
    payload: Box<[u8]>,
}

impl Drop for Foreign<'_> {
    fn drop(&mut self) { self.observed.drops.set(self.observed.drops.get() + 1); }
}

struct Cloning<'scope> {
    observed: &'scope Observations,
    value: usize,
}

impl Clone for Cloning<'_> {
    fn clone(&self) -> Self {
        self.observed.clones.set(self.observed.clones.get() + 1);
        Self { observed: self.observed, value: self.value }
    }
}

impl Drop for Cloning<'_> {
    fn drop(&mut self) { self.observed.drops.set(self.observed.drops.get() + 1); }
}

fn handwritten<Value>(status: Result<i32, i32>, seed: Value) -> Result<Value, i32> {
    status.map(move |_item| seed)
}

fn handwritten_increments(count: usize, mut seed: usize) -> Vec<usize> {
    (0..count).map(move |value| { seed += value; seed }).collect()
}

fn handwritten_snapshots<Value: Clone>(count: usize, seed: Value) -> Vec<Value> {
    (0..count).map(move |_item| seed.clone()).collect()
}

fn handwritten_loop<Value: Clone>(status: Result<i32, i32>, count: usize, seed: Value) -> Result<Vec<Value>, i32> {
    status.map(move |_item| {
        let mut result = Vec::new();
        for _index in 0..count { result.push(seed.clone()); }
        result
    })
}

#[test]
fn external_move_only_owner_keeps_its_native_lifetime_allocation_and_drop() {
    for variant in 0..3 {
        for successful in [false, true] {
            let actual_observed = Observations::default();
            let expected_observed = Observations::default();
            let actual = Foreign { observed: &actual_observed, payload: vec![7; 65536].into_boxed_slice() };
            let expected = Foreign { observed: &expected_observed, payload: vec![7; 65536].into_boxed_slice() };
            let address = actual.payload.as_ptr();
            let status = if successful { Ok(3) } else { Err(9) };
            let actual = measure(|| match variant {
                0 => index::owned(status, actual),
                1 => index::block(status, actual),
                _ => index::wrapped(status, actual),
            });
            let expected = measure(|| handwritten(status, expected));
            assert_eq!(actual.1, expected.1);
            assert_eq!(actual.1.allocations, 0);
            assert_eq!(actual_observed.drops.get(), expected_observed.drops.get());
            if successful {
                let value = actual.0.ok().expect("success");
                assert_eq!(value.payload.as_ptr(), address);
                assert_eq!(value.payload.len(), 65536);
                assert_eq!(actual_observed.drops.get(), 0);
                drop(value);
            } else {
                assert_eq!(actual.0.err(), Some(9));
                assert_eq!(actual_observed.drops.get(), 1);
            }
            drop(expected.0);
            assert_eq!(actual_observed.drops.get(), 1);
            assert_eq!(expected_observed.drops.get(), 1);
        }
    }
}

#[test]
fn available_clone_is_not_a_reason_to_copy_a_once_owned_input() {
    for successful in [false, true] {
        let actual_observed = Observations::default();
        let expected_observed = Observations::default();
        let actual = Cloning { observed: &actual_observed, value: 17 };
        let expected = Cloning { observed: &expected_observed, value: 17 };
        let status = if successful { Ok(3) } else { Err(9) };
        let actual = measure(|| index::owned(status, actual));
        let expected = measure(|| handwritten(status, expected));
        assert_eq!(actual.1, expected.1);
        assert_eq!(actual.1, Cost::default());
        assert_eq!(actual_observed.clones.get(), 0);
        assert_eq!(expected_observed.clones.get(), 0);
        assert_eq!(actual.0.as_ref().ok().map(|value| value.value), expected.0.as_ref().ok().map(|value| value.value));
        drop((actual, expected));
        assert_eq!(actual_observed.drops.get(), 1);
        assert_eq!(expected_observed.drops.get(), 1);
    }
}

#[test]
fn native_vector_and_mutable_callback_own_no_secondary_storage() {
    let actual = vec![1, 2, 3, 4];
    let address = actual.as_ptr();
    let expected = actual.clone();
    let actual = measure(|| index::vector(Ok(1), actual));
    let expected = measure(|| handwritten(Ok(1), expected));
    assert_eq!(actual, expected);
    assert_eq!(actual.1, Cost::default());
    assert_eq!(actual.0.as_ref().unwrap().as_ptr(), address);
    for count in [0, 1, 10, 10000] {
        let actual = measure(|| index::increments(std::hint::black_box(count), 7));
        let expected = measure(|| handwritten_increments(std::hint::black_box(count), 7));
        assert_eq!(actual, expected);
    }
}

#[test]
fn repeated_invocation_and_repeated_body_uses_require_independent_snapshots() {
    for count in [0, 1, 10, 1000] {
        for looped in [false, true] {
            let actual_observed = Observations::default();
            let expected_observed = Observations::default();
            let actual = Cloning { observed: &actual_observed, value: 23 };
            let expected = Cloning { observed: &expected_observed, value: 23 };
            let actual = measure(|| if looped {
                index::looped(Ok(1), count, actual).unwrap()
            } else { index::snapshots(count, actual) });
            let expected = measure(|| if looped {
                handwritten_loop(Ok(1), count, expected).unwrap()
            } else { handwritten_snapshots(count, expected) });
            assert_eq!(actual.1, expected.1);
            assert_eq!(actual.0.len(), expected.0.len());
            assert!(actual.0.iter().all(|value| value.value == 23));
            assert_eq!(actual_observed.clones.get(), count);
            assert_eq!(expected_observed.clones.get(), count);
            assert_eq!(actual_observed.drops.get(), 1);
            assert_eq!(expected_observed.drops.get(), 1);
            drop((actual, expected));
            assert_eq!(actual_observed.drops.get(), count + 1);
            assert_eq!(expected_observed.drops.get(), count + 1);
        }
    }
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "ownership"]);
  mkdirSync(join(root, "src/bin"), { recursive: true });
  writeFileSync(join(root, "src/bin/escape.rs"), `
struct Borrowed<'scope>(&'scope i32);
fn escape() -> Borrowed<'static> {
    let local = 7;
    once_owned_inputs::index::owned(Ok(1), Borrowed(&local)).ok().unwrap()
}
fn main() { std::hint::black_box(escape().0); }
`);
  const rejected = spawnSync("cargo", ["check", "--bin", "escape", "--locked", "--offline"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
    timeout: 300_000,
  });
  assert.equal(rejected.error, undefined);
  assert.equal(rejected.signal, null);
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /E0515/u);
});
