import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlan, createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { rustGenericCallableTargetType, rustGenericCallableProtocol, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("structural storage unifies exact component contracts without erasing other differences", () => {
  const primitive = name => ({ kind: "source-primitive", name });
  const field = (type, properties = {}) => ({ sourceName: "count", type, presence: "required", readonly: false, ...properties });
  const shapes = [
    ["/first.ts", field(primitive("int32"))],
    ["/second.ts", field(primitive("int32"))],
    ["/external.ts", field(primitive("int32"))],
    ["/width.ts", field(primitive("int64"))],
    ["/signed.ts", field(primitive("uint32"))],
    ["/optional.ts", field(primitive("int32"), { presence: "optional" })],
    ["/readonly.ts", field(primitive("int32"), { readonly: true })],
    ["/accessor.ts", field(primitive("int32"), { accessor: { getter: true, setter: true } })],
  ].map(([owner, value]) => ({
    sourceType: {}, carrier: rustStructuralObjectTargetType(owner, [value]), storage: "structural-object", fields: [],
  }));
  const plan = createRustStructuralShapePlan(shapes, [], file => file === "/external.ts" ? "dependency" : "app", []);
  assert.equal(plan.definitions.length, 7);
  const selected = shapes.map(shape => plan.definitionForCarrier(shape.carrier));
  assert.equal(selected[0].targetName, selected[1].targetName);
  assert.notEqual(selected[0].componentId, selected[2].componentId);
  for (const other of selected.slice(3)) assert.notEqual(other.targetName, selected[0].targetName);
  assert.equal(selected[0].carrier, shapes[0].carrier);
  assert.equal(selected[1].carrier, shapes[1].carrier);
  assert.equal(plan.sharesStorage(shapes[0].carrier, shapes[1].carrier), true);
  for (const other of shapes.slice(2)) {
    assert.equal(plan.sharesStorage(shapes[0].carrier, other.carrier), false);
  }
  assert.equal(plan.sharesStorage(shapes[0].carrier, primitive("int32")), false);
});

test("structural stored callable lifetimes instantiate through exact generic layout evidence", () => {
  const integer = { kind: "source-primitive", name: "int64" };
  const floating = { kind: "source-primitive", name: "float64" };
  const carrier = (lifetime, value = integer, readonly = false) => rustStructuralObjectTargetType("/source.ts", [{
    sourceName: "callback", type: rustCallableTargetType([value], value, lifetime), presence: "required", readonly,
  }]);
  const template = carrier({ kind: "placeholder" });
  const owned = carrier({ kind: "static" });
  const borrowed = carrier({ kind: "parameter", identity: "input", name: "input" });
  const plan = createRustStructuralShapePlan([template, owned, borrowed].map(carrier => ({ carrier })), [],
    () => "source", [], [ { template, instance: owned }, { template, instance: borrowed } ]);
  assert.equal(plan.definitions.length, 1);
  assert.deepEqual(plan.definitionForCarrier(owned).genericArguments, [{ kind: "lifetime", lifetime: { kind: "static" } }]);
  assert.deepEqual(plan.definitionForCarrier(borrowed).genericArguments, [{ kind: "lifetime",
    lifetime: { kind: "parameter", identity: "input", name: "input" } }]);
  assert.equal(plan.sharesStorage(owned, borrowed), false);
  assert.equal(plan.definitionForCarrier(carrier({ kind: "static" }, floating)), undefined);
  assert.equal(plan.definitionForCarrier(carrier({ kind: "static" }, integer, true)), undefined);
  assert.ok(Object.isFrozen(plan.definitionForCarrier(owned)));
});

test("physical structural templates unify lifted generic terms while retaining exact logical selections", () => {
  const parameter = name => ({ kind: "type-parameter", identity: name, name });
  const projected = (owner, name) => ({ kind: "associated-type", owner,
    trait: { kind: "trait-ref", id: "native::Family", path: "native::Family", genericArguments: [], associatedConstraints: [] }, name });
  const shape = (type, file = "/source.ts", properties = {}) => rustStructuralObjectTargetType(file, [
    { sourceName: "value", type, presence: "required", readonly: false, ...properties },
  ]);
  const first = shape(projected(parameter("Owner"), "Output"));
  const second = shape(projected(parameter("Other"), "Output"));
  const differentProjection = shape(projected(parameter("Owner"), "Alternate"));
  const direct = shape(parameter("Value"));
  const distinct = [shape(parameter("Value"), "/external.ts"), shape(parameter("Value"), "/source.ts", { readonly: true }),
    shape({ kind: "source-primitive", name: "int32" }), shape({ kind: "source-primitive", name: "uint32" })];
  const carriers = [first, second, differentProjection, direct, ...distinct];
  for (const values of [carriers, [...carriers].reverse()]) {
    const plan = createRustStructuralShapePlan(values.map(carrier => ({ carrier })), [],
      file => file === "/external.ts" ? "external" : "source", []);
    assert.equal(plan.definitions.length, 5);
    const selected = carriers.map(carrier => plan.definitionForCarrier(carrier));
    for (const definition of selected.slice(0, 4)) {
      assert.equal(definition.targetName, selected[0].targetName);
      assert.equal(definition.genericArguments.length, 1);
    }
    for (const [index, definition] of selected.entries()) assert.equal(definition.carrier, carriers[index]);
    assert.deepEqual(selected[0].genericArguments, [{ kind: "type", type: projected(parameter("Owner"), "Output") }]);
    assert.deepEqual(selected[2].genericArguments, [{ kind: "type", type: projected(parameter("Owner"), "Alternate") }]);
    assert.equal(plan.sharesStorage(first, second), false);
    assert.equal(plan.sharesStorage(first, differentProjection), false);
    assert.equal(plan.sharesStorage(first, shape(projected(parameter("Owner"), "Output"))), true);
    for (const other of distinct) assert.equal(plan.sharesStorage(first, other), false);
    assert.ok(Object.isFrozen(selected[0]) && Object.isFrozen(selected[0].genericArguments));
  }
});

test("structural templates retain method storage under exact native binder renaming", () => {
  const parameter = name => ({ kind: "type-parameter", identity: name, name });
  const origin = { fileName: "/source.ts", declarationIdentity: "identity" };
  const method = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), origin);
  const carrier = (owner, selectedMethod = method, readonly = false, file = "/source.ts") => rustStructuralObjectTargetType(file, [
    { sourceName: "owner", type: owner, presence: "required", readonly },
    { sourceName: "identity", type: selectedMethod, presence: "required", readonly: false, method: true },
  ]);
  const template = carrier(parameter("Owner"));
  const plan = createRustStructuralShapePlan([{ carrier: template }], [], file => file === "/external.ts" ? "external" : "source", []);
  const renamed = carrier(parameter("Environment"));
  const definition = plan.definitionForCarrier(renamed);
  assert.ok(definition);
  assert.equal(definition.targetName, plan.definitionForCarrier(template).targetName);
  assert.deepEqual(definition.genericArguments, [{ kind: "type", type: parameter("Environment") }]);
  const methodIndex = definition.fields.findIndex(field => field.sourceName === "identity");
  assert.ok(methodIndex >= 0);
  const storage = plan.field(renamed, methodIndex).methodStorageCarrier;
  assert.deepEqual(rustGenericCallableValue(storage).signature, rustGenericCallableValue(plan.field(template, methodIndex).methodStorageCarrier).signature);
  assert.deepEqual(rustGenericCallableValue(storage).environment, [parameter("Environment")]);
  assert.deepEqual(rustGenericCallableProtocol(storage, [parameter("Selected")]), { parameters: [renamed, parameter("Selected")], result: parameter("Selected") });
  assert.ok(Object.isFrozen(definition) && Object.isFrozen(plan.field(renamed, methodIndex)));
  const differentMethod = rustGenericCallableTargetType([parameter("Value")], [parameter("Value")], parameter("Value"), { ...origin, declarationIdentity: "different" });
  for (const wrong of [carrier(parameter("Environment"), differentMethod), carrier(parameter("Environment"), method, true),
    carrier(parameter("Environment"), method, false, "/external.ts")]) assert.equal(plan.definitionForCarrier(wrong), undefined);
  assert.equal(plan.field(renamed, -1), undefined);
});

test("structural instantiation diamonds require one ultimate template in either insertion order", () => {
  const carrier = type => rustStructuralObjectTargetType("/source.ts", [{
    sourceName: "value", type, presence: "required", readonly: false,
  }]);
  const template = carrier({ kind: "type-parameter", identity: "Value", name: "Value" });
  const middle = carrier({ kind: "array", element: { kind: "type-parameter", identity: "Element", name: "Element" } });
  const instance = carrier({ kind: "array", element: { kind: "source-primitive", name: "int32" } });
  const shapes = [template, middle, instance].map(carrier => ({ carrier }));
  const edges = [{ template, instance: middle }, { template: middle, instance }, { template, instance }];
  for (const instantiations of [edges, [...edges].reverse()]) {
    const plan = createRustStructuralShapePlan(shapes, [], () => "source", [], instantiations);
    assert.equal(plan.definitions.length, 1);
    const definitions = [template, middle, instance].map(carrier => plan.definitionForCarrier(carrier));
    assert.equal(definitions[0].targetName, definitions[1].targetName);
    assert.equal(definitions[0].targetName, definitions[2].targetName);
    assert.deepEqual(definitions[2].genericArguments, [{ kind: "type", type: {
      kind: "array", element: { kind: "source-primitive", name: "int32" },
    } }]);
    assert.equal(plan.sharesStorage(template, instance), false);
    assert.equal(plan.sharesStorage(middle, instance), false);
    assert.equal(plan.sharesStorage(instance, carrier({ kind: "array", element: { kind: "source-primitive", name: "int32" } })), true);
  }
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "source", [], edges.slice(1)),
    /contradictory storage templates/u);
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "source", [], [
    ...edges, { template: instance, instance: template },
  ]), /cyclic storage templates/u);
});

test("physical method installation completes canonical and already indexed borrowed instances once", () => {
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  const integer = { kind: "source-primitive", name: "int32" };
  const borrowedLifetime = { kind: "parameter", identity: "borrowed", name: "borrowed" };
  const carrier = (value, lifetime) => rustStructuralObjectTargetType("/source.ts", [{
    sourceName: "read", type: rustCallableTargetType([], value, lifetime), presence: "required", readonly: false, method: true,
  }]);
  const template = carrier(parameter, { kind: "placeholder" });
  const owned = carrier(integer, { kind: "static" });
  const borrowed = carrier(parameter, borrowedLifetime);
  const builder = createRustStructuralShapePlanRegistry();
  builder.initialize([template, owned, borrowed].map(carrier => ({ carrier })), [], () => "source", [], [
    { template, instance: owned }, { template, instance: borrowed },
  ]);
  builder.initializeUnions([]);
  const before = builder.definitionForCarrier(owned);
  const definition = builder.definitions[0];
  const logical = definition.fields[0].carrier;
  const protocol = rustCallableProtocol(definition.fields[0].methodStorageCarrier);
  const infallible = { kind: "target-named", id: "rust.core.Infallible" };
  const object = {};
  const property = {};
  const expression = {};
  const destinationCarrier = rustCallableTargetType(protocol.parameters, protocol.result, protocol.lifetime, infallible);
  const physicalCarrier = rustNamedTargetType("rust.runtime.Callable", "rt::Callable", [
    { kind: "lifetime", lifetime: protocol.lifetime },
    { kind: "type", type: { kind: "tuple", elements: protocol.parameters } },
    { kind: "type", type: rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: protocol.result }, { kind: "type", type: infallible },
    ]) },
  ]);
  builder.finalizeMethodStorage(new Map([[definition, new Map([[0,
    { carrier: destinationCarrier, constructions: [{ object, property, expression, storageIndex: 0,
      physicalCarrier, destinationCarrier }] },
  ]])]]));
  const after = builder.seal();
  assert.equal(after.definitions[0].fields[0].carrier === logical, true, "logical method contract remains unchanged");
  assert.equal(after.definitionForCarrier(owned) === before, false, "the indexed instance is replaced with the completed definition");
  for (const [source, expectedResult, expectedLifetime] of [
    [owned, integer, { kind: "static" }], [borrowed, parameter, borrowedLifetime],
  ]) {
    const field = after.field(source, 0);
    const selected = rustCallableProtocol(field.methodStorageCarrier);
    assert.deepEqual(selected.result, expectedResult, "the physical result is forward substituted");
    assert.deepEqual(selected.lifetime, expectedLifetime, "the destination lifetime is forward substituted");
    assert.deepEqual(selected.error, infallible, "the completed invocation error is selected before publication");
    assert.equal(Object.isFrozen(field), true, "completed fields are immutable");
    assert.equal(after.field(source, 0) === field, true, "completed indexed lookups have stable identity");
    assert.equal(field.methodConstructions.length, 1, "the exact original contribution has one completed physical witness");
    const construction = field.methodConstructions[0];
    assert.equal(construction.object === object && construction.property === property && construction.expression === expression,
      true, "template instantiation preserves every original construction identity");
    assert.equal(construction.storageIndex, 0, "the original target field index is retained");
    assert.equal(Object.isFrozen(field.methodConstructions) && Object.isFrozen(construction), true,
      "published construction witnesses are immutable");
    assert.equal(rustTargetTypeRefEquals(construction.destinationCarrier, field.methodStorageCarrier), true,
      "the whole witness uses the same finalized destination instance");
    const physical = rustCallablePhysicalSignature(construction.physicalCarrier);
    assert.equal(physical !== undefined, true, "the original physical construction signature remains exact");
    assert.equal(rustTargetTypeRefEquals(physical.result, expectedResult), true,
      "native construction and destination results receive the same actual generic substitution");
    assert.equal(rustTargetTypeRefEquals(physical.error, infallible), true,
      "native construction retains the selected exact error payload");
  }
  assert.throws(() => builder.finalizeMethodStorage(new Map()), /exactly once/u);
});

test("physical method witnesses reject mismatched complete signatures before publishing any field", () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const floating = { kind: "source-primitive", name: "float64" };
  const lifetime = { kind: "static" };
  const infallible = { kind: "target-named", id: "rust.core.Infallible" };
  const otherError = { kind: "target-named", id: "source.NativeError" };
  const shape = rustStructuralObjectTargetType("/source.ts", [{ sourceName: "read",
    type: rustCallableTargetType([integer], integer, lifetime), presence: "required", readonly: false, method: true }]);
  const physical = (parameters, result, error) => rustNamedTargetType("rust.runtime.Callable", "rt::Callable", [
    { kind: "lifetime", lifetime },
    { kind: "type", type: { kind: "tuple", elements: parameters } },
    { kind: "type", type: rustNamedTargetType("rust.core.Result", "Result", [
      { kind: "type", type: result }, { kind: "type", type: error },
    ]) },
  ]);
  for (const label of ["input", "result", "error", "logical source", "destination", "field index"]) {
    const builder = createRustStructuralShapePlanRegistry();
    builder.initialize([{ carrier: shape }], [], () => "source", []);
    builder.initializeUnions([]);
    const definition = builder.definitions[0];
    const original = builder.field(shape, 0);
    const protocol = rustCallableProtocol(original.methodStorageCarrier);
    const destinationCarrier = rustCallableTargetType(protocol.parameters, protocol.result, protocol.lifetime, infallible);
    const witness = { object: {}, property: {}, expression: {}, storageIndex: 0,
      physicalCarrier: physical(protocol.parameters, protocol.result, infallible), destinationCarrier };
    if (label === "input") witness.physicalCarrier = physical([...protocol.parameters, floating], protocol.result, infallible);
    if (label === "result") witness.physicalCarrier = physical(protocol.parameters, floating, infallible);
    if (label === "error") witness.physicalCarrier = physical(protocol.parameters, protocol.result, otherError);
    if (label === "logical source") witness.physicalCarrier = destinationCarrier;
    if (label === "destination") witness.destinationCarrier = rustCallableTargetType(protocol.parameters, floating, lifetime, infallible);
    if (label === "field index") witness.storageIndex = 1;
    const selections = new Map([[definition, new Map([[0, { carrier: destinationCarrier, constructions: [witness] }]])]]);
    assert.throws(() => builder.finalizeMethodStorage(selections), /Structural method construction requires/u,
      `${label}: a whole invalid witness is rejected at the publishing boundary`);
    assert.equal(builder.field(shape, 0) === original, true,
      `${label}: failed admission publishes no partially replaced field`);
    assert.equal(builder.field(shape, 0).methodConstructions === undefined, true,
      `${label}: failed admission publishes no construction evidence`);
  }
});
