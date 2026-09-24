import assert from "node:assert/strict";
import test from "node:test";
import { rustProviderArgumentBorrowsString } from "../../../dist/policy/ownership/provider-argument-borrow.js";
import { rustStringToBorrowedStrValueConversion } from "../../../dist/target-model/conversions/model.js";
import { rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("provider input borrowing requires one exact synchronous shared string contract", () => {
  const row = { providerPackageId: "proof", providerId: "proof", providerVersion: "1",
    providerModuleId: "proof", moduleSpecifier: "@proof/io", exportId: "read",
    operationKind: "method", parameterCarriers: [rustStringTargetType()],
    resultCarrier: rustSourcePrimitiveTargetType("uint64"),
    target: { form: "call", path: "proof::read", argModes: ["value"],
      argConversions: [rustStringToBorrowedStrValueConversion] } };
  assert.equal(rustProviderArgumentBorrowsString(row, 0), true);
  assert.equal(rustProviderArgumentBorrowsString(row, 1), false);
  assert.equal(rustProviderArgumentBorrowsString({ ...row, isAsync: true }, 0), false);
  for (const target of [
    { form: "call", path: "proof::consume", argModes: ["value"] },
    { form: "call", path: "proof::mutate", argModes: ["mut-ref"] },
    { ...row.target, argOrder: [1, 0] },
    { ...row.target, argConversions: [{ kind: "invalid" }] },
  ]) assert.equal(rustProviderArgumentBorrowsString({ ...row, target }, 0), false);
  assert.equal(rustProviderArgumentBorrowsString({ ...row, target: {
    form: "call", path: "proof::read", argModes: ["ref"],
  } }, 0), true);
  assert.equal(rustProviderArgumentBorrowsString({ ...row,
    parameterCarriers: [rustSourcePrimitiveTargetType("uint64")],
  }, 0), false);
});
