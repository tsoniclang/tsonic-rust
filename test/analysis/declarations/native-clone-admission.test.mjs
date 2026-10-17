import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue, rustNativeTraitRef,
  rustMoveOnlyNamedTypeTraits, rustNamedTypeRequirementsForArguments } from "../../../dist/target-model/types/carriers/native.js";
import { selectRustCloneRequirements } from "../../../dist/target-model/types/carriers/traits.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustProviderTypeRequirementTrait } from "../../../dist/target-model/operations/type-requirements.js";
import { instantiateProviderTargetType } from "../../../dist/policy/types/resolution/providers.js";
import { materializeProviderCarrier } from "../../../dist/providers/packages/materialization.js";
import { classifyCarrierRequirements } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";

const integer = Object.freeze({ kind: "source-primitive", name: "int32" });
const parameter = Object.freeze({ kind: "type-parameter", identity: "native-clone:Value", name: "Value" });
const instance = value => rustSourceTypeCarrier("/clone.ts", "Holder", "object", [{ kind: "type", type: value }]);
const field = (name, clone) => ({ name, clone });

test("source object Clone is a once-published exact physical field obligation, never a declaration-name promise", () => {
  const registry = createRustTypeDefinitionRegistry();
  const open = instance(parameter);
  assert.equal(selectRustCloneRequirements(open, registry).kind, "required", "an incomplete physical declaration is an obligation, not success");
  const noClone = rustNamedTargetType("native.NoClone", "native::NoClone", [], [], rustMoveOnlyNamedTypeTraits, [], undefined, []);
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
  }, [], undefined, []);
  assert.equal(selectRustCloneRequirements(nativeContainer, registry).kind, "required", "a conditional native container transports an incomplete source-field requirement");
});

test("native TYPE well-formedness requirements keep exact semantic TYPE indexes independently of Clone implementations", () => {
  const registry = createRustTypeDefinitionRegistry();
  const left = { kind: "type-parameter", identity: "native:Left", name: "Left" };
  const right = { kind: "type-parameter", identity: "native:Right", name: "Right" };
  const lifetime = { kind: "lifetime", lifetime: { kind: "parameter", name: "env", identity: "native:env" } };
  const length = { kind: "const", value: { kind: "parameter", identity: "native:Length", name: "Length" } };
  const pattern = { kind: "target-named", id: "native.Ordered", genericArguments: [lifetime, { kind: "type", type: right },
    length, { kind: "type", type: left }] };
  const declaration = { exportId: "native.Ordered", targetCarrier: pattern, genericParameters: [
    { kind: "lifetime", sourceName: "env", targetIdentity: "native:env" },
    { kind: "type", sourceName: "Left", targetIdentity: left.identity },
    { kind: "const", sourceName: "Length", targetIdentity: "native:Length" },
    { kind: "type", sourceName: "Right", targetIdentity: right.identity },
  ], typeRequirements: [
    { identity: left.identity, name: "Left", requirements: ["clone"] },
    { identity: right.identity, name: "Right", requirements: ["copy"] },
  ] };
  const materialized = materializeProviderCarrier(pattern, { "native.Ordered": "native::Ordered" }, {}, [declaration]);
  const relation = { ...declaration, targetCarrier: materialized };
  const noClone = rustNamedTargetType("native.NoClone", "native::NoClone", [], [], rustMoveOnlyNamedTypeTraits, [], undefined, []);
  const arguments_ = value => [{ kind: "lifetime", lifetime: { kind: "static" } }, { kind: "type", type: instance(value) },
    { kind: "const", value: { kind: "integer", value: "3" } }, { kind: "type", type: integer }];
  const selected = instantiateProviderTargetType(relation, arguments_(noClone), registry);
  const native = rustNamedTypeCarrierValue(selected);
  assert.equal(native !== undefined, true, "an early native type carries an obligation instead of fabricating incomplete object Clone");
  assert.equal(native.traits.implementations.length, 0, "type bounds never manufacture a conditional Clone implementation");
  const clone = native.typeRequirements.find(requirement => requirement.trait.path === "core::clone::Clone");
  const copy = native.typeRequirements.find(requirement => requirement.trait.path === "core::marker::Copy");
  assert.equal(clone?.typeArgumentIndex, 1, "Clone belongs to the actual second native TYPE slot, not lifetime/const/source offsets");
  assert.equal(copy?.typeArgumentIndex, 0, "the reordered native integer TYPE slot retains its Copy requirement");
  assert.equal(native.genericArguments.length, 4, "all semantic lifetime, const and TYPE arguments remain present");
  assert.equal(registry.registerSourceObjectPhysicalDefinition({ carrier: instance(parameter),
    fields: [field("value", { kind: "required", carrier: parameter })] }), true, "the actual source field template completes once");
  for (const [label, value, expected] of [["native move-only", noClone, "unsatisfied"], ["native integer", integer, "supported"]]) {
    const carrier = rustNamedTypeCarrierValue(instantiateProviderTargetType(relation, arguments_(value), registry));
    const payload = carrier.genericArguments.filter(argument => argument.kind === "type")[clone.typeArgumentIndex].type;
    const result = classifyCarrierRequirements(payload, ["clone"], new Set(), new Map(), () => false, registry, undefined);
    assert.equal(result.kind, expected, `${label}: the final sole classifier discharges the exact native type obligation`);
  }
  assert.equal(rustNamedTypeRequirementsForArguments(pattern.genericArguments, [{ identity: "foreign",
    traits: [rustProviderTypeRequirementTrait("clone")] }]) === undefined, true,
  "the sole native geometry refuses an unmapped requirement instead of guessing an argument index");

  const defaulted = rustNamedTargetType("native.Defaulted", "native::Defaulted", [lifetime, { kind: "type", type: left }],
    [{ kind: "type", type: integer }], rustMoveOnlyNamedTypeTraits, [], undefined,
    [{ typeArgumentIndex: 0, trait: rustProviderTypeRequirementTrait("clone") }]);
  const defaultRelation = { exportId: "native.Defaulted", targetCarrier: defaulted, genericParameters: [relation.genericParameters[0],
    { ...relation.genericParameters[1], defaultArgument: { kind: "type", type: integer } }],
    typeRequirements: [relation.typeRequirements[0]] };
  const selectedDefault = rustNamedTypeCarrierValue(instantiateProviderTargetType({ ...defaultRelation,
    targetCarrier: materializeProviderCarrier(defaulted, {}, {}, [defaultRelation]) },
    [{ kind: "lifetime", lifetime: { kind: "static" } }], registry));
  assert.equal(selectedDefault !== undefined, true, "the actual native generic default is fully instantiated");
  assert.equal(selectedDefault.typeRequirements[0].typeArgumentIndex, 0, "default omission never shifts the semantic TYPE requirement");
  assert.equal(rustTargetTypeRefEquals(selectedDefault.genericArguments[1].type, integer), true,
    "the defaulted semantic argument remains available before syntax normalization");
});

test("one provider trait data conversion preserves full native identity, arguments, associated output and binder", () => {
  const lifetime = Object.freeze({ kind: "bound", binderIdentity: "native-trait-binder",
    identity: "native-trait-binder:loan", name: "loan" });
  const binder = Object.freeze({ identity: lifetime.binderIdentity,
    parameters: Object.freeze([{ lifetime, outlives: [] }]) });
  const arguments_ = Object.freeze([{ kind: "type", type: parameter }, { kind: "lifetime", lifetime }]);
  const associated = Object.freeze([{ kind: "equality", name: "Output", genericArguments: [],
    type: { kind: "reference", mutable: false, lifetime, referent: parameter } }]);
  const requirement = Object.freeze({ kind: "trait", path: "native::Family", genericArguments: arguments_,
    associatedConstraints: associated, lifetimeBinder: binder });
  const selected = rustProviderTypeRequirementTrait(requirement);
  assert.equal(selected.kind, "trait-ref", "the canonical result is native trait data, not a provider selector");
  assert.equal(selected.id, "provider-requirement:native::Family", "the existing complete provider trait identity is preserved");
  assert.equal(selected.path, requirement.path, "the native path is unchanged");
  assert.equal(selected.genericArguments === arguments_, true, "no native TYPE or bound lifetime argument is dropped");
  assert.equal(selected.associatedConstraints === associated, true, "the complete associated output constraint is retained");
  assert.equal(selected.lifetimeBinder === binder, true, "higher-ranked binder identity and scope are unchanged");
  const unbound = rustProviderTypeRequirementTrait({ kind: "trait", path: "native::Unbound",
    genericArguments: [], associatedConstraints: [] });
  assert.equal(Object.hasOwn(unbound, "lifetimeBinder"), false, "an absent binder remains genuine native absence");
  for (const [name, path] of [["clone", "core::clone::Clone"], ["copy", "core::marker::Copy"]]) {
    const standard = rustProviderTypeRequirementTrait(name);
    assert.equal(standard.id, path, `${name}: canonical native standard trait identity`);
    assert.equal(standard.path, path, `${name}: canonical native standard trait path`);
    assert.equal(standard.genericArguments.length, 0, `${name}: no invented generic arguments`);
    assert.equal(standard.associatedConstraints.length, 0, `${name}: no invented associated requirements`);
  }
});

const sourceText = `
export class Item<Value> {
  constructor(public value: Value) {}
}
export class Marker<Value> {
  constructor(public value: number) {}
}
export interface Entry<Value> { value: Value; }
export interface Tagged<Value> { tag(): number; }
export class TagValue<Value> implements Tagged<Value> {
  constructor(public value: number) {}
  tag(): number { return this.value; }
}
export type Choice<Value> = Value | number;
export function make<Value>(value: Value): Item<Value> { return new Item(value); }
export function duplicate<Value>(value: Item<Value>): [Item<Value>, Item<Value>] { return [value, value]; }
export function marker<Value>(value: number): Marker<Value> { return new Marker<Value>(value); }
export function entry<Value>(value: Value): Entry<Value> { return { value }; }
export function tagged<Value>(value: number): Tagged<Value> { return new TagValue<Value>(value); }
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
      for (const name of ["Tagged", "TagValue"]) {
        const definition = program.projectTypes.definitions.find(definition => definition.targetName === name);
        assert.equal(definition !== undefined, true, `${name}: actual polymorphic source declaration`);
        const raw = program.typeDefinitions.sourceObjectPhysicalDefinition(program.projectTypes.openCarrier(definition));
        assert.equal(raw !== undefined && Object.isFrozen(raw.fields), true, `${name}: canonical wrapper fields are sealed`);
        assert.equal(raw.fields.length, 2, `${name}: the native wrapper has exactly its two actual retained handles`);
        assert.equal(raw.fields[0].name, "identity", `${name}: the first actual emitted native field is identity`);
        assert.equal(raw.fields[1].name, "dispatch", `${name}: the second actual emitted native field is dispatch`);
        assert.equal(raw.fields.every(field => field.clone.kind === "unconditional"), true,
          `${name}: ObjectIdentity and Rc native Clone do not acquire the phantom Value bound`);
      }
      assert.equal(sourceFile !== undefined, true, "the original source is published");
      const generated = artifactText(result, "src/index.rs");
      assert.equal(/#\[derive\(Clone\)\]\s*pub struct Item/u.test(generated), false,
        "an unconditional derive never imposes an accidental declaration-wide payload bound");
      const nativeControl = `
#[cfg(test)]
mod conditional_clone_native_control {
    use super::*;
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
        let tagged = tagged::<NoClone>(8.0);
        let tagged_copy = tagged.clone();
        assert_eq!(tagged, tagged_copy);
        assert_eq!(tagged_copy.tag(), 8.0);
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
      const negativeControl = `
#[cfg(test)]
mod native_clone_refusal {
    use super::*;
    struct NoClone;
    fn require_clone<Value: Clone>(_: &Value) {}
    #[test]
    fn payload_clone_is_a_real_native_requirement() {
        require_clone(&make(NoClone));
        require_clone(&entry(NoClone));
        require_clone(&choice(NoClone));
    }
}
`;
      const rejectedProject = writeGeneratedProject(`native-clone-refusal-${surface}`, result.artifacts.map(artifact =>
        artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + negativeControl } : artifact));
      runCargo(rejectedProject, ["generate-lockfile", "--offline"]);
      const negativeArguments = ["check", "--tests", "--locked", "--offline"];
      const negativeStart = new Date();
      const rejected = spawnSync("cargo", negativeArguments, { cwd: rejectedProject, encoding: "utf8",
        env: { ...process.env, CARGO_TERM_COLOR: "never" }, timeout: 300_000 });
      appendFileSync(join(rejectedProject, "native-clone-refusal.log"), `${JSON.stringify({ command: ["cargo", ...negativeArguments],
        startedAt: negativeStart.toISOString(), endedAt: new Date().toISOString(),
        durationSeconds: (Date.now() - negativeStart.getTime()) / 1000, exitCode: rejected.status,
        signal: rejected.signal, error: rejected.error?.message })}\n${rejected.stdout}\n${rejected.stderr}\n`);
      assert.equal(rejected.status !== null && rejected.status !== 0 && rejected.signal === null && rejected.error === undefined,
        true, "native Clone refusal is a completed compiler rejection, not a signal or infrastructure error");
      assert.equal([...rejected.stderr.matchAll(/^error\[E0277\]/gmu)].length, 3,
        "class, record interface and union each require their actual payload's native Clone implementation");
      assert.match(rejected.stderr, /NoClone: Clone/u, "the actual move-only payload is the unsatisfied native requirement");
    });
}
