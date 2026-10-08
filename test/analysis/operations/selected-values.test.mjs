import assert from "node:assert/strict";
import test from "node:test";
import { selectedValueCarrier } from "../../../dist/analysis/operations/selected-values.js";
import { rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/keys.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustEmptyObjectTargetType, rustOptionTargetType, rustSourceOptionalTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { fakeAstReader } from "../../helpers/fake-compile-input.mjs";

function selected(carrier, sourceType, use) {
  const file = { kindName: "KindSourceFile" };
  const expression = { kindName: "KindElementAccessExpression", sourceFile: file };
  const selectedType = { kindName: "KindTypeReference", sourceFile: file };
  const other = { kindName: "KindIdentifier" };
  const parent = use === undefined ? undefined : { kindName: "KindBinaryExpression" };
  const operator = { kindName: use === "coalesce" ? "KindQuestionQuestionToken" : "KindEqualsEqualsEqualsToken" };
  const writes = [];
  const types = {
    expressionType: node => node === other ? { nullish: true } : sourceType,
    isUnion: type => Array.isArray(type.members),
    unionOrIntersectionTypes: type => type.members,
    isAny: type => type.any === true,
    isUnknown: type => type.unknown === true,
    isNullish: type => type.nullish === true,
    isVoidLike: type => type.void === true,
    couldContainTypeVariables: type => type.generic === true,
  };
  const semantics = { sourceFile: file, types };
  const baseAst = fakeAstReader([file]);
  const context = {
    ast: { ...baseAst, kind: node => node?.kindName === undefined ? undefined : 1,
      parent: node => node === expression ? parent : undefined,
      is: { ...baseAst.is, IsBinaryExpression: node => parent !== undefined && node === parent },
      as: { AsBinaryExpression: node => node === parent
        ? { Left: expression, Right: other, OperatorToken: operator } : undefined } },
    source: { sourceFacts: { getFact: () => undefined }, semantics: { includes: () => true },
      navigation: { referenceFor: () => undefined } },
    sourceStorage: { storageSubjectFor: () => ({ kind: "unresolved" }) },
    currentSourceFile: file,
    currentSemantics: semantics,
    semanticsFor: () => semantics,
    semantics: () => semantics,
    typeDefinitions: emptyRustTypeDefinitions,
    facts: { getFact: () => undefined, get: () => undefined, resolve: () => undefined,
      getTargetConversionFact: () => undefined,
      getRuntimeCarrierFact: () => ({ carrier }),
      set: (subject, key, fact) => writes.push({ subject, key, fact }) },
  };
  return { carrier: selectedValueCarrier(expression, selectedType, context, { projectTypes: {} }), writes, expression };
}

test("required present source reads select the exact physical payload and one checked projection", () => {
  for (const payload of [rustSourcePrimitiveTargetType("int64"), rustStringTargetType(), rustEmptyObjectTargetType()]) {
    for (const sourceType of [{}, { members: [{}, {}] }]) {
      const storage = rustSourceOptionalTargetType(payload);
      const result = selected(storage, sourceType);
      assert.equal(result.carrier === payload, true, "retain exact physical native payload");
      assert.equal(result.writes.length, 1, "one checked projection, not a conversion layer");
      assert.equal(result.writes[0].subject === result.expression, true, "exact operand owner");
      assert.equal(result.writes[0].key === rustFlowReadProjectionFactKey, true, "existing sealed fact owner");
      assert.equal(result.writes[0].fact.kind, "option-value");
      assert.equal(result.writes[0].fact.sourceCarrier === storage, true);
      assert.equal(result.writes[0].fact.selectedCarrier === payload, true);
    }
  }
});

test("source absence, open or missing types and explicit native Option never acquire a required present read", () => {
  const payload = rustStringTargetType();
  for (const sourceType of [undefined, { any: true }, { unknown: true }, { nullish: true },
    { void: true }, { generic: true }, { members: [] },
    ...["any", "unknown", "nullish", "void", "generic"].map(key => ({ members: [{}, { [key]: true }] }))]) {
    const storage = rustSourceOptionalTargetType(payload);
    const result = selected(storage, sourceType);
    assert.equal(result.carrier === storage, true, "no evidence can invent a required value");
    assert.equal(result.writes.length, 0, "no speculative extraction");
  }
  for (const use of ["coalesce", "comparison"]) {
    const storage = rustSourceOptionalTargetType(payload);
    const result = selected(storage, {}, use);
    assert.equal(result.carrier === storage, true, `${use}: preserve actual absence`);
    assert.equal(result.writes.length, 0, `${use}: no eager extraction`);
  }
  const storage = rustOptionTargetType(payload);
  const result = selected(storage, {});
  assert.equal(result.carrier === storage, true, "native Option remains authored native storage");
  assert.equal(result.writes.length, 0);
});
