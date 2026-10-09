import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlan } from "../../../../dist/analysis/objects/structural-shape-plan.js";
import { rustStructuralObjectTargetType } from "../../../../dist/target-model/types/index.js";
import { rustStructuralUsageKey, structuralFieldKey } from "../../../../dist/backend/planner/liveness/generated-item-usage-helpers.js";
import { analyzeRustGeneratedItemUsage } from "../../../../dist/backend/planner/liveness/generated-item-usage.js";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { rustClassValueFactKey } from "../../../../dist/analysis/facts/class-values.js";
import { rustCallableTargetType, rustSourceOptionalTargetType, rustSourceTypeCarrier, rustVecTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

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

test("emitted array elements and class-view signatures reify exact types without constructing payloads", () => {
  const node = fakeStatement({ kindName: "KindIdentifier" });
  const sourceFile = fakeSourceFile({ statements: [node] });
  const classes = ["Element", "Parameter", "Unused"].map(name => ({ kind: "class",
    declaration: {}, carrier: rustSourceTypeCarrier("/index.ts", name, "object") }));
  const ast = { ...fakeAstReader([sourceFile]), forEachChild: (current, visit) => {
    if (current === sourceFile) visit(node);
  } };
  const input = { ast, sourceFiles: [sourceFile], declarations: [],
    projectTypes: { definitions: classes, isPolymorphic: () => false, definitionForDeclaration: () => undefined,
      definitionForCarrier: carrier => classes.find(definition => rustTargetTypeRefEquals(definition.carrier, carrier)) },
    classValues: { instanceViews: [], instanceViewFor: () => undefined },
    declarationGenericRequirements: { projectionImplementationsFor: () => [] },
    typeDefinitions: emptyRustTypeDefinitions, typeFamilies: { implementations: [] },
    structuralShapes: { unionForCarrier: () => undefined, definitionForCarrier: () => undefined },
  };
  const cases = [
    { key: rustTargetOperationFactKey, fact: { kind: "array-literal", contributions: [],
      elementCarrier: rustVecTargetType(rustSourceOptionalTargetType(classes[0].carrier)) }, expected: classes[0] },
    { key: rustClassValueFactKey, fact: { declaration: {}, sourceCarrier: classes[1].carrier,
      carrier: rustStructuralObjectTargetType("/index.ts", []) }, expected: classes[1],
      view: { fields: [{ callable: { carrier: rustCallableTargetType([
        rustSourceOptionalTargetType(classes[1].carrier),
      ], { kind: "tuple", elements: [] }), resultAdapter: { kind: "identity" } } }] } },
  ];
  for (const entry of cases) {
    const usage = analyzeRustGeneratedItemUsage({ ...input,
      facts: { getRuntimeCarrierFact: () => undefined,
        getFact: (subject, key) => subject === node && key === entry.key ? entry.fact : undefined },
      classValues: { ...input.classValues, viewFor: () => entry.view },
    });
    for (const definition of classes) {
      const retained = definition === entry.expected;
      assert.equal(usage.isProjectTypeUsed(definition.declaration), retained, "exact emitted type use");
      assert.equal(usage.isProjectTypeReified(definition.declaration), retained, "recursive native reification");
      assert.equal(usage.isProjectTypeConstructed(definition.declaration), false, "no instance construction");
      assert.equal(usage.isProjectConstructorInvoked(definition.declaration), false, "no constructor invocation");
      assert.equal(usage.isAuthoredFieldRead(definition.declaration), false, "no invented field read");
    }
  }
});
