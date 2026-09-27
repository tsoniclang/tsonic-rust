import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRustThroughTargetPack } from "../../../helpers/rust-session.mjs";
import { writeGeneratedProject, runCargo } from "../../../helpers/cargo-projects.mjs";

test("explicit native owners survive aliases, calls, fields, containers, absence and captures without another payload owner", { timeout: 300_000 }, () => {
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: { outputType: "lib", crateName: "native_owner_boundaries" } },
    files: {
      "owners.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Rc } from "@tsonic/rust/std/rc.js";
export type Shared = Rc<int32>;
export function forward(value: Shared): Shared { return value; }
export function forwardNative<T>(value: T): T { return value; }
`,
      "index.ts": `
import { move } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
import type { Arc } from "@tsonic/rust/std/sync.js";
import type { Weak } from "@tsonic/rust/std/rc.js";
import type { Box } from "@tsonic/rust/std/boxed.js";
import type { Pin } from "@tsonic/rust/std/pin.js";
import type { RefCell } from "@tsonic/rust/std/cell.js";
import type { Vec } from "@tsonic/rust/std/vec.js";
import { forward, forwardNative } from "./owners.js";
import type { Shared } from "./owners.js";
export function shared(value: Shared): Shared { return forward(value); }
export function atomic(value: Arc<int32>): Arc<int32> { return value; }
export function exclusive(value: Box<int32>): Box<int32> { return value; }
export function pinned(value: Pin<Box<int32>>): Pin<Box<int32>> { return value; }
export function weak(value: Weak<int32>): Weak<int32> { return value; }
export function cell(value: RefCell<int32>): RefCell<int32> { return value; }
export function vector(value: Vec<Shared>): Vec<Shared> { return value; }
export function optional(value: Shared | undefined): Shared | undefined { return value; }
export function explicit(value: Shared): Shared { return move(value); }
export function generic<T>(value: T): T { return forwardNative(value); }
export function capture(value: Shared): () => Shared { return () => value; }
export async function suspended(value: Shared): Promise<Shared> { return value; }
export class Holder {
  value: Shared;
  constructor(value: Shared) { this.value = value; }
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /Location::allocate|JsValue|ObjectReference|RefCell<(?:std::)?(?:rc::Rc|sync::Arc)|Rc<(?:std::)?(?:rc::Rc|sync::Arc)/u);
  assert.match(output, /pub fn exclusive\(value: std::boxed::Box<i32>\) -> std::boxed::Box<i32>/u);
  const root = writeGeneratedProject("explicit-native-owner-boundaries", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/owners.rs"), `
use native_owner_boundaries::index;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

struct UnrecognizedOwner(Rc<Cell<usize>>);
impl Drop for UnrecognizedOwner {
    fn drop(&mut self) { self.0.set(self.0.get() + 1); }
}

#[test]
fn external_move_only_type_needs_no_clone_or_library_exception() {
    let drops = Rc::new(Cell::new(0));
    let value = index::generic(UnrecognizedOwner(Rc::clone(&drops)));
    assert_eq!(drops.get(), 0);
    assert_eq!(Rc::strong_count(&drops), 2);
    drop(value);
    assert_eq!(drops.get(), 1);
    assert_eq!(Rc::strong_count(&drops), 1);
}

#[test]
fn explicit_owners_keep_identity_and_count() {
    let value = Rc::new(7);
    let address = Rc::as_ptr(&value);
    let value = index::explicit(index::shared(value));
    assert_eq!(Rc::as_ptr(&value), address);
    assert_eq!(Rc::strong_count(&value), 1);
    let weak = index::weak(Rc::downgrade(&value));
    assert_eq!(Rc::weak_count(&value), 1);
    assert_eq!(Rc::as_ptr(&weak.upgrade().unwrap()), address);
    let value = index::optional(Some(value)).unwrap();
    assert_eq!(Rc::strong_count(&value), 1);
    assert!(index::optional(None).is_none());
    let values = vec![value];
    let allocation = values.as_ptr();
    let mut values = index::vector(values);
    assert_eq!(values.as_ptr(), allocation);
    let value = tsonic_rust_runtime::block_on(index::suspended(values.pop().unwrap()));
    assert_eq!(Rc::strong_count(&value), 1);
    let callable = index::capture(value);
    let result = callable.call(()).unwrap();
    assert_eq!(Rc::as_ptr(&result), address);
    assert_eq!(Rc::strong_count(&result), 2);
    drop(callable);
    assert_eq!(Rc::strong_count(&result), 1);
    let holder = index::Holder::new(result);
    let stored = holder.dispatch.read_holder_value();
    assert_eq!(Rc::as_ptr(&stored), address);
    assert_eq!(Rc::strong_count(&stored), 2);
    drop(stored);
    assert_eq!(weak.strong_count(), 1);
    drop(holder);
    assert!(weak.upgrade().is_none());

    let value = Arc::new(8);
    let address = Arc::as_ptr(&value);
    let value = index::atomic(value);
    assert_eq!(Arc::as_ptr(&value), address);
    assert_eq!(Arc::strong_count(&value), 1);
    let value = std::thread::spawn(move || index::atomic(value)).join().unwrap();
    assert_eq!(Arc::as_ptr(&value), address);
    assert_eq!(Arc::strong_count(&value), 1);
    let value = Box::new(9);
    let address = std::ptr::from_ref(value.as_ref());
    let value = index::exclusive(value);
    assert_eq!(std::ptr::from_ref(value.as_ref()), address);
    let value = Box::pin(11);
    let address = std::ptr::from_ref(value.as_ref().get_ref());
    let value = index::pinned(value);
    assert_eq!(std::ptr::from_ref(value.as_ref().get_ref()), address);
    let value = index::cell(RefCell::new(10));
    *value.borrow_mut() += 1;
    assert_eq!(*value.borrow(), 11);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});
