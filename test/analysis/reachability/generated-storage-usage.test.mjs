import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/shapes/structural-shape-plan.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { rustStructuralUsageKey } from "../../../dist/analysis/reachability/generated-item-usage-helpers.js";
import { analyzeRustGeneratedItemUsage } from "../../../dist/analysis/reachability/generated-item-usage.js";
import { createRustGeneratedItemUsageState } from "../../../dist/analysis/reachability/generated-item-usage-state.js";


import { rustCallableTargetType, rustSourceOptionalTargetType, rustSourceTypeCarrier, rustVecTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

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
  const state = createRustGeneratedItemUsageState({ declarations: [], structuralShapes: plan,
    projectTypes: { definitions: [] } });
  state.markStructuralFieldRead(first, 0);
  const usage = state.seal();
  assert.equal(usage.structuralCarriers.get(first).fieldsRead === usage.structuralCarriers.get(second).fieldsRead, true);
  assert.equal(usage.structuralCarriers.get(second).fieldsRead.has(0), true);
  assert.equal(usage.structuralCarriers.get(second).fieldsRead.has(1), false);
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
  const input = { ast, sourceFiles: [sourceFile], nativeNodes: [sourceFile, node], declarations: [],
    projectTypes: { definitions: classes, isPolymorphic: () => false, definitionForDeclaration: () => undefined,
      definitionForCarrier: carrier => classes.find(definition => rustTargetTypeRefEquals(definition.carrier, carrier)) },
    classValues: { instanceViews: [], instanceViewFor: () => undefined },
    declarationGenericRequirements: { projectionImplementationsFor: () => [] },
    typeDefinitions: emptyRustTypeDefinitions, typeFamilies: { implementations: [] },
    structuralShapes: { definitions: [], unionDefinitions: [], unionForCarrier: () => undefined, definitionForCarrier: () => undefined },
  };
  const cases = [
    { key: "targetOperation", fact: { kind: "array-literal", contributions: [],
      elementCarrier: rustVecTargetType(rustSourceOptionalTargetType(classes[0].carrier)) }, expected: classes[0] },
    { key: "classValue", fact: { declaration: {}, sourceCarrier: classes[1].carrier,
      carrier: rustStructuralObjectTargetType("/index.ts", []) }, expected: classes[1],
      view: { fields: [{ callable: { carrier: rustCallableTargetType([
        rustSourceOptionalTargetType(classes[1].carrier),
      ], { kind: "tuple", elements: [] }), resultAdapter: { kind: "identity" } } }] } },
  ];
  for (const entry of cases) {
    const usage = analyzeRustGeneratedItemUsage({ ...input,
      records: createRustRecordFixture({ [entry.key]: { get: subject => subject === node ? entry.fact : undefined } }),
      classValues: { ...input.classValues, viewFor: () => entry.view },
    });
    for (const definition of classes) {
      const retained = definition === entry.expected;
      assert.equal(usage.usedProjectTypes.has(definition.declaration), retained, "exact emitted type use");
      assert.equal(usage.reifiedProjectTypes.has(definition.declaration), retained, "recursive native reification");
      assert.equal(usage.constructedProjectTypes.has(definition.declaration), false, "no instance construction");
      assert.equal(usage.invokedProjectConstructors.has(definition.declaration), false, "no constructor invocation");
      assert.equal(usage.readAuthoredFields.has(definition.declaration), false, "no invented field read");
    }
  }
});

test("sealed structural reads share only selected physical storage and never query shapes again", () => {
  const shape = (identity, file = "/source.ts", readonly = false) => rustStructuralObjectTargetType(file,
    ["value", "other"].map(sourceName => ({
      sourceName, type: { kind: "type-parameter", identity, name: identity }, presence: "required", readonly,
    })));
  const first = shape("First");
  const second = shape("Second");
  const foreign = shape("First", "/foreign.ts");
  const readonly = shape("First", "/source.ts", true);
  const shapes = createRustStructuralShapePlan([first, second, foreign, readonly].map(carrier => ({ carrier })),
    [], file => file === "/foreign.ts" ? "dependency" : "app", []);
  let sealed = false;
  let calls = 0;
  const observedShapes = { ...shapes,
    definitionForCarrier(carrier) { assert.equal(sealed, false); calls += 1; return shapes.definitionForCarrier(carrier); },
    unionForCarrier(carrier) { assert.equal(sealed, false); calls += 1; return shapes.unionForCarrier(carrier); },
  };
  const state = createRustGeneratedItemUsageState({ declarations: [], structuralShapes: observedShapes,
    projectTypes: { definitions: [] } });
  state.markStructuralFieldRead(first, 0);
  state.markStructuralFieldWritten(second, 1);
  const record = state.seal();
  sealed = true;
  const queriesAtSeal = calls;
  assert.equal(record.structuralCarriers.get(first) === record.structuralCarriers.get(second), true,
    "the checked generic source carriers share the same emitted declaration");
  for (const carrier of [first, second]) {
    assert.equal(record.structuralCarriers.get(carrier).used, true);
    assert.equal(record.structuralCarriers.get(carrier).fieldsRead.has(0), true);
    assert.equal(record.structuralCarriers.get(carrier).fieldsRead.has(1), false);
    assert.equal(record.structuralCarriers.get(carrier).fieldsWritten.has(0), false);
    assert.equal(record.structuralCarriers.get(carrier).fieldsWritten.has(1), true);
    assert.equal(record.structuralCarriers.get(carrier).constructed, false);
  }
  for (const carrier of [foreign, readonly]) {
    assert.equal(record.structuralCarriers.get(carrier).used, false);
    assert.equal(record.structuralCarriers.get(carrier).fieldsRead.size, 0);
    assert.equal(record.structuralCarriers.get(carrier).fieldsWritten.size, 0);
  }
  assert.equal(calls, queriesAtSeal, "sealed readers do not reopen carrier or shape resolution");
});
