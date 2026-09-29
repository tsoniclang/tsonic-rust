import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustSourceUnionCarrier, resolveRustUnionValueCarrier } from "../../../dist/policy/types/resolution/source-unions.js";
import { rustAbsenceTargetType, rustBigIntTargetType, rustJsNumericTargetType, rustJsStringNumberTargetType, rustSourcePrimitiveTargetType, rustStringTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";

test("authored and inferred union values retain the surface's exact scalar carrier", () => {
  const options = { jsEnabled: true, resolveProjectUnionCarrier: () => undefined };
  const number = rustSourcePrimitiveTargetType("float64");
  for (const [arm, expected] of [
    [rustBigIntTargetType(), rustJsNumericTargetType()],
    [rustStringTargetType(), rustJsStringNumberTargetType()],
  ]) {
    const resolve = values => resolveRustUnionValueCarrier(values, options, () => assert.fail("scalar union must not register a generated enum"));
    assert.deepEqual(resolveRustSourceUnionCarrier([number, arm], resolve), expected);
    const optional = resolveRustSourceUnionCarrier([arm, rustAbsenceTargetType(), number, rustUnitTargetType()], resolve);
    assert.equal(optional.id, "rust.std.Option");
    assert.deepEqual(optional.genericArguments, [{ kind: "type", type: expected }]);
  }
});

test("surface scalar union selection never rounds native integers or leaks into native mode", () => {
  const generated = { kind: "type-parameter", name: "Union", identity: "fixture.union" };
  for (const values of [
    [rustSourcePrimitiveTargetType("uint64"), rustBigIntTargetType()],
    [rustSourcePrimitiveTargetType("int64"), rustStringTargetType()],
  ]) {
    assert.equal(resolveRustUnionValueCarrier(values, { jsEnabled: true, resolveProjectUnionCarrier: () => undefined }, () => generated), generated);
  }
  assert.equal(resolveRustUnionValueCarrier([rustSourcePrimitiveTargetType("float64"), rustBigIntTargetType()],
    { jsEnabled: false, resolveProjectUnionCarrier: () => undefined }, () => generated), generated);
});
