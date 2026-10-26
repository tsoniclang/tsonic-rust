import assert from "node:assert/strict";
import test from "node:test";
import { createRustStructuralShapePlanRegistry } from "../../../dist/analysis/objects/shapes/structural-shape-registry.js";
import { createRustGeneratedUnionPlan } from "../../../dist/analysis/objects/shapes/generated-union-plan.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceUnionTargetType, rustJsPromiseTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "int32" };
const output = name => ({ kind: "type-parameter", identity: name, name });
const pending = name => rustJsPromiseTargetType(output(name));
const union = (fileName, payloads) => ({
  carrier: rustSourceUnionTargetType(fileName, `Union${payloads.length}`, [], "generated", { kind: "physical", types: payloads }),
  variants: payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier })),
});

test("one generated union owner finalizes checked and physical definitions after object storage", () => {
  const shapes = createRustStructuralShapePlanRegistry();
  const definitions = createRustTypeDefinitionRegistry();
  const authoredSource = union("/src/checked.ts", [integer, rustStringTargetType()]);
  const physical = union("/src/completion.ts", [pending("LeftError"), pending("RightError")]);
  assert.throws(() => shapes.initializeUnions([]), /before source analysis/u);
  shapes.initialize([], [], () => "root", [], [], new Map());
  assert.equal(shapes.isInitialized(), true);
  assert.equal(shapes.definitions.length, 0);
  assert.throws(() => shapes.seal(), /after physical value selection/u);
  assert.throws(() => shapes.unionForCarrier(physical.carrier), /after physical value selection/u);
  assert.equal(definitions.registerSourceUnion(authoredSource, false), true);
  assert.equal(definitions.registerSourceUnion(physical, false), true);
  assert.equal(definitions.generatedUnions().length, 2);
  assert.equal(Object.isFrozen(definitions.generatedUnions()), true);
  assert.equal(definitions.generatedUnions().every(record => Object.isFrozen(record)), true);
  shapes.initializeUnions(definitions.generatedUnions());
  shapes.finalizeMethodStorage(new Map(), () => assert.fail("a union-only fixture has no callable property destination"));
  const finalized = shapes.seal();
  assert.equal(finalized.unionDefinitions.length, 1);
  assert.equal(finalized.unionForCarrier(authoredSource.carrier) === finalized.unionForCarrier(physical.carrier), true);
  assert.equal(finalized.unionForCarrier(physical.carrier).sourceCarriers.length, 2);
  assert.equal(definitions.seal().sourceUnionVariants(physical.carrier).length, 2);
  assert.throws(() => shapes.initializeUnions([]), /only once/u);
  assert.throws(() => shapes.initialize([], [], () => "other", [], [], new Map()), /only once/u);
});

test("physical union boundary rejects source stand-ins and hostile accessors without executing them", () => {
  const physical = union("/src/completion.ts", [pending("LeftError"), pending("RightError")]);
  assert.throws(() => createRustGeneratedUnionPlan([{ ...physical, sourceType: {} }], () => "root", new Map()), /exact inferred union/u);
  let executions = 0;
  const hostile = { variants: physical.variants, get carrier() { executions += 1; return physical.carrier; } };
  assert.throws(() => createRustGeneratedUnionPlan([hostile], () => "root", new Map()), /exact immutable union/u);
  assert.equal(executions, 0);
  assert.throws(() => createRustGeneratedUnionPlan([{ ...physical, variants: physical.variants.toReversed() }], () => "root", new Map()), /exact inferred union/u);
});
