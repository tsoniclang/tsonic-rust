import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { applyFinalizedRustArgumentMode } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { analyzeRust, acmeVectorsPackage } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";

import { rustValueReferenceReborrow } from "../../../../dist/analysis/conversions/value-carrier-queries.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { selectReferenceReborrow } from "../../../../dist/policy/conversions/reference-reborrows.js";

const node = {};
const integer = { kind: "source-primitive", name: "int32" };
const source = { kind: "reference", referent: integer, mutable: false, lifetime: { kind: "static" } };
const expression = { kind: "reference", expr: { kind: "path", path: "proof::STATIC" } };

function reborrowRecords(selectedSource = source, selectedTarget = integer) {
  const conversion = selectReferenceReborrow(selectedSource, selectedTarget, "ref");
  assert.equal(conversion !== undefined, true, "the native policy admits this exact reference and referent");
  const fact = { sourceCarrier: selectedSource, targetCarrier: selectedTarget, conversion };
  return createRustRecordFixture({ contextualValueConversion: { get: () => fact } });
}

test("shared expression access retains an exact native reference reborrow once", () => {
  for (const reference of ["Ref", "Mut"]) {
    const { program } = analyzeRust({ packages: [acmeVectorsPackage()], files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      import type { ${reference} } from "@tsonic/rust/types.js";
      import { Vector, magnitude } from "@acme/vectors";
      export function read(value: ${reference}<Vector>): int32 { return magnitude(value); }
    ` } });
    const inputs = program.physicalEmissionContexts.sourceOccurrences.flatMap(occurrence => occurrence.inputs);
    assert.equal(inputs.length, 1, reference + ": one genuine native provider input is selected");
    const { input, slot } = inputs[0];
    const selectedSource = program.records.runtimeCarrier.get(slot.node)?.carrier;
    const conversion = program.records.valueRead.get(slot.node)?.referenceReborrow;
    assert.equal(selectedSource?.kind, "reference", reference + ": the real source has a native reference carrier");
    assert.equal(selectedSource.mutable, reference === "Mut", reference + ": the original shared/exclusive source distinction is retained");
    assert.equal(conversion?.kind, "reference-reborrow", reference + ": the actual pre-seal owner admits the conversion");
    assert.equal(rustTargetTypeRefEquals(conversion.source, selectedSource), true, reference + ": the sealed conversion retains the exact native source");
    assert.equal(program.records.providerReference.get(slot.node, input), true, reference + ": the complete source-to-input correspondence is admitted");
    const selected = rustSourceFilePlanContext(program, slot.node, {
      expressionOverrides: new Map([[slot.node, { expression, carrier: selectedSource }]]),
    });
    assert.equal(planExpression(slot.node, selected, "value", "shared-reference") === expression, true,
      reference + ": rendering reuses the exact reference without another evaluation or borrow");
    assert.equal(applyFinalizedRustArgumentMode(selected, slot.node, expression, input, false) === expression, true,
      reference + ": the actual finalized input preserves native reference identity");
    assert.equal(selected.diagnostics.length, 0, reference + ": no source rejection is deferred to the renderer");
  }
  const nested = { kind: "reference", referent: source, mutable: false };
  const records = reborrowRecords(nested, source);
  const conversion = records.contextualValueConversion.get(node).conversion;
  assert.equal(conversion.source === nested && conversion.target === source, true,
    "a nested native reference retains the exact outer reference and inner referent");
  assert.equal(rustValueReferenceReborrow(records, node, emptyRustTypeDefinitions) === conversion, true,
    "the canonical nested-reference reader returns the admitted conversion unchanged");
});

test("reference reborrow evidence rejects unrelated or contradictory carriers", () => {
  const selected = reborrowRecords();
  const fact = selected.contextualValueConversion.get(node);
  for (const replacement of [
    undefined,
    { ...fact, sourceCarrier: integer },
    { ...fact, targetCarrier: source },
    { ...fact, conversion: { ...fact.conversion, source: { ...source, referent: source } } },
  ]) {
    const records = { ...selected, contextualValueConversion: { get: () => replacement } };
    assert.equal(rustValueReferenceReborrow(records, node, emptyRustTypeDefinitions) === undefined, true);
  }
  assert.equal(selectReferenceReborrow(source, integer, "mut-ref") === undefined, true,
    "a shared native reference cannot be admitted as a mutable pointee reference");
  assert.equal(selectReferenceReborrow({ ...source, mutable: true }, integer, "mut-ref") !== undefined, true,
    "the same exact mutable native reference is admitted by the sole policy owner");
});
