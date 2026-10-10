import assert from "node:assert/strict";
import test from "node:test";
import { rustProviderArgumentBorrowsString } from "../../../dist/policy/ownership/provider-argument-borrow.js";
import { rustStringToBorrowedStrValueConversion } from "../../../dist/target-model/conversions/model.js";
import { rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustBorrowedStrTargetType } from "../../../dist/target-model/types/carriers/native.js";

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
  for (const form of ["call", "free-call"]) {
    const borrowed = { ...row, parameterCarriers: [rustBorrowedStrTargetType()],
      target: { form, path: "proof::read", receiverMode: "ref", argModes: ["value"] } };
    assert.equal(rustProviderArgumentBorrowsString(borrowed, 0), true, form);
    for (const invalid of [
      { isAsync: true }, { genericParameters: [{ name: "T" }] },
      { parameterCarriers: [{ ...rustBorrowedStrTargetType(), mutable: true }] },
      { target: { ...borrowed.target, argModes: ["mut-ref"] } },
      { target: { ...borrowed.target, argConversions: [rustStringToBorrowedStrValueConversion] } },
      { target: { ...borrowed.target, argOrder: [1, 0] } },
    ]) assert.equal(rustProviderArgumentBorrowsString({ ...borrowed, ...invalid }, 0), false);
    assert.equal(rustProviderArgumentBorrowsString({ ...borrowed, target: {
      ...borrowed.target, argConversions: [rustStringToBorrowedStrValueConversion],
    }, parameterCarriers: [rustStringTargetType()] }, 0), true);
  }
  const receiverMethod = { ...row, parameterCarriers: [rustBorrowedStrTargetType()],
    target: { form: "receiver-method", name: "join", argModes: ["value"] } };
  assert.equal(rustProviderArgumentBorrowsString(receiverMethod, 0), true);
  assert.equal(rustProviderArgumentBorrowsString({ ...receiverMethod,
    parameterCarriers: [rustStringTargetType()],
  }, 0), false);
});
