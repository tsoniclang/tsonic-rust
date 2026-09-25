import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/selection.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";

test("floor policy retains every native integer carrier supplied by exact provider evidence", () => {
  for (const name of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "int128", "uint128", "native-int", "native-uint", "float32", "float64"]) {
    const carrier = { kind: "source-primitive", name };
    const selected = selectJsSurfaceOperation({ ownerName: "Math", memberName: "floor", operationKind: "call", argumentCarriers: [carrier],
      argumentMatchScore: (expected, actual) => actual !== undefined &&
        selectRustSourceValueConversion(actual, expected) !== undefined ? 1 : undefined,
    });
    assert(selected, name);
    const integral = !name.startsWith("float");
    assert.deepEqual(selected.resultCarrier, integral ? carrier : { kind: "source-primitive", name: "float64" }, name);
    assert.equal(selected.fact.target.form, integral ? "numeric-cast" : "arg-method", name);
    if (integral) assert.deepEqual(selected.parameterCarriers, [carrier], name);
  }
});
