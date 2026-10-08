import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlan } from "../../../../dist/analysis/objects/structural-shape-plan.js";
import { rustStructuralObjectTargetType } from "../../../../dist/target-model/types/index.js";
import { rustStructuralUsageKey, structuralFieldKey } from "../../../../dist/backend/planner/liveness/generated-item-usage-helpers.js";

test("generated storage liveness shares only the exact emitted declaration and field slot", () => {
  const parameter = name => ({ kind: "type-parameter", identity: name, name });
  const shape = (type, file = "/source.ts", readonly = false) => rustStructuralObjectTargetType(file, [{
    sourceName: "value", type, presence: "required", readonly,
  }]);
  const first = shape(parameter("First"));
  const second = shape(parameter("Second"));
  const external = shape(parameter("First"), "/external.ts");
  const readOnly = shape(parameter("First"), "/source.ts", true);
  const plan = createRustStructuralShapePlan([first, second, external, readOnly].map(carrier => ({ carrier })),
    [], file => file === "/external.ts" ? "dependency" : "app", []);
  const owner = rustStructuralUsageKey(first, plan);
  assert.equal(owner, rustStructuralUsageKey(second, plan));
  for (const carrier of [external, readOnly, { kind: "source-primitive", name: "int32" }]) {
    assert.notEqual(owner, rustStructuralUsageKey(carrier, plan));
  }
  assert.equal(structuralFieldKey(owner, 0), structuralFieldKey(rustStructuralUsageKey(second, plan), 0));
  assert.notEqual(structuralFieldKey(owner, 0), structuralFieldKey(owner, 1));
  assert.equal(plan.sharesStorage(first, second), false, "a shared generic declaration does not erase logical type identity");
});
