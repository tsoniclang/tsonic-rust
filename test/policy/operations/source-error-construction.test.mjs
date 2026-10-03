import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceErrorConstructorOperation, selectRustSourceErrorConstructor } from "../../../dist/policy/operations/source-profiles/error-source-profile.js";
import { rustProviderArgumentBorrowsString } from "../../../dist/policy/ownership/provider-argument-borrow.js";
import { rustSourceErrorConstructors } from "../../../dist/target-model/identities/source-errors.js";
import { rustAbsenceTargetType, rustJsErrorTargetType, rustSourceOptionalTargetType, rustSourcePrimitiveTargetType,
  rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustOptionalStringToBorrowedStrValueConversion } from "../../../dist/target-model/conversions/model.js";

test("source error construction and borrowing consume one exact native profile contract", () => {
  const string = rustStringTargetType();
  const optional = rustSourceOptionalTargetType(string);
  for (const constructor of rustSourceErrorConstructors) {
    for (const profile of ["native", "js"]) {
      const member = { profile, ownerName: constructor.ownerName, memberName: "constructor", declaration: {} };
      const selected = selectRustSourceErrorConstructor(member, true);
      assert.equal(selected, constructor.sourceName === "Error" || profile === "js" ? constructor : undefined);
      assert.equal(selectRustSourceErrorConstructor(member, false), undefined);
      assert.equal(selectRustSourceErrorConstructor({ ...member, memberName: "call" }, false), selected);
      assert.equal(selectRustSourceErrorConstructor({ ...member, ownerName: "UnrelatedConstructor" }, true), undefined);
      assert.equal(selectRustSourceErrorConstructor({ ...member, memberName: "message" }, true), undefined);
    }
    const empty = rustSourceErrorConstructorOperation(constructor, []);
    assert.deepEqual(empty.target.trailingArguments, [{ kind: "string", value: "" }]);
    assert.deepEqual(empty.parameterCarriers, []);
    const required = rustSourceErrorConstructorOperation(constructor, [string]);
    assert.deepEqual(required.resultCarrier, rustJsErrorTargetType());
    assert.equal(required.target.path, constructor.path);
    assert.equal(rustProviderArgumentBorrowsString(required, 0), true);
    for (const carrier of [optional, rustAbsenceTargetType()]) {
      const selected = rustSourceErrorConstructorOperation(constructor, [carrier]);
      assert.deepEqual(selected.parameterCarriers, [optional]);
      assert.deepEqual(selected.target.argModes, ["value"]);
      assert.deepEqual(selected.target.argConversions, [rustOptionalStringToBorrowedStrValueConversion]);
      assert.equal(selected.isAsync, false);
      assert.equal(selected.isFallible, false);
    }
    for (const arguments_ of [[undefined], [rustSourcePrimitiveTargetType("uint64")],
      [rustJsErrorTargetType()], [rustSourceOptionalTargetType(rustSourcePrimitiveTargetType("uint64"))], [string, string]]) {
      assert.equal(rustSourceErrorConstructorOperation(constructor, arguments_), undefined);
    }
    assert.equal(rustSourceErrorConstructorOperation({ ...constructor, path: "unrelated::constructor" }, [string]), undefined);
  }
  assert.equal(selectRustSourceErrorConstructor(undefined, true), undefined);
});
