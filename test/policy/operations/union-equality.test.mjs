import assert from "node:assert/strict";
import test from "node:test";
import { selectRustUnionEquality, selectRustUnionEqualityEmission } from "../../../dist/policy/operations/operators/union-equality.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustAbsenceTargetType, rustOptionTargetType, rustSourceUnionTargetType,
  rustSourcePrimitiveTargetType, rustSourceTypeCarrier, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";
import { rustUnionEqualityFactMatches } from "../../../dist/analysis/operations/union-equality-facts.js";

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
  const selected = selectRustUnionEquality("===", outer, outer, definitions);
  assert.equal(selected.arms.length, 3);
  assert.equal(selected.exhaustive, false);
  assert.deepEqual(selected.arms.map(arm => arm.left.path.map(step => step.variant.name)), [["Inner", "Integer"], ["Inner", "Text"], ["Boolean"]]);
  assert.ok(Object.isFrozen(selected) && Object.isFrozen(selected.arms));
  const opaque = { kind: "type-parameter", identity: "opaque", name: "Opaque" };
  assert.equal(selectRustUnionEquality("===", outer, opaque, definitions), undefined);
  assert.equal(selectRustUnionEquality("===", integer, text, definitions), undefined);
  assert.equal(selectRustUnionEquality("===", outer, integer, { programErrorOrigin: () => undefined, sourceUnionVariants: () => [{ name: "Recursive", carrier: outer }] }), undefined);
  assert.equal(selectRustUnionEquality(outer, outer, definitions) === undefined, true,
    "the removed operator-free selector signature is not admitted");
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
  const selected = selectRustUnionEquality("===", optional, optional, definitions);
  assert.equal(selected.arms.length, 3);
  assert.equal(selected.exhaustive, false);
  assert.deepEqual(selected.arms.map(arm => arm.left.path.map(step => step.variant.name)), [["Text"], ["Entry"], []]);
  assert.deepEqual(selected.arms[2].left.carrier, rustAbsenceTargetType());
  assert.deepEqual(selected.arms[2].right.carrier, rustAbsenceTargetType());
  assert.equal(selected.arms[2].operation.kind, "operator-token");
  for (const [left, right] of [[optional, entry], [entry, optional]]) {
    const selected = selectRustUnionEquality("===", left, right, definitions);
    assert.equal(selected.arms.length, 1);
    assert.equal(selected.arms[0].operation.kind, "operator-call");
    assert.equal(selected.arms[0].operation.path, "core::cmp::PartialEq::eq",
      "the closed object payload invokes its native equality implementation");
    assert.equal(selected.arms[0].operation.rustOperator, "==");
    assert.equal(selected.arms[0].operation.operandModes.every(mode => mode === "ref"), true,
      "the exact original object payloads stay borrowed");
    assert.equal(selected.arms[0].operation.leftConversion === undefined && selected.arms[0].operation.rightConversion === undefined,
      true, "native object equality adds no payload conversion");
    assert.equal(selected.exhaustive, false);
  }
  for (const present of [text, entry]) {
    const selected = selectRustUnionEquality("===", optional, rustSourceOptionalTargetType(present), definitions);
    assert.equal(selected.arms.length, 2);
    assert.equal(selected.arms[1].left.path.length, 0);
    assert.equal(selected.arms[1].right.path.length, 0);
  }
  assert.equal(selectRustUnionEquality("===", optional, rustAbsenceTargetType(), definitions).arms.length, 1);
  assert.equal(selectRustUnionEquality("===", rustOptionTargetType(union), entry, definitions), undefined);
  assert.equal(selectRustUnionEquality("===", optional, { kind: "type-parameter", identity: "opaque", name: "Opaque" }, definitions), undefined);
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
  const selected = selectRustUnionEquality("===", optional, integer, definitions);
  assert.equal(selected.arms.length, 1);
  assert.equal(selected.arms[0].operation.leftConversion, undefined);
  assert.equal(selected.arms[0].operation.rightConversion, undefined);
  assert.deepEqual(selected.arms[0].left.carrier, integer);
  const mixed = selectRustUnionEquality("===", optional, unsigned, definitions);
  assert.equal(mixed.arms.length, 1);
  assert.deepEqual(mixed.arms[0].operation.leftConversion, { kind: "numeric-promotion", source: "int64", target: "int128" });
  assert.deepEqual(mixed.arms[0].operation.rightConversion, { kind: "numeric-promotion", source: "uint64", target: "int128" });
  const wideUnion = rustSourceUnionTargetType("/values.ts", "Wide");
  const wideRegistry = createRustTypeDefinitionRegistry();
  assert.equal(wideRegistry.registerSourceUnion({ carrier: wideUnion, variants: [
    { name: "Integer", carrier: rustSourcePrimitiveTargetType("int128") }, { name: "Text", carrier: text },
  ] }, true), true);
  assert.equal(selectRustUnionEquality("===", rustSourceOptionalTargetType(wideUnion), rustSourcePrimitiveTargetType("uint128"), wideRegistry.seal()), undefined);
  assert.equal(selectRustUnionEquality("===", optional, integer, { programErrorOrigin: () => undefined, sourceUnionVariants: () => [{ name: "Recursive", carrier: union }] }), undefined);
  assert.equal(selectRustUnionEquality("===", optional, rustOptionTargetType(integer), definitions), undefined);
});

test("closed union inequality selects native ne independently and preserves absence and exact admission", () => {
  const entry = rustSourceTypeCarrier("/values.ts", "Entry", "object");
  const union = rustSourceUnionTargetType("/values.ts", "Value");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: union, variants: [
    { name: "Text", carrier: rustStringTargetType() }, { name: "Entry", carrier: entry },
  ] }, true), true);
  const definitions = registry.seal();
  const optional = rustSourceOptionalTargetType(union);
  for (const [operator, method, token, negated, kind] of [["===", "eq", "==", false, "KindEqualsEqualsEqualsToken"],
    ["!==", "ne", "!=", true, "KindExclamationEqualsEqualsToken"]]) {
    const selected = selectRustUnionEquality(operator, optional, optional, definitions);
    assert.equal(selected !== undefined, true, operator + ": the exact closed native comparison exists");
    assert.equal(selected.arms.length, 3, operator + ": both payloads and one native absence stay present");
    const object = selected.arms.find(arm => arm.left.path[0]?.variant.name === "Entry");
    assert.equal(object?.operation.kind, "operator-call", operator + ": native object operation is a call");
    assert.equal(object.operation.path, `core::cmp::PartialEq::${method}`, operator + ": independent native operation");
    assert.equal(object.operation.rustOperator, token, operator + ": authored polarity remains exact");
    assert.equal(object.operation.operandModes.length === 2 && object.operation.operandModes.every(mode => mode === "ref"),
      true, operator + ": both original native operands are borrowed");
    const absence = selected.arms.find(arm => arm.left.path.length === 0);
    assert.equal(absence?.operation.rustOperator, token, operator + ": absence uses the same native polarity");
    const fact = { kind: "union-equality", operationId: "tsonic.rust.union.equality", leftCarrier: optional,
      rightCarrier: optional, resultCarrier: rustSourcePrimitiveTargetType("bool"), negated, ...selected };
    const emission = selectRustUnionEqualityEmission(fact, definitions);
    assert.equal(emission !== undefined && Object.isFrozen(emission) && Object.isFrozen(emission.arms) && Object.isFrozen(emission.form),
      true, operator + ": the sole native form owner publishes immutable data");
    assert.equal(emission.fallback, negated, operator + ": disjoint native variants keep authored polarity");
    assert.equal(emission.arms.find(arm => arm.left.absence && arm.right.absence)?.constant, !negated,
      operator + ": absence is selected before rendering");
    assert.equal(rustUnionEqualityFactMatches(fact, kind, optional, optional, definitions), true,
      operator + ": the sole admission validates the exact native arm operations");
    const changed = selected.arms.map(arm => arm === object
      ? { ...arm, operation: { ...arm.operation, path: `core::cmp::PartialEq::${method === "eq" ? "ne" : "eq"}` } } : arm);
    assert.equal(rustUnionEqualityFactMatches({ ...fact, arms: changed }, kind, optional, optional, definitions), false,
      operator + ": an opposite native implementation is rejected before publication");
  }
});
