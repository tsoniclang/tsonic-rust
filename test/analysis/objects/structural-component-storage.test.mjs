import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";

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

test("structural instantiation diamonds require one ultimate template in either insertion order", () => {
  const carrier = type => rustStructuralObjectTargetType("/source.ts", [{
    sourceName: "value", type, presence: "required", readonly: false,
  }]);
  const template = carrier({ kind: "type-parameter", name: "Value" });
  const middle = carrier({ kind: "array", element: { kind: "type-parameter", name: "Element" } });
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
