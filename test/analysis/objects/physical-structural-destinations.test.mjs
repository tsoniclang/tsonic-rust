import assert from "node:assert/strict";
import test from "node:test";
import { selectRustStructuralPhysicalDestinations } from "../../../dist/analysis/objects/shapes/physical-destinations.js";
import { createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/shapes/structural-shape-registry.js";
import { rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustCallableTargetType, rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustProgramErrorTargetType, rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustProgramErrorOwner } from "../../../dist/target-model/types/carriers/program-errors.js";
import { rustOptionTargetType, rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustSourceOptionalTargetType, rustOptionalStorageProjection } from "../../../dist/target-model/types/projections.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { selectRustStructuralEmission } from "../../../dist/policy/types/objects/structural-emission.js";
import { selectRustPhysicalProgramErrorOwnerForFile } from "../../../dist/analysis/errors/error-types.js";

const integer = { kind: "source-primitive", name: "int32" };
const lifetime = { kind: "parameter", identity: "storage", name: "storage" };
const field = (sourceName, type, rest = {}) => ({ sourceName, type, presence: "required", readonly: true, ...rest });
const physicalError = file => rustProgramErrorTargetType({ kind: "physical", domain: "project",
  componentId: file === "/dependency.ts" ? "dependency" : "root" });

test("same-layout physical instances retain independent canonical lifetimes and authored type binders", () => {
  const parameter = Object.freeze({ kind: "type-parameter", identity: "canonical:Value", name: "Value" });
  const left = Object.freeze({ kind: "parameter", identity: "canonical:left", name: "left" });
  const right = Object.freeze({ kind: "parameter", identity: "canonical:right", name: "right" });
  const staticLifetime = Object.freeze({ kind: "static" });
  const carrier = (value, leftLifetime, rightLifetime) => rustStructuralObjectTargetType("/root.ts", [
    field("left", rustCallableTargetType([value], value, leftLifetime)),
    field("right", rustCallableTargetType([value], value, rightLifetime)),
  ]);
  const template = carrier(parameter, left, right);
  const instance = carrier(integer, staticLifetime, staticLifetime);
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([{ carrier: template }, { carrier: instance }], [], () => "root", [],
    [{ template, instance }], new Map());
  builder.initializeUnions([]);
  const original = builder.templateForCarrier(instance);
  assert.equal(original !== undefined, true, "the checked source edge owns the canonical generic template");
  assert.equal(builder.completePhysicalCarrier(instance, instance, { kind: "instance" }).kind, "resolved",
    "the actual concrete member instance completes without specializing its owner");
  builder.finalizeMethodStorage(new Map(), physicalError);
  const canonical = builder.templateForCarrier(instance);
  assert.equal(canonical !== undefined, true, "physical finalization retains the same canonical family");
  assert.equal(canonical.genericParameters.filter(value => value.kind === "lifetime").length, 2,
    "independently quantified callable data lifetimes are not replaced with their static actual arguments");
  assert.equal(canonical.genericParameters.filter(value => value.kind === "type").length, 1,
    "an actual integer instance does not remove its authored type binder");
  for (const selected of [left, right]) assert.equal(canonical.genericParameters.some(value =>
    value.kind === "lifetime" && value.lifetime.identity === selected.identity), true,
    selected.name + ": exact independent lifetime identity remains canonical");
  assert.equal(canonical.targetName, original.targetName, "completion does not invent a second native owner");
  const physical = builder.definitionForCarrier(instance);
  assert.equal(physical !== undefined, true, "the original instance still selects its exact physical implementation");
  assert.equal(physical.fields.every(selected => rustCallableProtocol(selected.carrier)?.lifetime.kind === "static"), true,
    "the concrete instance keeps its actual static arguments without retagging the canonical family");
});

test("physical structural destinations preserve source errors and nested component ownership", () => {
  const callable = error => rustCallableTargetType([integer], integer, lifetime, error);
  const logical = rustProgramErrorTargetType();
  const infallible = { kind: "target-named", id: "rust.core.Infallible" };
  const associated = { kind: "associated-type", owner: { kind: "type-parameter", identity: "Input", name: "Input" },
    trait: { kind: "trait-ref", id: "fixture:Invoke", path: "Invoke", genericArguments: [], associatedConstraints: [] },
    name: "InvocationError" };
  const nested = rustStructuralObjectTargetType("/dependency.ts", [field("invoke", callable(logical))]);
  const shape = rustStructuralObjectTargetType("/root.ts", [
    field("invoke", callable(logical)), field("optional", rustOptionTargetType(callable(logical)), { presence: "optional" }),
    field("body", callable(logical), { method: true }), field("pure", callable(infallible)),
    field("associated", callable(associated)), field("js", callable(rustJsValueTargetType())), field("nested", nested),
  ]);
  const selected = rustStructuralObjectCarrierValue(selectRustStructuralPhysicalDestinations(shape, physicalError));
  for (const sourceName of ["invoke", "optional"]) {
    const selectedField = selected.fields.find(field => field.sourceName === sourceName);
    assert.equal(selectedField !== undefined, true, `${sourceName}: the exact canonical field is present`);
    const value = rustOptionElementCarrier(selectedField.type) ?? selectedField.type;
    const error = rustProgramErrorOwner(rustCallableProtocol(value).error);
    assert.equal(error?.kind === "physical" && error.componentId === "root", true, `${sourceName}: exact owning component`);
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(value).parameters[0], integer), true, "input ABI is unchanged");
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(value).result, integer), true, "result ABI is unchanged");
    assert.equal(rustCallableProtocol(value).lifetime.identity, lifetime.identity, "retained lifetime is unchanged");
  }
  for (const [sourceName, error] of [["body", logical], ["pure", infallible], ["associated", associated], ["js", rustJsValueTargetType()]]) {
    const selectedField = selected.fields.find(field => field.sourceName === sourceName);
    assert.equal(selectedField !== undefined, true, `${sourceName}: the exact canonical field is present`);
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(selectedField.type).error, error), true,
      `${sourceName}: actual method, pure, associated and JS source errors are never replaced`);
  }
  const nestedField = selected.fields.find(field => field.sourceName === "nested");
  assert.equal(nestedField !== undefined, true, "the exact nested component field is present");
  const inner = rustStructuralObjectCarrierValue(nestedField.type);
  const innerInvoke = inner.fields.find(field => field.sourceName === "invoke");
  assert.equal(innerInvoke !== undefined, true, "the exact nested callable destination is present");
  assert.equal(rustProgramErrorOwner(rustCallableProtocol(innerInvoke.type).error)?.componentId, "dependency",
    "a nested structural destination never inherits the enclosing component");
  const originalInvoke = rustStructuralObjectCarrierValue(shape).fields.find(field => field.sourceName === "invoke");
  assert.equal(originalInvoke !== undefined, true, "the original exact source callable field is present");
  assert.equal(rustProgramErrorOwner(rustCallableProtocol(originalInvoke.type).error)?.kind,
    "logical", "the original immutable source carrier is untouched");
  assert.throws(() => selectRustStructuralPhysicalDestinations(shape, () => undefined),
    error => String(error.message).includes("declared component's physical error owner"),
    "missing destination ownership cannot be silently replaced with a root or runtime error");
});

test("one physical structural finalization preserves logical keys completed instances and generic applications", () => {
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  const carrier = value => rustStructuralObjectTargetType("/root.ts",
    [field("invoke", rustCallableTargetType([value], value, lifetime), { bound: true })]);
  const template = carrier(parameter);
  const instance = carrier(integer);
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([{ carrier: template }, { carrier: instance }], [], file => file === "/dependency.ts" ? "dependency" : "root", [],
    [{ template, instance }], new Map());
  builder.initializeUnions([]);
  const completed = builder.completePhysicalCarrier(instance, instance, { kind: "instance" });
  assert.equal(completed.kind, "resolved", "the existing instance is completed before physical finalization");
  assert.throws(() => builder.finalizeMethodStorage(new Map()),
    error => String(error.message).includes("complete declared-component error selection"),
    "the removed incomplete finalization API is rejected without a fallback");
  builder.finalizeMethodStorage(new Map(), physicalError);
  const selected = builder.definitionForCarrier(instance);
  assert.equal(selected !== undefined, true, "the original logical source key reads its exact physical instance");
  const canonical = builder.templateForCarrier(instance);
  assert.equal(canonical !== undefined, true, "the completed concrete instance retains its original generic owner");
  assert.equal(canonical.genericParameters.filter(value => value.kind === "type").length, 1,
    "a concrete instance does not specialize its canonical owner's type parameter inventory");
  assert.equal(canonical.genericParameters.some(value => value.kind === "type" && value.identity === parameter.identity), true,
    "the exact authored generic binder remains on the canonical definition");
  assert.equal(rustProgramErrorOwner(rustCallableProtocol(selected.fields[0].carrier).error)?.componentId, "root",
    "field and shape metadata carry the finalized destination error");
  assert.equal(rustTargetTypeRefEquals(rustStructuralObjectCarrierValue(selected.carrier).fields[0].type,
    selected.fields[0].carrier), true, "carrier fields and record fields are the same physical contract");
  const bound = rustNamedTypeCarrierValue(selected.fields[0].boundStorage.carrier);
  assert.equal(rustTargetTypeRefEquals(bound.genericArguments[0].type, selected.fields[0].carrier), true,
    "bound getter and setter retain the canonical physical callable field");
  assert.equal(rustProgramErrorOwner(bound.genericArguments[1].type)?.componentId, "root",
    "bound storage keeps the same actual destination component error");
  assert.equal(builder.definitionForCarrier(selected.carrier) === selected, true, "the physical key shares the same canonical instance");
  const wider = carrier({ kind: "source-primitive", name: "int64" });
  const wide = builder.definitionForCarrier(wider);
  assert.equal(wide, undefined, "an unregistered application has no original checked source-template owner edge");
  const wideShape = rustStructuralObjectCarrierValue(wider);
  for (const [label, altered] of [
    ["foreign component", rustStructuralObjectTargetType("/dependency.ts", wideShape.fields)],
    ["field role", rustStructuralObjectTargetType("/root.ts", wideShape.fields.map(value => ({ ...value, method: true })))],
    ["mutability", rustStructuralObjectTargetType("/root.ts", wideShape.fields.map(value => ({ ...value, readonly: false })))],
    ["error owner", rustStructuralObjectTargetType("/root.ts", [field("invoke", rustCallableTargetType(
      [integer], integer, lifetime, physicalError("/dependency.ts")), { bound: true })])],
  ]) assert.equal(builder.definitionForCarrier(altered), undefined, `${label}: exact source correspondence cannot be relaxed`);
  const completedTemplate = builder.definitionForCarrier(template);
  assert.equal(completedTemplate !== undefined, true, "the original registered template has its physical replacement");
  const plan = builder.seal();
  assert.equal(plan.definitionForCarrier(instance) === selected, true, "sealing preserves original lookup identity");
  assert.equal(plan.definitionForCarrier(wider), undefined, "sealing cannot infer a missing original source owner");
  assert.equal(plan.definitionForCarrier(completedTemplate.carrier) === completedTemplate, true,
    "a finalized physical key is already indexed when sealing, without a previous physical lookup");
  assert.equal(plan.definitions.length, 1, "there is one canonical physical definition, not old/new variants");
  assert.throws(() => builder.finalizeMethodStorage(new Map(), physicalError), /exactly once/u,
    "destination error selection cannot be recomputed after publication");
});

test("physical structural completion rejects the removed evidence-free API before publication", () => {
  const source = rustStructuralObjectTargetType("/root.ts", [field("count", integer)]);
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([{ carrier: source }], [], () => "root", [], [], new Map());
  const original = builder.definitionForCarrier(source);
  const selected = builder.completePhysicalCarrier(source, source);
  assert.equal(selected.kind, "unresolved", "the old two-argument completion no longer admits a carrier");
  assert.match(selected.reason, /exact instance or native-input evidence/u,
    "the publishing boundary identifies the missing original completion authority");
  assert.equal(builder.definitionForCarrier(source) === original, true,
    "rejection publishes no replacement instance or alias");
});

test("native structural input applications retain exact source owners and sibling projections in either order", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    type Leaf = { readonly invoke: (value: number) => number };
    type Input = { readonly left: Leaf; readonly right: Leaf };
    export function take(value: Input): void {}
  ` } });
  const inputs = program.callableValues.native.inputs;
  assert.equal(inputs.length, 2, "the original input producer supplies two independently owned data projections");
  const source = rustStructuralObjectTargetType("/root.ts", [field("invoke", inputs[0].carrier)]);
  const physical = input => rustStructuralObjectTargetType("/root.ts", [field("invoke", input.implementation)]);
  const evidence = input => ({ kind: "native-input", owner: input.owner,
    subject: { ...input.subject, projection: input.subject.projection.slice(0, -1),
      projectionKey: input.subject.projectionKey.slice(0, input.subject.projectionKey.lastIndexOf("/")) },
    fields: [{ sourceName: "invoke", subject: input.subject, carrier: input.implementation, inputs: [input] }] });
  for (const order of [inputs, [...inputs].reverse()]) {
    const builder = createRustStructuralShapePlanRegistry();
    builder.initialize([{ carrier: source }], [], () => "root", [], [], new Map());
    const invalid = [
      ["missing inputs", { ...evidence(inputs[0]), fields: [] }, physical(inputs[0])],
      ["foreign owner", { ...evidence(inputs[0]), owner: {} }, physical(inputs[0])],
      ["foreign parameter", { ...evidence(inputs[0]), subject: { ...evidence(inputs[0]).subject, node: {} } }, physical(inputs[0])],
      ["sibling projection", { ...evidence(inputs[0]), fields: evidence(inputs[1]).fields }, physical(inputs[1])],
      ["foreign implementation", evidence(inputs[0]), physical(inputs[1])],
    ];
    for (const [label, selected, carrier] of invalid) {
      const result = builder.completePhysicalCarrier(source, carrier, selected);
      assert.equal(result.kind, "unresolved", `${label}: an unrelated fact cannot authorize the physical field`);
      assert.match(result.reason, /original projected implementation bindings/u,
        `${label}: rejection remains at the one physical completion owner`);
    }
    for (const input of order) assert.equal(builder.completePhysicalCarrier(source, physical(input), evidence(input)).kind,
      "resolved", "each actual projected input registers its own physical application");
    builder.initializeUnions([]);
    builder.finalizeMethodStorage(new Map(), physicalError);
    const plan = builder.seal();
    const applications = inputs.map(input => plan.definitionForCarrier(physical(input)));
    assert.equal(applications.every(instance => instance !== undefined), true,
      "both exact physical input keys are indexed before sealing");
    assert.equal(applications[0] !== applications[1], true,
      "the same Leaf source never conflates two actual implementation binders");
    assert.equal(applications[0].targetName, applications[1].targetName,
      "different scoped arguments instantiate one canonical generic native owner");
    assert.equal(plan.definitions.length, 1, "completion order never creates a competing physical family");
    assert.equal(rustCallableProtocol(plan.definitionForCarrier(source)?.fields[0]?.carrier)?.parameters[0]?.name,
      "float64", "the original source alias retains its declared invocation contract, not the first input binder");
  }
});

test("structural completion retains each native input's exact physical field association", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    import type { int32, int64 } from "@tsonic/core/types.js";
    type Input = { readonly left: (value: int32) => int32; readonly right: (value: int64) => int64 };
    export function take(value: Input): void {}
  ` } });
  const inputs = program.callableValues.native.inputs;
  assert.equal(inputs.length, 2, "the checked producer supplies both original sibling input rows");
  const name = input => program.source.ast.text(program.source.ast.name(input.subject.projection[0].declaration));
  const ordered = ["left", "right"].map(sourceName => inputs.find(input => name(input) === sourceName));
  assert.equal(ordered.every(input => input !== undefined), true, "each physical field has its own original checked member");
  const source = rustStructuralObjectTargetType("/root.ts", ordered.map(input => field(name(input), input.carrier)));
  const physical = order => rustStructuralObjectTargetType("/root.ts",
    ordered.map((input, index) => field(name(input), order[index].implementation)));
  const evidence = { kind: "native-input", owner: ordered[0].owner,
    subject: { ...ordered[0].subject, projection: [], projectionKey: "" }, fields: ordered.map(input => ({
      sourceName: name(input), subject: input.subject, carrier: input.implementation, inputs: [input],
    })) };
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([{ carrier: source }], [], () => "root", [], [], new Map());
  const original = builder.definitionForCarrier(source);
  const inventory = builder.instances.length;
  for (const [label, selected, application] of [
    ["swapped physical fields", physical([...ordered].reverse()), evidence],
    ["swapped evidence carriers", physical(ordered), { ...evidence,
      fields: evidence.fields.map((entry, index) => ({ ...entry, carrier: ordered[1 - index].implementation })) }],
    ["swapped original rows", physical(ordered), { ...evidence,
      fields: evidence.fields.map((entry, index) => ({ ...entry, inputs: [ordered[1 - index]] })) }],
  ]) {
    const rejected = builder.completePhysicalCarrier(source, selected, application);
    assert.equal(rejected.kind, "unresolved", `${label}: aggregate identity membership never proves a field binding`);
    assert.equal(builder.definitionForCarrier(source) === original, true, `${label}: the original source index is unchanged`);
    assert.equal(builder.instances.length, inventory, `${label}: rejected associations publish no native instance`);
  }
  assert.equal(builder.completePhysicalCarrier(source, physical(ordered), evidence).kind, "resolved",
    "the exact original field-to-subject-to-implementation associations are admitted");
  builder.initializeUnions([]);
  builder.finalizeMethodStorage(new Map(), physicalError);
  assert.equal(builder.seal().definitionForCarrier(physical(ordered)) !== undefined, true,
    "the proved physical application survives finalization and sealing");
});

test("structural source completion is monotonic before and after physical finalization", () => {
  const value = { kind: "type-parameter", identity: "canonical:Value", name: "Value" };
  const carrier = type => rustStructuralObjectTargetType("/root.ts", [field("count", type)]);
  const template = carrier(value);
  const narrow = carrier(integer);
  const wide = carrier({ kind: "source-primitive", name: "int64" });
  for (const phase of ["open", "finalized"]) {
    const builder = createRustStructuralShapePlanRegistry();
    builder.initialize([template, narrow, wide].map(carrier => ({ carrier })), [], () => "root", [],
      [narrow, wide].map(instance => ({ template, instance })), new Map());
    builder.initializeUnions([]);
    assert.equal(builder.completePhysicalCarrier(narrow, narrow, { kind: "instance" }).kind, "resolved",
      `${phase}: the original exact native completion is admitted`);
    if (phase === "finalized") builder.finalizeMethodStorage(new Map(), physicalError);
    const original = builder.definitionForCarrier(narrow);
    const wider = builder.definitionForCarrier(wide);
    const inventory = builder.instances.length;
    const rejected = builder.completePhysicalCarrier(narrow, wide, { kind: "instance" });
    assert.equal(rejected.kind, "unresolved", `${phase}: one source key cannot change its native generic arguments`);
    assert.match(rejected.reason, /one exact native implementation/u,
      `${phase}: both phases use the same correspondence admission rule`);
    assert.equal(builder.definitionForCarrier(narrow) === original, true, `${phase}: rejection preserves the source identity`);
    assert.equal(builder.definitionForCarrier(wide) === wider, true, `${phase}: rejection preserves other native applications`);
    assert.equal(builder.instances.length, inventory, `${phase}: rejection leaves the native inventory unchanged`);
    assert.equal(builder.completePhysicalCarrier(narrow, narrow, { kind: "instance" }).kind, "resolved",
      `${phase}: repeating the identical admitted completion stays valid`);
  }
});

test("finalized open structural aliases share one native instance without losing independent widths", () => {
  const carrier = (file, width) => rustStructuralObjectTargetType(file,
    [field("count", { kind: "source-primitive", name: width })]);
  const original = carrier("/original.ts", "int32");
  const alias = carrier("/alias.ts", "int32");
  const wide = carrier("/wide.ts", "int64");
  for (const sources of [[original, alias], [alias, original]]) {
    const builder = createRustStructuralShapePlanRegistry();
    builder.initialize([original, alias, wide].map(carrier => ({ carrier })), [], () => "root", [], [], new Map());
    builder.initializeUnions([]);
    builder.finalizeMethodStorage(new Map(), physicalError);
    for (const source of sources) {
      const selected = builder.completePhysicalCarrier(source, original, { kind: "instance" });
      assert.equal(selected.kind, "resolved", "an already interned physical instance still records each original source alias");
      assert.equal(selected.carrier === builder.definitionForCarrier(original).carrier, true,
        "completion returns the canonical selected native carrier, not a second alias carrier");
    }
    const plan = builder.seal();
    assert.equal(plan.definitionForCarrier(alias) === plan.definitionForCarrier(original), true,
      "finalized open and pre-finalization completion have identical source-alias semantics");
    assert.equal(plan.instances.length, 2, "source aliases enumerate no duplicate physical native instance");
    assert.equal(plan.definitionForCarrier(wide) !== plan.definitionForCarrier(original), true,
      "canonical interning preserves the genuinely different native field width");
  }
});

test("canonical physical interning preserves every native width lifetime and error argument", () => {
  const value = { kind: "type-parameter", identity: "source:Value", name: "Value" };
  const error = { kind: "type-parameter", identity: "source:Error", name: "Error" };
  const infallible = { kind: "target-named", id: "rust.core.Infallible" };
  const nativeError = { kind: "target-named", id: "source.NativeError" };
  const borrowed = { kind: "parameter", identity: "scope:borrowed", name: "borrowed" };
  const carrier = (file, value, environment, error) => rustStructuralObjectTargetType(file,
    [field("invoke", rustCallableTargetType([value], value, environment, error))]);
  const template = carrier("/root.ts", value, lifetime, error);
  const rows = [
    [integer, { kind: "static" }, infallible],
    [{ kind: "source-primitive", name: "int64" }, { kind: "static" }, infallible],
    [integer, borrowed, infallible],
    [integer, { kind: "static" }, nativeError],
  ].map(([value, environment, error]) => ({
    original: carrier("/root.ts", value, environment, error),
    alias: carrier("/alias.ts", value, environment, error),
  }));
  for (const order of [rows, [...rows].reverse()]) {
    const builder = createRustStructuralShapePlanRegistry();
    const carriers = [template, ...rows.flatMap(row => [row.original, row.alias])];
    builder.initialize(carriers.map(carrier => ({ carrier })), [], () => "root", [],
      carriers.slice(1).map(instance => ({ template, instance })), new Map());
    for (const row of order) for (const source of [row.alias, row.original])
      assert.equal(builder.completePhysicalCarrier(source, row.original, { kind: "instance" }).kind, "resolved",
        "the full exact native instance is admitted before publication");
    builder.initializeUnions([]);
    builder.finalizeMethodStorage(new Map(), physicalError);
    const plan = builder.seal();
    const instances = rows.map(row => plan.definitionForCarrier(row.original));
    assert.equal(new Set(instances).size, rows.length,
      "different widths, quantified lifetimes and native errors never intern as the same physical type");
    for (const [index, row] of rows.entries()) assert.equal(plan.definitionForCarrier(row.alias) === instances[index], true,
      "only the proved cross-file alias shares its identical fully instantiated native object");
    assert.equal(plan.definitions.length, 1, "all exact applications retain the declared canonical generic owner");
  }
});

test("checked generic source retention publishes the exact int64 callable-field application before physical sealing", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    import type { int32, int64 } from "@tsonic/core/types.js";
    type Contract<Value> = { readonly invoke: (value: Value) => Value };
    export function narrow(value: Contract<int32>): Contract<int32> { return value; }
    export function wide(value: Contract<int64>): Contract<int64> { return value; }
  ` } });
  const owners = [];
  for (const width of ["int32", "int64"]) {
    const sources = program.structuralShapes.definitions.flatMap(definition => definition.sourceCarriers)
      .filter(carrier => rustStructuralObjectCarrierValue(carrier)?.fields.some(field =>
        field.sourceName === "invoke" && rustCallableProtocol(field.type)?.parameters[0]?.kind === "source-primitive" &&
        rustCallableProtocol(field.type)?.parameters[0]?.name === width));
    assert.equal(sources.length > 0, true, `${width}: the real checked source-retention owner registered its application`);
    for (const source of sources) {
      const selected = program.structuralShapes.definitionForCarrier(source);
      assert.equal(selected !== undefined, true, `${width}: the original registered key resolves without scanning templates`);
      const field = selected.fields.find(field => field.sourceName === "invoke");
      const protocol = rustCallableProtocol(field?.carrier);
      assert.equal(protocol !== undefined, true, `${width}: the admitted callable field remains exact`);
      assert.equal(protocol.parameters[0].name, width, `${width}: the actual native argument is retained`);
      assert.equal(protocol.result.name, width, `${width}: the actual native result is retained`);
      const owner = selectRustPhysicalProgramErrorOwnerForFile(selected.ownerFileName, program.sourcePackageComponents);
      assert.equal(owner !== undefined, true, `${width}: the actual declared component has one physical error classification`);
      assert.equal(rustTargetTypeRefEquals(protocol.error, rustProgramErrorTargetType(owner)), true,
        `${width}: the one physical replacement supplies the complete canonical declared-component error`);
      assert.equal(program.records.structuralShape.get(source) === selected, true,
        `${width}: canonical publication preserves the identical source-to-physical owner`);
      owners.push(`${selected.componentId}\0${selected.targetName}`);
    }
  }
  assert.equal(new Set(owners).size, 1, "both checked applications retain one original generic template owner");
});

test("checked nested structural retention preserves member array tuple and optional component ownership", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
import type { int32, int64 } from "@tsonic/core/types.js";
type Leaf<Value> = { readonly invoke: (value: Value) => Value };
type Nested<Value> = { readonly values: readonly [Leaf<Value>, readonly Leaf<Value>[]]; readonly maybe?: Leaf<Value> };
export function narrow(value: Nested<int32>): Nested<int32> { return value; }
export function wide(value: Nested<int64>): Nested<int64> { return value; }
` } });
  for (const width of ["int32", "int64"]) {
    const applications = program.structuralShapes.definitions.flatMap(definition => definition.sourceCarriers)
      .filter(carrier => rustStructuralObjectCarrierValue(carrier)?.fields.some(field =>
        field.sourceName === "invoke" && rustCallableProtocol(field.type)?.parameters[0]?.name === width));
    assert.equal(applications.length > 0, true, `${width}: nested retention preserves actual checked callable field applications`);
    for (const application of applications) {
      const owner = program.structuralShapes.definitionForCarrier(application);
      const field = owner?.fields.find(field => field.sourceName === "invoke");
      const protocol = rustCallableProtocol(field?.carrier);
      assert.equal(owner !== undefined && protocol !== undefined, true, `${width}: the exact source application has a finalized physical owner`);
      assert.equal(protocol.parameters.length === 1 && protocol.parameters[0].name === width && protocol.result.name === width, true,
        `${width}: recursion preserves the exact native argument and result instead of a sibling application`);
      assert.equal(program.structuralShapes.definitionForCarrier(owner.carrier) === owner, true,
        `${width}: physical and original source keys resolve the same canonical owner`);
    }
  }
});

test("late structural applications reject ambiguous original generic owners", () => {
  const input = { kind: "type-parameter", identity: "Input", name: "Input" };
  const output = { kind: "type-parameter", identity: "Output", name: "Output" };
  const carrier = result => rustStructuralObjectTargetType("/root.ts",
    [field("invoke", rustCallableTargetType([input], result, lifetime))]);
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([{ carrier: carrier(input) }, { carrier: carrier(output) }], [],
    () => "root", [], [], new Map());
  builder.initializeUnions([]);
  builder.finalizeMethodStorage(new Map(), physicalError);
  const ambiguous = rustStructuralObjectTargetType("/root.ts",
    [field("invoke", rustCallableTargetType([integer], integer, lifetime))]);
  assert.equal(builder.definitionForCarrier(ambiguous), undefined,
    "two distinct exact generic source bindings cannot select an arbitrary physical owner");
  assert.equal(builder.definitions.length, 2, "both original owners remain distinct before sealing");
});

test("bound callable access errors remain independent of their exact invocation errors", () => {
  const associated = { kind: "associated-type", owner: { kind: "type-parameter", identity: "Input", name: "Input" },
    trait: { kind: "trait-ref", id: "fixture:Invoke", path: "Invoke", genericArguments: [], associatedConstraints: [] },
    name: "InvocationError" };
  const invocationErrors = [rustProgramErrorTargetType(), { kind: "target-named", id: "rust.core.Infallible" },
    associated, rustJsValueTargetType()];
  const source = rustStructuralObjectTargetType("/dependency.ts", invocationErrors.map((error, index) =>
    field(`invoke${index}`, rustCallableTargetType([integer], integer, lifetime, error), { bound: true })));
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([{ carrier: source }], [], () => "dependency", [], [], new Map());
  builder.initializeUnions([]);
  builder.finalizeMethodStorage(new Map(), physicalError);
  const selected = builder.definitionForCarrier(source);
  assert.equal(selected !== undefined, true, "the original bound callable source has one exact physical definition");
  for (const [index, expected] of invocationErrors.entries()) {
    const field = selected.fields[index];
    const invocation = rustCallableProtocol(field.carrier).error;
    assert.equal(rustTargetTypeRefEquals(invocation, index === 0 ? physicalError("/dependency.ts") : expected), true,
      `field ${index}: inner invocation retains only its own selected error contract`);
    const bound = rustNamedTypeCarrierValue(field.boundStorage.carrier);
    assert.equal(bound.id, "rust.runtime.RecordField", `field ${index}: the original bound location representation is retained`);
    assert.equal(rustTargetTypeRefEquals(bound.genericArguments[0].type, field.carrier), true,
      `field ${index}: bound storage contains the identical selected callable payload`);
    assert.equal(rustTargetTypeRefEquals(bound.genericArguments[1].type, physicalError("/dependency.ts")), true,
      `field ${index}: access has the component's independent error even for pure or non-program invocation`);
  }
  const plan = builder.seal();
  assert.equal(plan.definitionForCarrier(selected.carrier) === selected, true,
    "physical storage is already published before any post-seal lookup");
  const emission = selectRustStructuralEmission({ definition: selected, template: plan.definitions[0],
    genericRequirements: { associatedTypes: [] }, contextConstructors: [], clone: false, copy: false, default: false });
  assert.equal(emission.kind, "selected", "the existing structural syntax policy admits the completed record");
  for (const [index, emitted] of emission.value.fields.entries())
    assert.equal(emitted.carrier === selected.fields[index].boundStorage.carrier, true,
      `field ${index}: native declaration syntax consumes the same access carrier as record loads and stores`);
});

test("physical getter completion preserves native source-absence containers and quantified optional identities", () => {
  const callable = rustCallableTargetType([integer], integer, lifetime);
  const projection = { ...rustOptionalStorageProjection(callable), identity: "authored:Optional", name: "AuthoredOptional" };
  for (const [name, optional] of [
    ["native option", rustOptionTargetType(callable)],
    ["source absence", rustSourceOptionalTargetType(callable)],
    ["quantified optional", projection],
  ]) {
    const source = rustStructuralObjectTargetType("/dependency.ts",
      [field("invoke", optional, { presence: "optional" })]);
    const selected = rustStructuralObjectCarrierValue(selectRustStructuralPhysicalDestinations(source, physicalError)).fields[0].type;
    assert.equal(selected.kind, optional.kind, `${name}: the native container kind is unchanged`);
    assert.equal(Object.hasOwn(selected, "sourceAbsence"), Object.hasOwn(optional, "sourceAbsence"),
      `${name}: absence metadata presence is unchanged`);
    assert.equal(selected.sourceAbsence, optional.sourceAbsence, `${name}: the canonical one-state source absence is unchanged`);
    if (optional.kind === "type-parameter") {
      assert.equal(selected.identity, optional.identity, "the authored optional witness is not rekeyed by physical error selection");
      assert.equal(selected.name, optional.name, "the actual binder spelling is retained");
    } else {
      assert.equal(selected.id, optional.id, `${name}: the same native Option type is retained`);
      assert.equal(selected.genericArguments.length, optional.genericArguments.length, `${name}: the complete generic vector is retained`);
      assert.equal(selected.genericArguments[0].kind, optional.genericArguments[0].kind, `${name}: the exact argument kind is retained`);
    }
    const payload = rustOptionElementCarrier(selected);
    assert.equal(rustProgramErrorOwner(rustCallableProtocol(payload).error)?.componentId, "dependency",
      `${name}: only the callable destination's actual physical error changes`);
    const methodOnly = rustStructuralObjectTargetType("/root.ts",
      [field("body", rustCallableTargetType([optional], integer, lifetime), { method: true })]);
    assert.equal(selectRustStructuralPhysicalDestinations(methodOnly, () => assert.fail("no getter destination is selected")) === methodOnly,
      true, `${name}: an unchanged method witness retains the identical complete source carrier`);
  }
  const absorbent = { kind: "type-parameter", identity: "authored:Absorbent", name: "Absorbent", optionalStorageValue: rustJsValueTargetType() };
  assert.equal(selectRustStructuralPhysicalDestinations(absorbent, () => assert.fail("no structural getter")) === absorbent, true,
    "the generic mapper cannot collapse an existing optional binder whose payload absorbs native absence");
});
