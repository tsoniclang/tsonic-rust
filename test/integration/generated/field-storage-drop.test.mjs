import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rustBindingStorageOperations } from "../../../dist/backend/planner/expressions/binding-storage.js";
import { writeRustCapturedField } from "../../../dist/backend/planner/objects/captured-fields.js";
import { writeRustProjectObjectField } from "../../../dist/backend/planner/objects/project-objects.js";
import { printRustExpr } from "../../../dist/print/source/expressions/core.js";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("canonical native field replacements release every guard before reentrant Drop", { timeout: 300_000 }, () => {
  const owner = { kind: "path", path: "owner" };
  const replacement = { kind: "path", path: "replacement" };
  const whole = printRustExpr(rustBindingStorageOperations("borrow-cell").write(owner, replacement));
  const projected = printRustExpr(writeRustCapturedField({ kind: "borrow-cell", initialization: "ready" },
    { kind: "path", path: "selected" }, { kind: "call", path: "replacement", args: [] }, ["probe"]));
  const outer = printRustExpr(writeRustProjectObjectField({ kind: "path", path: "receiver" }, "payload", "=", replacement,
    { kind: "shared-mutable" }, { kind: "borrow-cell", initialization: "ready" }));
  const copy = printRustExpr(writeRustCapturedField({ kind: "cell", initialization: "ready" },
    { kind: "path", path: "captured_value" }, { kind: "call", path: "replacement", args: [] }, ["first"]));
  const projectedCopy = printRustExpr(writeRustCapturedField({ kind: "borrow-cell", initialization: "ready" },
    owner, { kind: "int-literal", text: "7" }, ["first"]));
  const temporaryRead = printRustExpr(rustBindingStorageOperations("borrow-cell").read({
    kind: "call", path: "temporary_owner", args: [],
  }));
  const borrowedRead = printRustExpr(rustBindingStorageOperations("borrow-cell", true).read(owner));
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "lib", crateName: "field_storage_contract" } },
    files: { "index.ts": "export function seed(value: number): number { return value; }" } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
  const root = writeGeneratedProject("field-storage-drop", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/drop.rs"), `
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use tsonic_rust_runtime as rt;

struct Probe {
    value: u32,
    drops: Rc<Cell<u32>>,
    action: Option<Box<dyn FnOnce()>>,
}

impl Drop for Probe {
    fn drop(&mut self) {
        self.drops.set(self.drops.get() + 1);
        if let Some(action) = self.action.take() { action(); }
    }
}

struct Container { probe: Probe, sibling: u32 }
struct State { payload: Rc<RefCell<Probe>>, visits: u32 }
struct Wrapper { state: rt::ObjectHandle<State> }

#[derive(Clone, Copy)]
struct Pair { first: u32, second: u32 }

#[test]
fn whole_payload_observes_new_value_without_a_guard() {
    let drops = Rc::new(Cell::new(0));
    let seen = Rc::new(Cell::new(0));
    let owner = Rc::new(RefCell::new(Probe { value: 1, drops: drops.clone(), action: None }));
    let weak = Rc::downgrade(&owner);
    let observed = seen.clone();
    owner.borrow_mut().action = Some(Box::new(move || {
        let retained = weak.upgrade().unwrap();
        observed.set(retained.borrow().value);
        retained.borrow_mut().value += 1;
    }));
    let replacement = Probe { value: 7, drops: drops.clone(), action: None };
    ${whole};
    assert_eq!(seen.get(), 7);
    assert_eq!(owner.borrow().value, 8);
    assert_eq!(drops.get(), 1);
    drop(owner);
    assert_eq!(drops.get(), 2);
}

#[test]
fn projected_rhs_and_drop_can_reenter_without_losing_siblings() {
    let drops = Rc::new(Cell::new(0));
    let seen = Rc::new(Cell::new(0));
    let rhs_calls = Cell::new(0);
    let selected = Rc::new(RefCell::new(Container {
        probe: Probe { value: 1, drops: drops.clone(), action: None }, sibling: 19,
    }));
    let weak = Rc::downgrade(&selected);
    let observed = seen.clone();
    selected.borrow_mut().probe.action = Some(Box::new(move || {
        let retained = weak.upgrade().unwrap();
        observed.set(retained.borrow().probe.value);
        retained.borrow_mut().sibling = 23;
    }));
    let replacement = || {
        rhs_calls.set(rhs_calls.get() + 1);
        assert_eq!(selected.borrow().sibling, 19);
        selected.borrow_mut().sibling = 20;
        Probe { value: 7, drops: drops.clone(), action: None }
    };
    ${projected};
    assert_eq!(rhs_calls.get(), 1);
    assert_eq!(seen.get(), 7);
    assert_eq!(selected.borrow().probe.value, 7);
    assert_eq!(selected.borrow().sibling, 23);
    assert_eq!(drops.get(), 1);
    drop(selected);
    assert_eq!(drops.get(), 2);
}

#[test]
fn parent_storage_is_not_borrowed_during_payload_drop() {
    let drops = Rc::new(Cell::new(0));
    let payload = Rc::new(RefCell::new(Probe { value: 1, drops: drops.clone(), action: None }));
    let receiver = Wrapper { state: rt::ObjectHandle::new(State { payload, visits: 0 }) };
    let root = receiver.state.clone().into_shared();
    let weak = Rc::downgrade(&root);
    drop(root);
    receiver.state.with(|state| state.payload.borrow_mut().action = Some(Box::new(move || {
        let retained = weak.upgrade().unwrap();
        assert_eq!(retained.with(|state| state.payload.borrow().value), 7);
        retained.with_mut(|state| state.visits += 1);
    })));
    let replacement = Probe { value: 7, drops: drops.clone(), action: None };
    ${outer};
    assert_eq!(receiver.state.with(|state| state.visits), 1);
    assert_eq!(drops.get(), 1);
    drop(receiver);
    assert_eq!(drops.get(), 2);
}

#[test]
fn cell_projection_evaluates_rhs_before_live_sibling_snapshot() {
    let captured_value = Cell::new(Pair { first: 1, second: 2 });
    let calls = Cell::new(0);
    let replacement = || {
        calls.set(calls.get() + 1);
        captured_value.set(Pair { first: 3, second: 4 });
        7
    };
    ${copy};
    assert_eq!(calls.get(), 1);
    assert_eq!(captured_value.get().first, 7);
    assert_eq!(captured_value.get().second, 4);
}

#[test]
fn projected_copy_values_need_no_drop_warning_or_clone() {
    let owner = RefCell::new(Pair { first: 1, second: 2 });
    ${projectedCopy};
    assert_eq!(owner.borrow().first, 7);
    assert_eq!(owner.borrow().second, 2);
}

#[test]
fn temporary_cell_owner_outlives_the_payload_guard_without_repeated_evaluation() {
    let calls = Cell::new(0);
    let source = Rc::new(RefCell::new(String::from("retained")));
    let temporary_owner = || {
        calls.set(calls.get() + 1);
        source.clone()
    };
    let result = ${temporaryRead};
    assert_eq!(result, "retained");
    assert_eq!(calls.get(), 1);
    assert_eq!(Rc::strong_count(&source), 1);
    source.borrow_mut().push_str(" value");
    assert_eq!(source.borrow().as_str(), "retained value");
}

#[test]
fn copy_cell_reads_borrow_without_moving_the_original_owner() {
    let owner = RefCell::new(7u32);
    assert_eq!(${borrowedRead}, 7);
    owner.replace(9);
    assert_eq!(*owner.borrow(), 9);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--locked", "--offline", "--test", "drop"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
});
