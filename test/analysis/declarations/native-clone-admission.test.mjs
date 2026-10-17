import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustNamedTargetType, rustNativeTraitRef } from "../../../dist/target-model/types/carriers/native.js";
import { selectRustCloneRequirements } from "../../../dist/target-model/types/carriers/traits.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const integer = Object.freeze({ kind: "source-primitive", name: "int32" });
const parameter = Object.freeze({ kind: "type-parameter", identity: "native-clone:Value", name: "Value" });
const instance = value => rustSourceTypeCarrier("/clone.ts", "Holder", "object", [{ kind: "type", type: value }]);
const field = (name, clone) => ({ name, clone });

test("source object Clone is a once-published exact physical field obligation, never a declaration-name promise", () => {
  const registry = createRustTypeDefinitionRegistry();
  const open = instance(parameter);
  assert.equal(selectRustCloneRequirements(open, registry).kind, "required", "an incomplete physical declaration is an obligation, not success");
  const noClone = rustNamedTargetType("native.NoClone", "native::NoClone");
  const mutable = { kind: "reference", mutable: true, referent: integer };
  const selected = { carrier: open, fields: [field("value", { kind: "required", carrier: parameter }),
    field("marker", { kind: "unconditional" })] };
  assert.equal(registry.registerSourceObjectPhysicalDefinition(selected), true, "the actual raw template registers once");
  assert.equal(registry.registerSourceObjectPhysicalDefinition(selected), false, "a second writer cannot replace the selected fields");
  const definitions = registry.seal();
  const physical = definitions.sourceObjectPhysicalDefinition(instance(integer));
  assert.equal(physical !== undefined && Object.isFrozen(physical) && Object.isFrozen(physical.fields), true,
    "all instantiations read the same immutable raw native definition");
  assert.equal(rustTargetTypeRefEquals(physical.fields[0].clone.carrier, parameter), true, "publication retains the original generic identity");
  for (const [label, value, expected] of [["native integer", integer, "available"], ["native move-only", noClone, "unavailable"],
    ["exclusive loan", mutable, "unavailable"], ["unproved generic", parameter, "unavailable"]]) {
    assert.equal(selectRustCloneRequirements(instance(value), definitions).kind, expected, label);
  }
  assert.equal(selectRustCloneRequirements(open, definitions, identity => identity === parameter.identity).kind,
    "available", "the same template consumes an exact declared conditional bound");
  assert.throws(() => registry.registerSourceObjectPhysicalDefinition(selected), /sealed/u,
    "the completed store cannot acquire a different physical proof after publication");
});

test("native handles and markers do not inherit Clone from their stored payload, while an actual non-Clone field forbids it", () => {
  const registry = createRustTypeDefinitionRegistry();
  const handle = rustSourceTypeCarrier("/clone.ts", "Handle", "object", [{ kind: "type", type: parameter }]);
  const blocked = rustSourceTypeCarrier("/clone.ts", "Counter", "object");
  assert.equal(registry.registerSourceObjectPhysicalDefinition({ carrier: handle, fields: [
    field("retained_frame", { kind: "unconditional" }), field("marker", { kind: "unconditional" }),
  ] }), true, "the selected native Rc and PhantomData fields have unconditional native Clone");
  assert.equal(registry.registerSourceObjectPhysicalDefinition({ carrier: blocked,
    fields: [field("counter", { kind: "unavailable" })] }), true, "an actual FrameEntryCounter has no Clone implementation");
  assert.equal(selectRustCloneRequirements(handle, registry).kind, "available", "a native Rc handle does not require Value: Clone");
  assert.equal(selectRustCloneRequirements(blocked, registry).kind, "unavailable", "a non-Clone physical field is never suppressed");
  const nativeContainer = rustNamedTargetType("native.Container", "native::Container", [{ kind: "type", type: instance(parameter) }], [], {
    implementations: [{ trait: rustNativeTraitRef("core::clone::Clone"), requirements: [{ typeArgumentIndex: 0,
      trait: rustNativeTraitRef("core::clone::Clone") }] }],
  });
  assert.equal(selectRustCloneRequirements(nativeContainer, registry).kind, "required", "a conditional native container transports an incomplete source-field requirement");
});

const sourceText = `
export class Item<Value> {
  constructor(public value: Value) {}
}
export class Marker<Value> {
  constructor(public value: number) {}
}
export interface Entry<Value> { value: Value; }
export type Choice<Value> = Value | number;
export function make<Value>(value: Value): Item<Value> { return new Item(value); }
export function duplicate<Value>(value: Item<Value>): [Item<Value>, Item<Value>] { return [value, value]; }
export function marker<Value>(value: number): Marker<Value> { return new Marker<Value>(value); }
export function entry<Value>(value: Value): Entry<Value> { return { value }; }
export function choice<Value>(value: Value): Choice<Value> { return value; }
`;

for (const surface of ["native", "js"]) {
  test(`conditional native class and interface Clone preserve moves, marker bounds, union payloads and handwritten costs (${surface})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces: surface === "native" ? [] : [surface],
        target: { id: "rust", options: { outputType: "lib", crateName: "native_clone_admission" } },
        files: { "index.ts": sourceText } });
      assertNoTargetDiagnostics(result.diagnostics);
      const program = result.program;
      assert.equal(program !== undefined && result.plan !== undefined, true, "native obligations close before planning");
      const sourceFile = program.sourceFiles.find(file => program.source.ast.getFileName(file) === "/src/index.ts");
      for (const name of ["Item", "Marker", "Entry"]) {
        const declaration = program.projectTypes.definitions.find(definition => definition.targetName === name)?.declaration;
        assert.equal(declaration !== undefined, true, `${name}: actual source declaration`);
        const form = program.nativeDeclarations.get(declaration);
        assert.equal(form !== undefined && Object.isFrozen(form.physical), true, `${name}: completed immutable native field selection`);
        const raw = program.typeDefinitions.sourceObjectPhysicalDefinition(form.physical.definition.carrier);
        assert.equal(raw !== undefined && Object.isFrozen(raw.fields), true, `${name}: canonical physical template is sealed`);
        assert.equal(raw.fields.length, form.physical.fields.length, `${name}: the exact emitted field vector is complete`);
        assert.equal(raw.fields.every((field, index) => field.name === form.physical.fields[index].name), true,
          `${name}: emission and trait admission share field identities`);
      }
      assert.equal(sourceFile !== undefined, true, "the original source is published");
      const generated = artifactText(result, "src/index.rs");
      assert.equal(/#\[derive\(Clone\)\]\s*pub struct Item/u.test(generated), false,
        "an unconditional derive never imposes an accidental declaration-wide payload bound");
      const nativeControl = `
#[cfg(test)]
mod conditional_clone_native_control {
    use super::*;
    use core::cell::Cell;
    ${nativeOwnershipCostSupport}

    struct NoClone(i32);
    struct Counted<'owner> { clones: &'owner Cell<usize>, drops: &'owner Cell<usize> }
    impl Clone for Counted<'_> {
        fn clone(&self) -> Self {
            self.clones.set(self.clones.get() + 1);
            Self { clones: self.clones, drops: self.drops }
        }
    }
    impl Drop for Counted<'_> { fn drop(&mut self) { self.drops.set(self.drops.get() + 1); } }
    fn handwritten<Value: Clone>(value: Value) -> (Value, Value) { (value.clone(), value) }

    #[test]
    fn non_clone_moves_and_conditional_native_costs() {
        let original = make(NoClone(7));
        let moved = original.value;
        assert_eq!(moved.0, 7);
        let marked = marker::<NoClone>(9.0);
        assert_eq!(marked.clone().value, 9.0);
        assert_eq!(entry(NoClone(11)).value.0, 11);
        let _ = choice(NoClone(13));
        let clones = Cell::new(0);
        let drops = Cell::new(0);
        let (actual, actual_cost) = measure(|| duplicate(make(Counted { clones: &clones, drops: &drops })));
        assert_eq!(clones.get(), 1);
        assert_eq!(drops.get(), 0);
        drop(actual);
        assert_eq!(drops.get(), 2);
        let native_clones = Cell::new(0);
        let native_drops = Cell::new(0);
        let (native, native_cost) = measure(|| handwritten(Counted { clones: &native_clones, drops: &native_drops }));
        assert_eq!(clones.get(), native_clones.get());
        drop(native);
        assert_eq!(drops.get(), native_drops.get());
        assert_eq!(actual_cost, native_cost);
        assert_eq!(actual_cost, Cost::default());
    }
}
`;
      const project = writeGeneratedProject(`native-clone-admission-${surface}`, result.artifacts.map(artifact =>
        artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + nativeControl } : artifact));
      const log = join(project, "native-clone-proof.log");
      for (const arguments_ of [["generate-lockfile", "--offline"], ["fmt", "--all"], ["fmt", "--all", "--check"],
        ["check", "--all-targets", "--locked", "--offline"],
        ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"],
        ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]]) {
        const startedAt = new Date();
        const native = runCargo(project, arguments_);
        appendFileSync(log, `${JSON.stringify({ command: ["cargo", ...arguments_], startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(), durationSeconds: (Date.now() - startedAt.getTime()) / 1000,
          exitCode: native.status })}\n${native.stdout}\n${native.stderr}\n`);
      }
    });
}
