import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { numberArrayUnionFiles } from "../../fixtures/number-array-unions.mjs";
import { isRustNumberArrayPayload, isRustNumberArrayUnion } from "../../../dist/target-model/types/carriers/array-unions.js";
import { rustJsArrayTargetType, rustJsTypedArrayTargetType, rustSourcePrimitiveTargetType, rustStringTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { createRustGeneratedUnionPlan } from "../../../dist/analysis/objects/generated-union-plan.js";

test("numeric array unions require exact numeric arms and sealed capability selection", () => {
  const payloads = [rustJsArrayTargetType(rustSourcePrimitiveTargetType("float64")), rustJsTypedArrayTargetType("Uint8Array")];
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Union2", payloads.map(type => ({ kind: "type", type })), "generated");
  const definitions = createRustTypeDefinitionRegistry();
  assert.equal(isRustNumberArrayUnion(carrier, definitions), false);
  const variants = payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier }));
  assert.equal(definitions.registerSourceUnion({ carrier, variants }, false), true);
  assert.equal(isRustNumberArrayUnion(carrier, definitions.seal()), true);
  assert.equal(isRustNumberArrayPayload(rustJsArrayTargetType(rustStringTargetType())), false);
  assert.equal(isRustNumberArrayPayload(rustJsArrayTargetType(rustSourcePrimitiveTargetType("int32"))), false);
  const union = { carrier, sourceType: {}, selectedProperties: [], variants: variants.map(variant => ({ ...variant, sourceType: {} })) };
  const plan = createRustGeneratedUnionPlan([union], () => "root", new Map());
  assert.equal(plan.unionDefinitions[0].numberArrayLike, true);
  assert.throws(() => createRustGeneratedUnionPlan([{ ...union, variants: union.variants.toReversed() }], () => "root", new Map()), /exact inferred union/u);
});

test("typed and ordinary numeric arrays cross files without copying their input storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()], files: numberArrayUnionFiles,
    target: { id: "rust", options: { outputType: "bin", crateName: "number_array_unions" } } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/shapes.rs"), /NumberArrayLike for Union2/u);
  assert.match(artifactText(result, "src/arrays.rs"), /number_array_from/u);
  const run = validateGeneratedProject("number-array-unions", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});
