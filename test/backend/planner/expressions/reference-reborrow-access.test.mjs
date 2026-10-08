import assert from "node:assert/strict";
import test from "node:test";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { applyFinalizedRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { rustContextualValueConversionFactKey } from "../../../../dist/analysis/facts/keys.js";
import { rustValueReferenceReborrow } from "../../../../dist/analysis/facts/value-carrier-queries.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

const node = {};
const integer = { kind: "source-primitive", name: "int32" };
const source = { kind: "reference", referent: integer, mutable: false, lifetime: { kind: "static" } };
const expression = { kind: "reference", expr: { kind: "path", path: "proof::STATIC" } };

function context(selectedSource = source, selectedTarget = integer) {
  const conversion = { kind: "reference-reborrow", source: selectedSource, target: selectedTarget };
  const fact = { sourceCarrier: selectedSource, targetCarrier: selectedTarget, conversion };
  const facts = { getFact: (_subject, key) => key === rustContextualValueConversionFactKey ? fact : undefined,
    getRuntimeCarrierFact: () => ({ carrier: selectedSource }), getTargetConversionFact: () => undefined };
  return { diagnostics: [], expressionOverrides: new Map([[node, { expression, carrier: selectedSource }]]),
    input: { program: { facts, typeDefinitions: emptyRustTypeDefinitions, source: { ast: { kindName: () => "KindIdentifier" } } } } };
}

test("shared expression access retains an exact native reference reborrow once", () => {
  for (const selectedSource of [source, { ...source, mutable: true }]) {
    const selected = context(selectedSource);
    const input = { source: { kind: "argument", sourceIndex: 0 }, sourceCarrier: integer,
      conversion: { kind: "identity", sourceCarrier: integer, targetCarrier: integer, fallible: false },
      parameterCarrier: { kind: "reference", referent: integer, mutable: false }, mode: "ref" };
    assert.equal(planExpression(node, selected, "value", "shared-reference") === expression, true);
    assert.equal(applyFinalizedRustArgumentMode(selected, node, expression, input, false) === expression, true);
    assert.deepEqual(selected.diagnostics, []);
  }
  const nested = { kind: "reference", referent: source, mutable: false };
  const nestedContext = context(nested, source);
  const nestedExpression = { kind: "reference", expr: expression };
  nestedContext.expressionOverrides.set(node, { expression: nestedExpression, carrier: nested });
  assert.equal(planExpression(node, nestedContext, "value", "shared-reference") === nestedExpression, true);
});

test("reference reborrow evidence rejects unrelated or contradictory carriers", () => {
  const selected = context();
  const fact = selected.input.program.facts.getFact(node, rustContextualValueConversionFactKey);
  for (const replacement of [
    undefined,
    { ...fact, sourceCarrier: integer },
    { ...fact, targetCarrier: source },
    { ...fact, conversion: { ...fact.conversion, source: { ...source, referent: source } } },
  ]) {
    const facts = { ...selected.input.program.facts, getFact: () => replacement };
    assert.equal(rustValueReferenceReborrow(facts, node, emptyRustTypeDefinitions) === undefined, true);
  }
  const immutable = context();
  const input = { source: { kind: "argument", sourceIndex: 0 }, sourceCarrier: integer,
    conversion: { kind: "identity" }, mode: "mut-ref", parameterCarrier: { ...source, mutable: true } };
  assert.deepEqual(applyFinalizedRustArgumentMode(immutable, node, expression, input, false), {
    kind: "reference", expr: expression, mutable: true,
  });
});
