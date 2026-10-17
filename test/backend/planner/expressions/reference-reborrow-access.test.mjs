import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustOwnershipFixture } from "../../../helpers/ownership.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { applyFinalizedRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { planRustIndexedInput } from "../../../../dist/backend/planner/expressions/borrowed-element-reads.js";

import { rustValueReferenceReborrow } from "../../../../dist/analysis/conversions/value-carrier-queries.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";

const node = {};
const integer = { kind: "source-primitive", name: "int32" };
const source = { kind: "reference", referent: integer, mutable: false, lifetime: { kind: "static" } };
const expression = { kind: "reference", expr: { kind: "path", path: "proof::STATIC" } };

test("a finalized constant index evaluates its original source key once before the native index", () => {
  const carrier = { kind: "source-primitive", name: "float64" };
  const effect = { kind: "call", path: "checked_key", args: [] };
  const selected = { diagnostics: [], expressionOverrides: new Map([[node, { expression: effect, carrier, valueForm: "value" }]]),
    input: { program: { records: createRustRecordFixture({ runtimeCarrier: { get: () => ({ carrier }) } }),
      ownership: createRustOwnershipFixture(node, carrier, "copy"), typeDefinitions: emptyRustTypeDefinitions,
      source: { ast: { kindName: () => "KindIdentifier" } } } } };
  const nativeIndex = { source: { kind: "constant", value: { kind: "float64", value: 0 } } };
  const actual = planRustIndexedInput(nativeIndex, {}, node, {}, selected);
  assert.equal(actual.kind, "evaluate-then", "the target constant does not erase the original key's execution");
  assert.equal(actual.effect === effect, true, "the original checked key expression occurs exactly once");
  assert.equal(actual.discard, "value", "the unused original key value follows the canonical native discard owner");
  assert.equal(actual.value.kind, "float-literal", "the already-selected native numeric index is rendered directly");
  assert.equal(actual.value.text, "0.0", "the finalized native constant is not re-derived from source spelling");
  const runtime = { source: { kind: "argument", sourceIndex: 0 }, sourceCarrier: carrier,
    conversion: { kind: "identity", sourceCarrier: carrier, targetCarrier: carrier, fallible: false },
    mode: "value", parameterCarrier: carrier };
  assert.equal(planRustIndexedInput(runtime, {}, node, {}, selected) === effect, true,
    "an ordinary runtime index is evaluated once through its unchanged finalized conversion");
  assert.equal(selected.diagnostics.length, 0, "index rendering does not introduce a diagnostic or second selector");
});

function context(selectedSource = source, selectedTarget = integer) {
  const conversion = { kind: "reference-reborrow", source: selectedSource, target: selectedTarget };
  const fact = { sourceCarrier: selectedSource, targetCarrier: selectedTarget, conversion };
  const records = createRustRecordFixture({contextualValueConversion: { get: (_subject) => fact },
runtimeCarrier: { get: () => ({ carrier: selectedSource }) },
conversion: { get: () => undefined }});
  return { diagnostics: [], expressionOverrides: new Map([[node, { expression, carrier: selectedSource }]]),
    input: { program: { records, ownership: createRustOwnershipFixture(node, selectedSource, "borrow"),
      typeDefinitions: emptyRustTypeDefinitions, source: { ast: { kindName: () => "KindIdentifier" } } } } };
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
  const fact = selected.input.program.records.contextualValueConversion.get(node);
  for (const replacement of [
    undefined,
    { ...fact, sourceCarrier: integer },
    { ...fact, targetCarrier: source },
    { ...fact, conversion: { ...fact.conversion, source: { ...source, referent: source } } },
  ]) {
    const records = { ...selected.input.program.records, contextualValueConversion: { get: () => replacement } };
    assert.equal(rustValueReferenceReborrow(records, node, emptyRustTypeDefinitions) === undefined, true);
  }
  const immutable = context();
  const input = { source: { kind: "argument", sourceIndex: 0 }, sourceCarrier: integer,
    conversion: { kind: "identity" }, mode: "mut-ref", parameterCarrier: { ...source, mutable: true } };
  assert.deepEqual(applyFinalizedRustArgumentMode(immutable, node, expression, input, false), {
    kind: "reference", expr: expression, mutable: true,
  });
});
