import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRust, compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { retainedFieldFreezeOrigins, retainedFieldFreezeOriginSource, retainedFieldGenericFreezeSource } from "../../../../tsonic/test/fixtures/retained-field-freeze-origins.mjs";
import { Node_Initializer } from "@tsonic/target-api/source";
import { rustCapturedFieldStorageFactKey } from "../../../dist/analysis/facts/receiver-captures.js";

for (const { name, declarations, invocation } of retainedFieldFreezeOrigins)
  test(`retained direct writes observe ${name} freeze without guarding reads`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": retainedFieldFreezeOriginSource(declarations, invocation) +
        '\nexport function main(): void { if (!run()) throw new Error("retained freeze origin"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`retained-field-freeze-origin-${name}`, result.artifacts, { run: true });
  });

test("generic inherited field captures observe freeze through the exact structural instantiation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": retainedFieldGenericFreezeSource +
      '\nexport function main(): void { if (!run()) throw new Error("generic inherited freeze"); }' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
  validateGeneratedProject("retained-field-freeze-generic-inherited", result.artifacts, { run: true });
});

test("read-only and shallow capture construction and identity release match handwritten native owners", { timeout: 300_000 }, () => {
  const options = { surfaces: ["js"], target: { id: "rust", options: {
    outputType: "lib", crateName: "retained_field_freeze_demand",
  } }, files: { "index.ts": `
class ReadOnly {
  value = 1;
  read = (): number => this.value;
}
class Immutable {
  readonly value = 1;
  read = (): number => this.value;
}
class Mixed {
  value = 1;
  read = (): number => this.value;
  change = (): void => { this.value = 2; };
}
class Unselected {
  value = 1;
  change = (): void => { this.value = 2; };
}
class Shallow {
  child = { value: 1 };
  change = (): void => { this.child.value = 2; };
}
export function freezeReadOnly(value: ReadOnly): void { Object.freeze(value); }
export function freezeMixed(value: Mixed): void { Object.freeze(value); }
export function freezeShallow(value: Shallow): void { Object.freeze(value); }
export function createReadOnly(): ReadOnly { return new ReadOnly(); }
export function createImmutable(): Immutable { return new Immutable(); }
export function createMixed(): Mixed { return new Mixed(); }
export function createUnselected(): Unselected { return new Unselected(); }
export function createShallow(): Shallow { return new Shallow(); }
` } };
  const { program } = analyzeRust(options);
  for (const [name, expectedCaptures] of [
    ["ReadOnly", [["read", "value", "cell", false]]],
    ["Immutable", [["read", "value", "copy", false]]],
    ["Mixed", [["read", "value", "cell", false], ["change", "value", "cell", true]]],
    ["Unselected", [["change", "value", "cell", false]]],
    ["Shallow", [["change", "child", "borrow-cell", false]]],
  ]) {
    const representation = program.objectRepresentations.representations.find(value => value.definition.sourceName === name);
    assert.equal(representation !== undefined, true, `exact ${name} owner`);
    assert.equal(representation.kind, "shared-immutable", `${name} has one native owner, not open nominal dispatch`);
    assert.equal(program.projectTypes.isPolymorphic(representation.definition), false, `${name} is internally closed`);
    const ast = program.source.ast;
    const members = ast.members(representation.definition.declaration).filter(member => member !== undefined);
    for (const [callbackName, fieldName, storageKind, retainsIdentity] of expectedCaptures) {
      const member = members.find(selected => ast.text(ast.name(selected)) === callbackName);
      const field = members.find(selected => ast.text(ast.name(selected)) === fieldName);
      assert.equal(member !== undefined && field !== undefined, true, `${name}.${callbackName} exact declarations`);
      const callable = Node_Initializer(ast, member);
      assert.equal(callable !== undefined && ast.is.IsArrowFunction(callable), true, `${name}.${callbackName} exact arrow`);
      const captures = program.objectRepresentations.receiverCaptures.capturesFor(callable);
      assert.equal(captures.length, 1, `${name}.${callbackName} owns one selected field`);
      assert.equal(captures[0].declaration === field, true, `${name}.${callbackName} retains the checked field`);
      assert.equal(program.objectRepresentations.receiverCaptures.receiversFor(callable).length, 0,
        `${name}.${callbackName} does not retain the containing object`);
      const storage = program.facts.getFact(field, rustCapturedFieldStorageFactKey);
      assert.equal(storage !== undefined, true, `${name}.${fieldName} sealed physical storage`);
      assert.equal(storage.storage.kind, storageKind, `${name}.${fieldName} native storage kind`);
      assert.equal(storage.storage.initialization, "ready", `${name}.${fieldName} initialized field`);
      assert.equal(program.frozenDataWrites.capturesFieldIdentity(field, captures[0].reference), retainsIdentity,
        `${name}.${callbackName} exact freeze-identity retention`);
    }
  }
  const { result } = compileRust(options);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.equal(typeof output === "string" && output.length !== 0, true, "actual generated Rust source");
  assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(output), false);
  const root = writeGeneratedProject("retained-field-freeze-demand", result.artifacts);
  const index = join(root, "src/index.rs");
  writeFileSync(index, `${readFileSync(index, "utf8")}
#[cfg(test)]
mod capture_costs {
    use super::*;
    use std::rc::Rc;
    use std::cell::RefCell;
    ${nativeOwnershipCostSupport}

    struct NativeReadOnlyState {
        value: Rc<Cell<f64>>,
        read: rt::Callable<(), rt::TsonicResult<f64>>,
    }

    fn native_read_only() -> rt::ObjectRef<NativeReadOnlyState> {
        let value = Rc::new(Cell::new(1.0));
        let captured = value.clone();
        let read = rt::Callable::new(move |()| Ok(captured.get()));
        rt::ObjectRef::new(NativeReadOnlyState { value, read })
    }

    struct NativeImmutableState {
        value: f64,
        read: rt::Callable<(), rt::TsonicResult<f64>>,
    }

    fn native_immutable() -> rt::ObjectRef<NativeImmutableState> {
        let value = 1.0;
        let read = rt::Callable::new(move |()| Ok(value));
        rt::ObjectRef::new(NativeImmutableState { value, read })
    }

    #[test]
    fn immutable_scalar_captures_match_native_copy_ownership() {
        let (generated, generated_cost) = measure(Immutable::new);
        let (native, native_cost) = measure(native_immutable);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 2);
        assert_eq!(native.with(|state| state.value + state.read.call(()).expect("native immutable read")), 2.0);
        let reader = generated.state.with(|state| state.read.clone());
        let native_reader = native.with(|state| state.read.clone());
        let (observed, read_cost) = measure(|| reader.call(()));
        assert_eq!(observed.expect("immutable scalar read"), 1.0);
        assert_eq!(read_cost, Cost::default());
        let (_, outer_drop) = measure(|| drop(generated));
        let (_, native_outer_drop) = measure(|| drop(native));
        assert_eq!(outer_drop, native_outer_drop);
        assert_eq!(outer_drop.deallocations, 1);
        assert_eq!(reader.call(()).expect("escaped immutable read"), 1.0);
        let (_, last_drop) = measure(|| drop(reader));
        let (_, native_last_drop) = measure(|| drop(native_reader));
        assert_eq!(last_drop, native_last_drop);
        assert_eq!(last_drop.deallocations, 1);
    }

    #[test]
    fn read_only_does_not_create_or_retain_an_unused_identity() {
        let (generated, generated_cost) = measure(ReadOnly::new);
        let (native, native_cost) = measure(native_read_only);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 3);
        assert_eq!(native.with(|state| state.value.get() + state.read.call(()).expect("native field read")), 2.0);
        let reader = generated.state.with(|state| state.read.clone());
        let native_reader = native.with(|state| state.read.clone());
        let (observed, read_cost) = measure(|| reader.call(()));
        assert_eq!(observed.expect("read-only field read"), 1.0);
        assert_eq!(read_cost, Cost::default());
        let (_, freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&generated); });
        let (_, native_freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&native); });
        assert_eq!(freeze_cost, native_freeze_cost);
        assert_eq!(freeze_cost.allocations, 1);
        assert_eq!(freeze_cost.reallocations, 0);
        let (_, outer_drop) = measure(|| drop(generated));
        let (_, native_outer_drop) = measure(|| drop(native));
        assert_eq!(outer_drop, native_outer_drop);
        assert_eq!(outer_drop.deallocations, 2);
        assert_eq!(reader.call(()).expect("escaped read-only field read"), 1.0);
        let (_, last_drop) = measure(|| drop(reader));
        let (_, native_last_drop) = measure(|| drop(native_reader));
        assert_eq!(last_drop, native_last_drop);
        assert_eq!(last_drop.deallocations, 2);
    }

    struct NativeMixedState {
        value: Rc<Cell<f64>>,
        read: rt::Callable<(), rt::TsonicResult<f64>>,
        change: rt::Callable<(), rt::TsonicResult<()>>,
    }

    fn native_mixed() -> rt::ObjectRef<NativeMixedState> {
        let identity = rt::ObjectIdentity::new();
        let value = Rc::new(Cell::new(1.0));
        let read_value = value.clone();
        let read = rt::Callable::new(move |()| Ok(read_value.get()));
        let write_value = value.clone();
        let write_identity = identity.clone();
        let change = rt::Callable::new(move |()| {
            write_identity.validate_data_write()?;
            write_value.set(2.0);
            Ok(())
        });
        rt::ObjectRef::with_context_and_identity(NativeMixedState { value, read, change }, (), identity)
    }

    #[test]
    fn only_the_writer_retains_the_mixed_field_identity() {
        let (value, generated_cost) = measure(Mixed::new);
        let (native, native_cost) = measure(native_mixed);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 5);
        assert_eq!(native.with(|state| state.value.get()), 1.0);
        let reader = value.state.with(|state| state.read.clone());
        let writer = value.state.with(|state| state.change.clone());
        let native_reader = native.with(|state| state.read.clone());
        let native_writer = native.with(|state| state.change.clone());
        let (_, freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&value); });
        let (_, native_freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&native); });
        assert_eq!(freeze_cost, Cost::default());
        assert_eq!(freeze_cost, native_freeze_cost);
        let (_, outer_drop) = measure(|| drop(value));
        let (_, native_outer_drop) = measure(|| drop(native));
        assert_eq!(outer_drop, native_outer_drop);
        assert_eq!(outer_drop.deallocations, 1);
        assert_eq!(reader.call(()).expect("frozen field read"), 1.0);
        assert!(writer.call(()).is_err());
        assert!(native_writer.call(()).is_err());
        let (_, writer_drop) = measure(|| drop(writer));
        let (_, native_writer_drop) = measure(|| drop(native_writer));
        assert_eq!(writer_drop, native_writer_drop);
        assert_eq!(writer_drop.deallocations, 2);
        assert_eq!(reader.call(()).expect("read after writer release"), 1.0);
        let (_, reader_drop) = measure(|| drop(reader));
        let (_, native_reader_drop) = measure(|| drop(native_reader));
        assert_eq!(reader_drop, native_reader_drop);
        assert_eq!(reader_drop.deallocations, 2);
    }

    struct NativeUnselectedState {
        value: Rc<Cell<f64>>,
        change: rt::Callable<(), rt::TsonicResult<()>>,
    }

    fn native_unselected() -> rt::ObjectRef<NativeUnselectedState> {
        let value = Rc::new(Cell::new(1.0));
        let captured = value.clone();
        let change = rt::Callable::new(move |()| { captured.set(2.0); Ok(()) });
        rt::ObjectRef::new(NativeUnselectedState { value, change })
    }

    #[test]
    fn an_unselected_writer_has_no_identity_cost_or_hidden_allocation() {
        let (generated, generated_cost) = measure(Unselected::new);
        let (native, native_cost) = measure(native_unselected);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 3);
        native.with(|state| state.change.call(())).expect("native unselected write");
        assert_eq!(native.with(|state| state.value.get()), 2.0);
        let writer = generated.state.with(|state| state.change.clone());
        let native_writer = native.with(|state| state.change.clone());
        let (outcome, write_cost) = measure(|| writer.call(()));
        outcome.expect("generated unselected write");
        assert_eq!(write_cost, Cost::default());
        assert_eq!(generated.state.with(|state| state.value.get()), 2.0);
        let (_, outer_drop) = measure(|| drop(generated));
        let (_, native_outer_drop) = measure(|| drop(native));
        assert_eq!(outer_drop, native_outer_drop);
        assert_eq!(outer_drop.deallocations, 1);
        writer.call(()).expect("escaped unselected write");
        let (_, last_drop) = measure(|| drop(writer));
        let (_, native_last_drop) = measure(|| drop(native_writer));
        assert_eq!(last_drop, native_last_drop);
        assert_eq!(last_drop.deallocations, 2);
    }

    struct NativeChild { value: f64 }

    struct NativeShallowState {
        child: Rc<RefCell<rt::ObjectHandle<NativeChild>>>,
        change: rt::Callable<(), rt::TsonicResult<()>>,
    }

    fn native_shallow() -> rt::ObjectRef<NativeShallowState> {
        let child = Rc::new(RefCell::new(rt::ObjectHandle::new(NativeChild { value: 1.0 })));
        let captured = child.clone();
        let change = rt::Callable::new(move |()| {
            let selected = captured.borrow();
            selected.validate_data_write()?;
            selected.with_mut(|state| state.value = 2.0);
            Ok(())
        });
        rt::ObjectRef::new(NativeShallowState { child, change })
    }

    #[test]
    fn shallow_write_does_not_force_an_outer_identity() {
        let (generated, generated_cost) = measure(Shallow::new);
        let (native, native_cost) = measure(native_shallow);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 4);
        native.with(|state| state.change.call(())).expect("native child write");
        assert_eq!(native.with(|state| state.child.borrow().with(|child| child.value)), 2.0);
        let change = generated.state.with(|state| state.change.clone());
        let native_change = native.with(|state| state.change.clone());
        let (_, freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&generated); });
        let (_, native_freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&native); });
        assert_eq!(freeze_cost, native_freeze_cost);
        assert_eq!(freeze_cost.allocations, 1);
        let (outcome, write_cost) = measure(|| change.call(()));
        outcome.expect("shallow native child write");
        assert_eq!(write_cost, Cost::default());
        assert_eq!(generated.state.with(|state| state.child.borrow().with(|child| child.value)), 2.0);
        let (_, outer_drop) = measure(|| drop(generated));
        let (_, native_outer_drop) = measure(|| drop(native));
        assert_eq!(outer_drop, native_outer_drop);
        assert_eq!(outer_drop.deallocations, 2);
        change.call(()).expect("escaped child writer");
        let (_, last_drop) = measure(|| drop(change));
        let (_, native_last_drop) = measure(|| drop(native_change));
        assert_eq!(last_drop, native_last_drop);
        assert_eq!(last_drop.deallocations, 3);
    }
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--release", "--locked", "--offline"]);
});
