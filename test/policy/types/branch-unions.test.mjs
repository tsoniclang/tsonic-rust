import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustBranchUnion } from "../../../dist/analysis/source-evidence/types/resolution/branch-unions.js";
import { rustStringTargetType, rustSourceUnionTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

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
  for (const indexes of [[0], [1], undefined, [], [2], [-1], [0, 2], [0.5]]) {
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

test("branch unions preserve every physical arm for a coalesced current-checker source type", () => {
  const expression = {};
  const branch = {};
  const sourceType = {};
  const currentType = {};
  const string = rustStringTargetType();
  const boolean = rustSourcePrimitiveTargetType("bool");
  const carrier = rustSourceUnionTargetType("/foreign.ts", "Union2", [], "generated",
    { kind: "physical", types: [string, boolean] });
  const registry = createRustSourceTypeRegistry();
  assert.equal(registry.registerSourceUnion({ sourceType, carrier, selectedProperties: [], variants: [
    { name: "Variant0", carrier: string, sourceTypes: [currentType] },
    { name: "Variant1", carrier: boolean, sourceTypes: [currentType] },
  ] }), true, "the original physical contract has a complete many-index relation");
  const context = { ast: { is: { IsArrayLiteralExpression: () => false }, getFileName: () => "/current.ts" },
    source: { navigation: { isProjectDeclaration: () => true } }, currentSourceFile: {}, currentSemantics: { types: {
      expressionType: node => node === expression ? sourceType : currentType,
      isUnion: () => false, isNullish: () => false, isVoidLike: () => false, propertyInfos: () => [],
      isIdenticalTo: () => { throw new Error("foreign checker comparison"); },
    } } };
  const result = resolveRustBranchUnion(expression, [{ expression: branch, carrier }], context,
    { sourceTypes: registry, resolveProjectUnionCarrier: () => undefined });
  assert.equal(result !== undefined, true, "both physical arms survive branch selection");
  const selected = registry.sourceUnionForCarrier(result);
  assert.equal(selected?.variants.length, 2, "no arbitrary singleton payload is selected");
  for (const payload of [string, boolean]) assert.equal(selected.variants.some(variant =>
    rustTargetTypeRefEquals(variant.carrier, payload)), true, "exact native payload retained");
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(result, [currentType]), [0, 1]);
});
