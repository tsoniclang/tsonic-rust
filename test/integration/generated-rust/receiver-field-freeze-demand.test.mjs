import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { retainedFieldFreezeOrigins, retainedFieldFreezeOriginSource, retainedFieldGenericFreezeSource } from "../../../../tsonic/test/fixtures/retained-field-freeze-origins.mjs";

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
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: {
    outputType: "lib", crateName: "retained_field_freeze_demand",
  } }, files: { "index.ts": `
export class ReadOnly {
  value = 1;
  read = (): number => this.value;
}
export class Immutable {
  readonly value = 1;
  read = (): number => this.value;
}
export class Mixed {
  value = 1;
  read = (): number => this.value;
  change = (): void => { this.value = 2; };
}
export class Unselected {
  value = 1;
  change = (): void => { this.value = 2; };
}
export class Shallow {
  child = { value: 1 };
  change = (): void => { this.child.value = 2; };
}
export function freezeReadOnly(value: ReadOnly): void { Object.freeze(value); }
export function freezeMixed(value: Mixed): void { Object.freeze(value); }
export function freezeShallow(value: Shallow): void { Object.freeze(value); }
` } });
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
        read: rt::Callable<(), f64>,
    }

    fn native_read_only() -> rt::ObjectRef<NativeReadOnlyState> {
        let value = Rc::new(Cell::new(1.0));
        let captured = value.clone();
        let read = rt::Callable::new(move |()| captured.get());
        rt::ObjectRef::new(NativeReadOnlyState { value, read })
    }

    struct NativeImmutableState {
        value: f64,
        read: rt::Callable<(), f64>,
    }

    fn native_immutable() -> rt::ObjectRef<NativeImmutableState> {
        let value = 1.0;
        let read = rt::Callable::new(move |()| value);
        rt::ObjectRef::new(NativeImmutableState { value, read })
    }

    #[test]
    fn immutable_scalar_captures_match_native_copy_ownership() {
        let (generated, generated_cost) = measure(Immutable::new);
        let (native, native_cost) = measure(native_immutable);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(native.with(|state| state.value + state.read.call(())), 2.0);
        let reader = generated.state.with(|state| state.read.clone());
        let (observed, read_cost) = measure(|| reader.call(()));
        assert_eq!(observed, 1.0);
        assert_eq!(read_cost, Cost::default());
        let (_, outer_drop) = measure(|| drop(generated));
        assert_eq!(outer_drop.deallocations, 1);
        assert_eq!(reader.call(()), 1.0);
        let (_, last_drop) = measure(|| drop(reader));
        assert_eq!(last_drop.deallocations, 1);
    }

    #[test]
    fn read_only_does_not_create_or_retain_an_unused_identity() {
        let (generated, generated_cost) = measure(ReadOnly::new);
        let (native, native_cost) = measure(native_read_only);
        assert_eq!(generated_cost, native_cost);
        assert_eq!(native.with(|state| state.value.get() + state.read.call(())), 2.0);
        let reader = generated.state.with(|state| state.read.clone());
        let (observed, read_cost) = measure(|| reader.call(()));
        assert_eq!(observed, 1.0);
        assert_eq!(read_cost, Cost::default());
        let (_, freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&generated); });
        assert_eq!(freeze_cost.allocations, 1);
        assert_eq!(freeze_cost.reallocations, 0);
        let (_, outer_drop) = measure(|| drop(generated));
        assert_eq!(outer_drop.deallocations, 2);
        assert_eq!(reader.call(()), 1.0);
        let (_, last_drop) = measure(|| drop(reader));
        assert_eq!(last_drop.deallocations, 2);
    }

    #[test]
    fn only_the_writer_retains_the_mixed_field_identity() {
        let value = Mixed::new();
        let reader = value.state.with(|state| state.read.clone());
        let writer = value.state.with(|state| state.change.clone());
        tsonic_rust_runtime::freeze_object(&value);
        let (_, outer_drop) = measure(|| drop(value));
        assert_eq!(outer_drop.deallocations, 1);
        assert_eq!(reader.call(()), 1.0);
        assert!(writer.call(()).is_err());
        let (_, writer_drop) = measure(|| drop(writer));
        assert_eq!(writer_drop.deallocations, 2);
        assert_eq!(reader.call(()), 1.0);
        let (_, reader_drop) = measure(|| drop(reader));
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
        native.with(|state| state.change.call(())).expect("native unselected write");
        assert_eq!(native.with(|state| state.value.get()), 2.0);
        let writer = generated.state.with(|state| state.change.clone());
        let (_, write_cost) = measure(|| writer.call(()));
        assert_eq!(write_cost, Cost::default());
        assert_eq!(generated.state.with(|state| state.value.get()), 2.0);
        let (_, outer_drop) = measure(|| drop(generated));
        assert_eq!(outer_drop.deallocations, 1);
        let _ = writer.call(());
        let (_, last_drop) = measure(|| drop(writer));
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
        native.with(|state| state.change.call(())).expect("native child write");
        assert_eq!(native.with(|state| state.child.borrow().with(|child| child.value)), 2.0);
        let change = generated.state.with(|state| state.change.clone());
        let (_, freeze_cost) = measure(|| { tsonic_rust_runtime::freeze_object(&generated); });
        assert_eq!(freeze_cost.allocations, 1);
        let (outcome, write_cost) = measure(|| change.call(()));
        outcome.expect("shallow native child write");
        assert_eq!(write_cost, Cost::default());
        assert_eq!(generated.state.with(|state| state.child.borrow().with(|child| child.value)), 2.0);
        let (_, outer_drop) = measure(|| drop(generated));
        assert_eq!(outer_drop.deallocations, 2);
        change.call(()).expect("escaped child writer");
        let (_, last_drop) = measure(|| drop(change));
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
