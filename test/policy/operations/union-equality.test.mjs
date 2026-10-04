import assert from "node:assert/strict";
import test from "node:test";
import { selectRustUnionEquality } from "../../../dist/policy/operations/operators/union-equality.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustAbsenceTargetType, rustOptionTargetType, rustSourceUnionTargetType,
  rustSourcePrimitiveTargetType, rustSourceTypeCarrier, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustUnionEqualityFactMatches } from "../../../dist/analysis/facts/operations/union-equality.js";

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
  assert.equal(selectRustUnionEquality(outer, integer, { programErrorOrigin: () => undefined, sourceUnionVariants: () => [{ name: "Recursive", carrier: outer }] }), undefined);
});

test("source-optional union equality keeps one native absence and exact closed payload operations", () => {
  const text = rustStringTargetType();
  const entry = rustSourceTypeCarrier("/values.ts", "Entry", "object");
  const union = rustSourceUnionTargetType("/values.ts", "Value");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: union, variants: [
    { name: "Text", carrier: text }, { name: "Entry", carrier: entry },
  ] }, true), true);
  const definitions = registry.seal();
  const optional = rustSourceOptionalTargetType(union);
  const selected = selectRustUnionEquality(optional, optional, definitions);
  assert.equal(selected.arms.length, 3);
  assert.equal(selected.exhaustive, false);
  assert.deepEqual(selected.arms.map(arm => arm.left.path.map(step => step.variant.name)), [["Text"], ["Entry"], []]);
  assert.deepEqual(selected.arms[2].left.carrier, rustAbsenceTargetType());
  assert.deepEqual(selected.arms[2].right.carrier, rustAbsenceTargetType());
  assert.equal(selected.arms[2].operation.kind, "operator-token");
  for (const [left, right] of [[optional, entry], [entry, optional]]) {
    const selected = selectRustUnionEquality(left, right, definitions);
    assert.equal(selected.arms.length, 1);
    assert.equal(selected.arms[0].operation.kind, "operator-token");
    assert.equal(selected.exhaustive, false);
  }
  for (const present of [text, entry]) {
    const selected = selectRustUnionEquality(optional, rustSourceOptionalTargetType(present), definitions);
    assert.equal(selected.arms.length, 2);
    assert.equal(selected.arms[1].left.path.length, 0);
    assert.equal(selected.arms[1].right.path.length, 0);
  }
  assert.equal(selectRustUnionEquality(optional, rustAbsenceTargetType(), definitions).arms.length, 1);
  assert.equal(selectRustUnionEquality(rustOptionTargetType(union), entry, definitions), undefined);
  assert.equal(selectRustUnionEquality(optional, { kind: "type-parameter", identity: "opaque", name: "Opaque" }, definitions), undefined);
  const fact = { kind: "union-equality", operationId: "tsonic.rust.union.equality", leftCarrier: optional,
    rightCarrier: optional, resultCarrier: rustSourcePrimitiveTargetType("bool"), negated: false, ...selected };
  assert.equal(rustUnionEqualityFactMatches(fact, "KindEqualsEqualsEqualsToken", optional, optional, definitions), true);
  for (const mutation of [{ leftCarrier: union }, { rightCarrier: union }, { arms: selected.arms.slice(0, -1) },
    { arms: [...selected.arms, selected.arms[2]] }, { exhaustive: true }, { negated: true }]) {
    assert.equal(rustUnionEqualityFactMatches({ ...fact, ...mutation }, "KindEqualsEqualsEqualsToken", optional, optional, definitions), false);
  }
});

test("source-optional union equality retains exact numeric range and rejects cyclic or unsupported leaves", () => {
  const integer = rustSourcePrimitiveTargetType("int64");
  const unsigned = rustSourcePrimitiveTargetType("uint64");
  const text = rustStringTargetType();
  const union = rustSourceUnionTargetType("/values.ts", "Value");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: union, variants: [
    { name: "Integer", carrier: integer }, { name: "Text", carrier: text },
  ] }, true), true);
  const definitions = registry.seal();
  const optional = rustSourceOptionalTargetType(union);
  const selected = selectRustUnionEquality(optional, integer, definitions);
  assert.equal(selected.arms.length, 1);
  assert.equal(selected.arms[0].operation.leftConversion, undefined);
  assert.equal(selected.arms[0].operation.rightConversion, undefined);
  assert.deepEqual(selected.arms[0].left.carrier, integer);
  const mixed = selectRustUnionEquality(optional, unsigned, definitions);
  assert.equal(mixed.arms.length, 1);
  assert.deepEqual(mixed.arms[0].operation.leftConversion, { kind: "numeric-promotion", source: "int64", target: "int128" });
  assert.deepEqual(mixed.arms[0].operation.rightConversion, { kind: "numeric-promotion", source: "uint64", target: "int128" });
  const wideUnion = rustSourceUnionTargetType("/values.ts", "Wide");
  const wideRegistry = createRustTypeDefinitionRegistry();
  assert.equal(wideRegistry.registerSourceUnion({ carrier: wideUnion, variants: [
    { name: "Integer", carrier: rustSourcePrimitiveTargetType("int128") }, { name: "Text", carrier: text },
  ] }, true), true);
  assert.equal(selectRustUnionEquality(rustSourceOptionalTargetType(wideUnion), rustSourcePrimitiveTargetType("uint128"), wideRegistry.seal()), undefined);
  assert.equal(selectRustUnionEquality(optional, integer, { programErrorOrigin: () => undefined, sourceUnionVariants: () => [{ name: "Recursive", carrier: union }] }), undefined);
  assert.equal(selectRustUnionEquality(optional, rustOptionTargetType(integer), definitions), undefined);
});
