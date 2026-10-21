import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourcePrimitiveTargetType, rustSourceUnionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";
import { rustUnionProjectionContract } from "../../../dist/policy/conversions/union-relations.js";

const integer = rustSourcePrimitiveTargetType("int32");
const boolean = rustSourcePrimitiveTargetType("bool");

for (const ambiguous of [false, true]) {
  test(`a late nested union cannot ${ambiguous ? "invalidate" : "prematurely complete"} an admitted leaf proof`, () => {
    const registry = createRustTypeDefinitionRegistry();
    const outer = rustSourceUnionTargetType("/probe/index.ts", "Outer");
    const nested = rustSourceUnionTargetType("/probe/index.ts", "Nested");
    assert.equal(registry.registerSourceUnion({ carrier: outer, variants: [
      { name: "Direct", carrier: integer }, { name: "Nested", carrier: nested },
    ] }, true), true);
    assert.equal(rustUnionLeaves(outer, registry) === undefined, true, "unresolved known unions are not scalar leaves");
    assert.equal(rustUnionProjectionContract(outer, integer, registry) === undefined, true,
      "the sibling's unresolved definition cannot prove unique native correspondence");
    const whole = rustUnionProjectionContract(outer, nested, registry);
    assert.equal(whole?.variant.name, "Nested", "an exact whole named payload does not inspect its internals");
    assert.equal(registry.registerSourceUnion({ carrier: nested, variants: [
      { name: "Value", carrier: ambiguous ? integer : boolean }, { name: "Text", carrier: rustStringTargetType() },
    ] }, true), true);
    const definitions = registry.seal();
    assert.equal(rustUnionLeaves(outer, definitions)?.length, 3);
    assert.equal(rustUnionProjectionContract(outer, integer, definitions) === undefined, ambiguous);
    assert.deepEqual(rustUnionProjectionContract(outer, nested, definitions), whole,
      "the independently complete whole-payload contract remains identical");
    assert.equal(rustUnionProjectionContract(outer, integer, definitions)?.variant.name, ambiguous ? undefined : "Direct");
  });
}

test("ordinary scalar/native leaves retain their complete union contracts", () => {
  const registry = createRustTypeDefinitionRegistry();
  const outer = rustSourceUnionTargetType("/probe/index.ts", "Outer");
  assert.equal(registry.registerSourceUnion({ carrier: outer, variants: [
    { name: "Direct", carrier: integer }, { name: "Text", carrier: rustStringTargetType() },
  ] }, true), true);
  const definitions = registry.seal();
  const leaves = rustUnionLeaves(outer, definitions);
  assert.equal(leaves?.length, 2);
  assert.equal(Object.isFrozen(leaves), true);
  assert.equal(rustUnionProjectionContract(outer, integer, definitions)?.variant.name, "Direct");
  assert.equal(rustUnionProjectionContract(outer, rustSourceUnionTargetType("/probe/index.ts", "Foreign"), definitions) === undefined, true);
});
