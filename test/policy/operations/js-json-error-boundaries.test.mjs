import assert from "node:assert/strict";
import test from "node:test";
import { defineJsOperationRows } from "../../../dist/policy/operations/source-profiles/js/model.js";
import { jsOperationRows } from "../../../dist/policy/operations/source-profiles/js/rows.js";
import { resolveCarrierRef } from "../../../dist/policy/operations/source-profiles/js/carrier-references.js";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/index.js";
import { rustJsErrorTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { finalizeProviderOperationFact } from "../../../dist/analysis/operations/provider/calls/template-instantiation.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

test("every JSON serializer overload retains the actual runtime error while parse retains its native JS error", () => {
  const rows = jsOperationRows.filter(row => row.owner === "JSON" && row.member === "stringify");
  assert.equal(rows.length, 13);
  for (const row of rows) {
    const carriers = row.shape.params.map(reference => resolveCarrierRef(reference, {}));
    assert.equal(carriers.every(carrier => carrier !== undefined), true, row.variant);
    const selected = selectJsSurfaceOperation({ ownerName: "JSON", memberName: "stringify",
      operationKind: "call", argumentCarriers: carriers });
    assert.equal(selected !== undefined, true, row.variant);
    assert.equal(selected.fact.isFallible, true, row.variant);
    assert.equal(selected.fact.errorBoundary, "target-runtime", row.variant);
    assert.equal(selected.fact.errorCarrier, undefined, row.variant);
    const fact = finalizeProviderOperationFact(selected.fact, carriers, undefined, emptyRustTypeDefinitions);
    assert.equal(fact !== undefined, true, row.variant);
    assert.equal(fact.abi.effects.errorBoundary, "target-runtime", row.variant);
    assert.equal(fact.abi.effects.errorCarrier, undefined, row.variant);
  }
  const parsed = selectJsSurfaceOperation({ ownerName: "JSON", memberName: "parse",
    operationKind: "call", argumentCarriers: [rustStringTargetType()] });
  assert.equal(parsed !== undefined, true);
  assert.equal(parsed.fact.errorBoundary, "provider-native");
  assert.deepEqual(parsed.fact.errorCarrier, rustJsErrorTargetType());
});

test("declarative native error boundaries reject unsupported, executable and infallible selections", () => {
  const row = jsOperationRows.find(row => row.owner === "JSON" && row.member === "stringify");
  assert.equal(row !== undefined, true);
  for (const errorBoundary of [null, false, "source-program", "provider-native", "unknown", {}]) {
    assert.throws(() => defineJsOperationRows([{ ...row, errorBoundary }]), /invalid native error boundary/u);
  }
  assert.throws(() => defineJsOperationRows([{ ...row, fallible: false }]), /invalid native error boundary/u);
  let reads = 0;
  const executable = { ...row, get errorBoundary() { reads += 1; return "target-runtime"; } };
  assert.throws(() => defineJsOperationRows([executable]), /invalid native error boundary/u);
  assert.equal(reads, 0);
});
