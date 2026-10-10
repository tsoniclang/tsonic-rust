import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/index.js";
import { rustBorrowedStrTargetType, rustStringTargetType, rustJsRegExpTargetType } from "../../../dist/target-model/types/index.js";
import { jsArgumentCarrierMatchScore } from "../../../dist/policy/operations/source-profiles/js/argument-matching.js";

test("native read-only String APIs select exact borrowed inputs for owned and borrowed source values", () => {
  for (const carrier of [rustStringTargetType(), rustBorrowedStrTargetType()]) {
    for (const [ownerName, memberName, receiverCarrier] of [
      ["Global", "parseFloat"], ["Global", "parseInt"], ["Global", "encodeURIComponent"],
      ["Global", "decodeURIComponent"], ["NumberConstructor", "parseFloat"],
      ["NumberConstructor", "parseInt"], ["DateConstructor", "parse"], ["JSON", "parse"],
      ["JSON", "stringify"], ["RegExpConstructor", "call"], ["RegExp", "test", rustJsRegExpTargetType()],
    ]) {
      const operation = selectJsSurfaceOperation({ ownerName, memberName, operationKind: "call",
        receiverCarrier, argumentCarriers: [carrier] });
      assert.equal(operation?.fact.kind, "provider-operation", `${ownerName}.${memberName}`);
      assert.deepEqual(operation.fact.parameterCarriers, [rustBorrowedStrTargetType()]);
      assert.deepEqual(operation.fact.target.argModes, ["value"]);
    }
  }
});

test("native borrowed String coercions outrank allocating carriers without admitting mutable storage", () => {
  const expected = rustBorrowedStrTargetType();
  assert.equal(jsArgumentCarrierMatchScore(expected, rustStringTargetType(), 0, undefined), 0);
  assert.equal(jsArgumentCarrierMatchScore(expected, expected, 0, undefined), 0);
  assert.equal(jsArgumentCarrierMatchScore(expected, { ...expected, mutable: true }, 0, undefined), undefined);
});
