import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustBranchUnion } from "../../../dist/policy/types/resolution/branch-unions.js";
import { rustStringTargetType, rustSourceUnionTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("branch unions consume exact checker-owned variant indexes without comparing foreign types", () => {
  const expression = {};
  const branch = {};
  const foreignType = {};
  const type = {};
  const carrier = rustSourceUnionTargetType("/foreign.ts", "Value");
  const string = rustStringTargetType();
  const context = { ast: { is: { IsArrayLiteralExpression: () => false } }, currentSemantics: { types: {
    expressionType: node => node === expression ? type : foreignType,
    isUnion: () => false, isNullish: () => false, isVoidLike: () => false,
    isIdenticalTo: () => { throw new Error("foreign checker comparison"); },
  } } };
  const union = { variants: [
    { name: "Text", sourceTypes: [{}], carrier: string },
    { name: "Boolean", sourceTypes: [{}], carrier: rustSourcePrimitiveTargetType("bool") },
  ] };
  for (const indexes of [[0], [1], undefined, [], [0, 1], [2], [-1]]) {
    let queries = 0;
    const options = { sourceTypes: {
      sourceUnionForCarrier: selected => selected === carrier ? union : undefined,
      sourceUnionVariantIndexesForTypes: (selected, members) => {
        queries++;
        assert.equal(selected === carrier, true, "exact native union identity");
        assert.equal(members.length === 1 && members[0] === foreignType, true, "exact current-checker type identity");
        return indexes;
      },
    } };
    const result = resolveRustBranchUnion(expression, [{ expression: branch, carrier }], context, options);
    assert.equal(queries, 1);
    assert.equal(result === (indexes?.length === 1 ? union.variants[indexes[0]]?.carrier : undefined), true);
  }
});
