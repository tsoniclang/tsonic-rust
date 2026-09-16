import assert from "node:assert/strict";
import test from "node:test";
import { contextualConditionalArgumentMatches } from "../../../dist/analysis/operations/provider/calls/contextual-conditionals.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const target = { kind: "target-named", id: "proof.Base" };
const first = { kind: "target-named", id: "proof.First" };
const second = { kind: "target-named", id: "proof.Second" };
const leaf = carrier => ({ kind: "value", carrier });
const conditional = (whenTrue, whenFalse) => ({ kind: "conditional", WhenTrue: whenTrue, WhenFalse: whenFalse });

function selection(expression, relationship = () => ({ kind: "related", targetType: target })) {
  let carrierReads = 0;
  const context = {
    ast: {
      is: {
        IsParenthesizedExpression: node => node.kind === "parenthesized",
        IsSatisfiesExpression: node => node.kind === "satisfies",
        IsConditionalExpression: node => node.kind === "conditional",
      },
      as: {
        AsConditionalExpression: node => node,
        AsParenthesizedExpression: node => node,
        AsSatisfiesExpression: node => node,
      },
    },
    facts: {
      getFact: () => undefined,
      getTargetConversionFact: () => undefined,
      getRuntimeCarrierFact: node => { carrierReads++; return { carrier: node.carrier }; },
    },
    typeDefinitions: emptyRustTypeDefinitions,
  };
  const options = { projectTypes: { definitionForCarrier: () => ({ kind: "class" }), relationship } };
  return { matches: contextualConditionalArgumentMatches(expression, target, context, options), carrierReads };
}

test("conditional argument admission proves every branch against one selected destination", () => {
  const nested = conditional(leaf(first), conditional(leaf(target), leaf(second)));
  assert.deepEqual(selection(nested), { matches: true, carrierReads: 3 });
  assert.deepEqual(selection({ kind: "parenthesized", Expression: { kind: "satisfies", Expression: nested } }),
    { matches: true, carrierReads: 3 });
});

test("conditional argument admission rejects one unrelated or ambiguous heritage branch", () => {
  for (const kind of ["unrelated", "ambiguous"]) {
    const result = selection(conditional(leaf(first), leaf(second)), carrier =>
      carrier === second ? { kind } : { kind: "related", targetType: target });
    assert.equal(result.matches, false);
  }
  assert.equal(selection(conditional(leaf(first), leaf(second)), () =>
    ({ kind: "related", targetType: first })).matches, false);
});

test("ordinary arguments do not acquire a contextual branch contract or repeated type work", () => {
  assert.deepEqual(selection(leaf(first)), { matches: false, carrierReads: 0 });
});

test("incomplete conditional syntax never admits an argument", () => {
  assert.deepEqual(selection(conditional(leaf(first), undefined)), { matches: false, carrierReads: 0 });
  assert.deepEqual(selection({ kind: "parenthesized" }), { matches: false, carrierReads: 0 });
});
