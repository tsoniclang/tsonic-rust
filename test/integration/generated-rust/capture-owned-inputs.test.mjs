import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rustClosureCaptureFactKey } from "../../../dist/analysis/facts/keys.js";
import { analyzeRust, artifactText, compileRustThroughTargetPack } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const captures = `
import type { int32 } from "@tsonic/core/types.js";
import type { Rc as Shared } from "@tsonic/rust/std/rc.js";
function forward<Value>(value: Value): Value { return value; }
class Reading {
  value: int32;
  constructor(value: int32) { this.value = value; }
}
export function counter(seed: int32): () => int32 {
  return () => { seed = forward((seed)) + 1; return forward(seed); };
}
export function constructed(seed: int32): () => int32 {
  return () => { seed++; return new Reading(seed).value; };
}
export function text(seed: string): (next: string) => string {
  return next => { seed = next; return forward((seed as string)); };
}
export function owner(seed: Shared<int32>): (replace: boolean, next: Shared<int32>) => Shared<int32> {
  return (replace, next) => { if (replace) seed = next; return forward(seed); };
}
export function reentrant(seed: string): (visit: (value: string) => void, next: string) => string {
  return (visit, next) => { seed = next; visit(forward(seed)); return forward(seed); };
}
`;

test("unique captures consume exact by-value argument facts, not call syntax or native owner names", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": captures + `
function width(value: string): number { return value.length; }
export function borrowed(seed: string): () => number {
  return () => { seed = "replacement"; return width(seed); };
}
export function independent(seed: int32): (() => int32)[] {
  return [() => { seed++; return forward(seed); }, () => { seed++; return forward(seed); }];
}
export function repeated(seed: int32): (() => int32)[] {
  const result: (() => int32)[] = [];
  for (let index = 0; index < 2; index++) result.push(() => { seed++; return forward(seed); });
  return result;
}
export function nested(seed: int32): () => () => int32 {
  return () => () => { seed++; return forward(seed); };
}
export function retained(seed: int32): () => int32 {
  const callback = () => { seed++; return forward(seed); };
  forward(seed);
  return callback;
}
export function suspended(seed: int32): () => Promise<int32> {
  return async () => { seed++; return forward(seed); };
}
` } });
  const storage = new Map();
  const visit = node => {
    const fact = program.facts.getFact(node, rustClosureCaptureFactKey);
    if (fact !== undefined) {
      let owner = source.ast.parent(node);
      while (owner !== undefined && !source.ast.is.IsFunctionDeclaration(owner)) owner = source.ast.parent(owner);
      const name = owner === undefined ? undefined : source.ast.text(source.ast.name(owner));
      if (name !== undefined) {
        const selected = storage.get(name) ?? [];
        selected.push(...fact.captures.map(capture => capture.storage));
        storage.set(name, selected);
      }
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of source.sourceFiles) if (source.ast.getFileName(file).endsWith("/index.ts")) visit(file);
  for (const name of ["counter", "constructed"]) assert.deepEqual(storage.get(name), ["cell"], name);
  for (const name of ["text", "owner", "reentrant"]) assert.deepEqual(storage.get(name), ["borrow-cell"], name);
  for (const name of ["borrowed", "independent", "repeated", "nested", "retained", "suspended"]) {
    assert.ok(storage.get(name)?.length > 0, name);
    assert.ok(storage.get(name).every(value => value === "location"), name);
  }
});

test("by-value captured inputs have only the independent handwritten shared callable frame", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "capture_owned_inputs" } },
    files: { "index.ts": captures },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /core::cell::Cell::new/u);
  assert.match(output, /core::cell::RefCell::new/u);
  assert.doesNotMatch(output, /Location::allocate|capture_seed\w* = seed\.clone\(\)/u);
  const root = writeGeneratedProject("capture-owned-inputs", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/ownership.rs"), nativeOwnershipCostSupport + `
use capture_owned_inputs::index;
use std::cell::RefCell;
use std::rc::Rc;

fn handwritten(seed: i32) -> Rc<dyn Fn() -> i32> {
    let seed = Cell::new(seed);
    Rc::new(move || { seed.set(seed.get() + 1); seed.get() })
}

fn handwritten_text(seed: String) -> Rc<dyn Fn(String) -> String> {
    let seed = RefCell::new(seed);
    Rc::new(move |next| { *seed.borrow_mut() = next; seed.borrow().clone() })
}

fn handwritten_owner(seed: Rc<i32>) -> Rc<dyn Fn(bool, Rc<i32>) -> Rc<i32>> {
    let seed = RefCell::new(seed);
    Rc::new(move |replace, next| {
        if replace { *seed.borrow_mut() = next; }
        seed.borrow().clone()
    })
}

fn handwritten_reentrant(seed: String) -> Rc<dyn Fn(&dyn Fn(String), String) -> String> {
    let seed = RefCell::new(seed);
    Rc::new(move |visit, next| {
        *seed.borrow_mut() = next;
        let snapshot = seed.borrow().clone();
        visit(snapshot);
        seed.borrow().clone()
    })
}

#[test]
fn copies_and_constructor_inputs_keep_one_frame_and_shared_aliases() {
    let (actual, actual_cost) = measure(|| index::counter(1));
    let (expected, expected_cost) = measure(|| handwritten(1));
    assert_eq!(actual_cost, expected_cost);
    assert_eq!(actual_cost.allocations, 1);
    let actual_alias = actual.clone();
    let expected_alias = Rc::clone(&expected);
    let actual_calls = measure(|| {
        for _iteration in 0..10000 {
            std::hint::black_box(actual.call(()).unwrap());
            std::hint::black_box(actual_alias.call(()).unwrap());
        }
        actual.call(()).unwrap()
    });
    let expected_calls = measure(|| {
        for _iteration in 0..10000 {
            std::hint::black_box(expected());
            std::hint::black_box(expected_alias());
        }
        expected()
    });
    assert_eq!(actual_calls, expected_calls);
    assert_eq!(actual_calls.1, Cost::default());
    let (constructed, cost) = measure(|| index::constructed(1));
    assert_eq!(cost, expected_cost);
    let calls = measure(|| (constructed.call(()).unwrap(), constructed.call(()).unwrap()));
    assert_eq!(calls, ((2, 3), Cost::default()));
    let independent = index::counter(100);
    assert_eq!(independent.call(()).unwrap(), 101);
    assert_eq!(actual_alias.call(()).unwrap(), 20003);
}

#[test]
fn non_copy_owned_arguments_keep_the_required_snapshot_and_drop_the_old_value() {
    let actual_seed = String::from("old");
    let expected_seed = String::from("old");
    let (actual, actual_cost) = measure(|| index::text(actual_seed));
    let (expected, expected_cost) = measure(|| handwritten_text(expected_seed));
    assert_eq!(actual_cost, expected_cost);
    assert_eq!(actual_cost.allocations, 1);
    for length in [1, 1024, 65536] {
        let actual_next = "x".repeat(length);
        let expected_next = "x".repeat(length);
        let actual_call = measure(|| actual.call((actual_next,)).unwrap());
        let expected_call = measure(|| expected(expected_next));
        assert_eq!(actual_call, expected_call);
        assert_eq!(actual_call.1.allocations, 1);
        assert_eq!(actual_call.1.allocated_bytes, length);
        assert_eq!(actual_call.1.deallocations, 1);
    }
}

#[test]
fn explicit_native_owner_is_not_an_exemption_from_binding_replacement() {
    let actual_seed = Rc::new(7);
    let expected_seed = Rc::new(7);
    let actual_weak = Rc::downgrade(&actual_seed);
    let expected_weak = Rc::downgrade(&expected_seed);
    let (actual, actual_cost) = measure(|| index::owner(actual_seed));
    let (expected, expected_cost) = measure(|| handwritten_owner(expected_seed));
    assert_eq!(actual_cost, expected_cost);
    assert_eq!(actual_cost.allocations, 1);
    assert_eq!(actual_weak.strong_count(), 1);
    assert_eq!(expected_weak.strong_count(), 1);
    let actual_alias = actual.clone();
    let expected_alias = Rc::clone(&expected);
    let actual_next = Rc::new(9);
    let expected_next = Rc::new(9);
    let actual_next_weak = Rc::downgrade(&actual_next);
    let expected_next_weak = Rc::downgrade(&expected_next);
    let actual_call = measure(|| actual_alias.call((true, actual_next)).unwrap());
    let expected_call = measure(|| expected_alias(true, expected_next));
    assert_eq!(*actual_call.0, *expected_call.0);
    assert_eq!(actual_call.1, expected_call.1);
    assert_eq!(actual_call.1.allocations, 0);
    assert!(actual_weak.upgrade().is_none());
    assert!(expected_weak.upgrade().is_none());
    assert_eq!(actual_next_weak.strong_count(), 2);
    assert_eq!(expected_next_weak.strong_count(), 2);
    let unused_actual = Rc::new(11);
    let unused_expected = Rc::new(11);
    let observed_actual = actual.call((false, unused_actual)).unwrap();
    let observed_expected = expected(false, unused_expected);
    assert!(Rc::ptr_eq(&observed_actual, &actual_call.0));
    assert!(Rc::ptr_eq(&observed_expected, &expected_call.0));
    drop((observed_actual, observed_expected, actual_call, expected_call, actual, expected));
    assert_eq!(actual_next_weak.strong_count(), 1);
    assert_eq!(expected_next_weak.strong_count(), 1);
    drop((actual_alias, expected_alias));
    assert!(actual_next_weak.upgrade().is_none());
    assert!(expected_next_weak.upgrade().is_none());
}

#[test]
fn snapshot_borrows_end_before_an_independent_reentrant_invocation() {
    let actual = index::reentrant(String::from("initial"));
    let expected = handwritten_reentrant(String::from("initial"));
    let actual_alias = actual.clone();
    let expected_alias = Rc::clone(&expected);
    let visit = tsonic_rust_runtime::Callable::new(move |(value,): (String,)| {
        assert_eq!(value, "outer");
        let quiet = tsonic_rust_runtime::Callable::new(|(_value,): (String,)| Ok(()));
        assert_eq!(actual_alias.call((quiet, String::from("inner"))).unwrap(), "inner");
        Ok(())
    });
    let expected_visit = move |value: String| {
        assert_eq!(value, "outer");
        assert_eq!(expected_alias(&|_value| {}, String::from("inner")), "inner");
    };
    assert_eq!(actual.call((visit, String::from("outer"))).unwrap(),
        expected(&expected_visit, String::from("outer")));
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--release", "--locked", "--offline", "--test", "ownership"]);
});
