import assert from "node:assert/strict";
import test from "node:test";
import { selectRustUnionEquality } from "../../../dist/policy/operations/operators/union-equality.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

test("union equality covers nested leaf pairs without inventing operations for opaque or recursive types", () => {
  const integer = rustSourcePrimitiveTargetType("int64");
  const text = rustStringTargetType();
  const boolean = rustSourcePrimitiveTargetType("bool");
  const inner = rustSourceUnionTargetType("/values.ts", "Inner");
  const outer = rustSourceUnionTargetType("/outer.ts", "Outer");
  const definitions = createRustTypeDefinitionRegistry();
  assert.equal(definitions.registerSourceUnion({ carrier: inner, variants: [
    { name: "Integer", carrier: integer }, { name: "Text", carrier: text },
  ] }, true), true);
  assert.equal(definitions.registerSourceUnion({ carrier: outer, variants: [
    { name: "Inner", carrier: inner }, { name: "Boolean", carrier: boolean },
  ] }, true), true);
  const selected = selectRustUnionEquality(outer, outer, definitions);
  assert.equal(selected.arms.length, 3);
  assert.equal(selected.exhaustive, false);
  assert.deepEqual(selected.arms.map(arm => arm.left.path.map(step => step.variant.name)), [["Inner", "Integer"], ["Inner", "Text"], ["Boolean"]]);
  assert.ok(Object.isFrozen(selected) && Object.isFrozen(selected.arms));
  const opaque = { kind: "type-parameter", identity: "opaque", name: "Opaque" };
  assert.equal(selectRustUnionEquality(outer, opaque, definitions), undefined);
  assert.equal(selectRustUnionEquality(integer, text, definitions), undefined);
  assert.equal(selectRustUnionEquality(outer, integer, { sourceUnionVariants: () => [{ name: "Recursive", carrier: outer }] }), undefined);
});
