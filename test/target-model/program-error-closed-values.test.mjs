import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceValueConversion } from "../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../dist/target-model/conversions/contracts.js";
import { rustProgramErrorTargetType, rustSourcePrimitiveTargetType, rustTsValueTargetType,
  rustJsValueTargetType } from "../../dist/target-model/types/index.js";
import { rustClosedValueRetainsError } from "../../dist/target-model/types/carriers/closed-values.js";

test("program transports select payload projection rather than passive boxing or Error-only admission", () => {
  const source = rustProgramErrorTargetType();
  assert.equal(rustClosedValueRetainsError(source), false);
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const conversion = selectRustSourceValueConversion(source, target);
    assert.equal(conversion !== undefined, true, target.id);
    const contract = rustValueConversionContract(conversion);
    assert.equal(contract !== undefined, true, target.id);
    assert.equal(contract.lowering, "program-error-closed-value");
    assert.deepEqual(contract.source, source);
    assert.deepEqual(contract.target, target);
    assert.equal(contract.fallible, false);
    assert.equal(contract.sourceMode, "value");
  }
});

test("program projection does not acquire authority from a foreign spelling or malformed selection", () => {
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const conversion = selectRustSourceValueConversion(rustProgramErrorTargetType(), target);
    for (const changed of [{ ...conversion, extra: true },
      { ...conversion, source: { kind: "target-named", id: "foreign.TsonicError" } },
      { ...conversion, source: { ...rustProgramErrorTargetType(),
        genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("int32") }] } }]) {
      assert.equal(rustValueConversionContract(changed)?.lowering === "program-error-closed-value", false);
    }
    const primitive = selectRustSourceValueConversion(rustSourcePrimitiveTargetType("int32"), target);
    assert.equal(rustValueConversionContract(primitive)?.lowering === "program-error-closed-value", false);
  }
});
