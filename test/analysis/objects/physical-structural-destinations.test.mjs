import assert from "node:assert/strict";
import test from "node:test";
import { selectRustStructuralPhysicalDestinations } from "../../../dist/analysis/objects/shapes/physical-destinations.js";
import { createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/shapes/structural-shape-plan.js";
import { rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustCallableTargetType, rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustProgramErrorTargetType, rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustProgramErrorOwner } from "../../../dist/target-model/types/carriers/program-errors.js";
import { rustOptionTargetType, rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustSourceOptionalTargetType, rustOptionalStorageProjection } from "../../../dist/target-model/types/projections.js";

const integer = { kind: "source-primitive", name: "int32" };
const lifetime = { kind: "parameter", identity: "storage", name: "storage" };
const field = (sourceName, type, rest = {}) => ({ sourceName, type, presence: "required", readonly: true, ...rest });
const physicalError = file => rustProgramErrorTargetType({ kind: "physical", domain: "project",
  componentId: file === "/dependency.ts" ? "dependency" : "root" });

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
  for (const index of [0, 1]) {
    const value = rustOptionElementCarrier(selected.fields[index].type) ?? selected.fields[index].type;
    const error = rustProgramErrorOwner(rustCallableProtocol(value).error);
    assert.equal(error?.kind === "physical" && error.componentId === "root", true, `field ${index}: exact owning component`);
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(value).parameters[0], integer), true, "input ABI is unchanged");
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(value).result, integer), true, "result ABI is unchanged");
    assert.equal(rustCallableProtocol(value).lifetime.identity, lifetime.identity, "retained lifetime is unchanged");
  }
  for (const [index, error] of [[2, logical], [3, infallible], [4, associated], [5, rustJsValueTargetType()]]) {
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(selected.fields[index].type).error, error), true,
      `field ${index}: actual method, pure, associated and JS source errors are never replaced`);
  }
  const inner = rustStructuralObjectCarrierValue(selected.fields[6].type);
  assert.equal(rustProgramErrorOwner(rustCallableProtocol(inner.fields[0].type).error)?.componentId, "dependency",
    "a nested structural destination never inherits the enclosing component");
  assert.equal(rustProgramErrorOwner(rustCallableProtocol(rustStructuralObjectCarrierValue(shape).fields[0].type).error)?.kind,
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
  const completed = builder.completePhysicalCarrier(instance, instance);
  assert.equal(completed.kind, "resolved", "the existing instance is completed before physical finalization");
  assert.throws(() => builder.finalizeMethodStorage(new Map()),
    error => String(error.message).includes("complete declared-component error selection"),
    "the removed incomplete finalization API is rejected without a fallback");
  builder.finalizeMethodStorage(new Map(), physicalError);
  const selected = builder.definitionForCarrier(instance);
  assert.equal(selected !== undefined, true, "the original logical source key reads its exact physical instance");
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
  assert.equal(wide !== undefined, true, "a later exact logical generic application instantiates the same physical template");
  assert.equal(rustCallableProtocol(wide.fields[0].carrier).result.name, "int64", "the exact new native argument is retained");
  const wideShape = rustStructuralObjectCarrierValue(wider);
  for (const [label, altered] of [
    ["foreign component", rustStructuralObjectTargetType("/dependency.ts", wideShape.fields)],
    ["field role", rustStructuralObjectTargetType("/root.ts", wideShape.fields.map(value => ({ ...value, method: true })))],
    ["mutability", rustStructuralObjectTargetType("/root.ts", wideShape.fields.map(value => ({ ...value, readonly: false })))],
    ["error owner", rustStructuralObjectTargetType("/root.ts", [field("invoke", rustCallableTargetType(
      [integer], integer, lifetime, physicalError("/dependency.ts")), { bound: true })])],
  ]) assert.equal(builder.definitionForCarrier(altered), undefined, `${label}: exact source correspondence cannot be relaxed`);
  const plan = builder.seal();
  assert.equal(plan.definitionForCarrier(instance) === selected, true, "sealing preserves original lookup identity");
  assert.equal(plan.definitionForCarrier(wider) === wide, true, "sealing preserves the admitted late logical application");
  assert.equal(plan.definitions.length, 1, "there is one canonical physical definition, not old/new variants");
  assert.throws(() => builder.finalizeMethodStorage(new Map(), physicalError), /exactly once/u,
    "destination error selection cannot be recomputed after publication");
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
