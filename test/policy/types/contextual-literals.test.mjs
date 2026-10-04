import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustContextualLiteralCarrier } from "../../../dist/policy/types/resolution/contextual-literals.js";
import { resolveRustBranchUnion } from "../../../dist/policy/types/resolution/branch-unions.js";
import { rustJsArrayTargetType, rustNeverTargetType, rustSourcePrimitiveTargetType, rustStringTargetType, rustVecTargetType,
  rustSourceOptionalTargetType } from "../../../dist/target-model/types/index.js";

test("only exact empty array syntax adopts the exact contextual sequence carrier", () => {
  const empty = {};
  const nonempty = {};
  const scalar = {};
  const context = { ast: {
    is: { IsArrayLiteralExpression: node => node === empty || node === nonempty },
    elements: node => node === empty ? [] : [scalar],
  } };
  for (const element of [rustStringTargetType(), rustSourcePrimitiveTargetType("uint64")]) {
    for (const carrier of [rustVecTargetType(element), rustJsArrayTargetType(element)]) {
      assert.equal(resolveRustContextualLiteralCarrier(context, empty, carrier) === carrier, true);
      assert.equal(resolveRustContextualLiteralCarrier(context, empty, rustSourceOptionalTargetType(carrier)) === carrier, true);
      assert.equal(resolveRustContextualLiteralCarrier(context, nonempty, carrier), undefined);
      assert.equal(resolveRustContextualLiteralCarrier(context, scalar, carrier), undefined);
    }
  }
  assert.equal(resolveRustContextualLiteralCarrier(context, empty, rustStringTargetType()), undefined);
  assert.equal(resolveRustContextualLiteralCarrier(context, empty, { kind: "tuple", elements: [rustStringTargetType()] }), undefined);
});

test("empty branch inference retains the sibling width but rejects conflicting contexts", () => {
  const expression = {};
  const empty = {};
  const present = {};
  const other = {};
  const type = {};
  const context = { ast: { is: { IsArrayLiteralExpression: node => node === empty }, elements: () => [] },
    currentSemantics: { types: { expressionType: () => type, isUnion: () => false,
      isNullish: () => false, isVoidLike: () => false } } };
  const options = { sourceTypes: { sourceUnionForCarrier: () => undefined, sourceUnionVariants: () => undefined } };
  const never = rustNeverTargetType();
  for (const construct of [rustVecTargetType, rustJsArrayTargetType]) {
    const carrier = construct(rustSourcePrimitiveTargetType("uint64"));
    const branches = [{ expression: empty, carrier: construct(never) }, { expression: present, carrier }];
    assert.equal(resolveRustBranchUnion(expression, branches, context, options) === carrier, true);
    assert.equal(resolveRustBranchUnion(expression, branches.toReversed(), context, options) === carrier, true);
    assert.equal(resolveRustBranchUnion(expression, [...branches,
      { expression: other, carrier: construct(rustStringTargetType()) }], context, options), undefined);
  }
});
