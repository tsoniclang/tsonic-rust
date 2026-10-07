import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { rustGenericCallableTargetType, rustGenericCallableProtocol, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";

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
