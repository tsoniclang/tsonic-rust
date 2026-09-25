import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceConstFor, targetConstFor } from "../../../../dist/providers/native/projection/type-arguments.js";

test("provider const projection preserves arbitrary native integer identity", () => {
  for (const value of ["0", "1", "-1", "9007199254740991", "9007199254740992", "9007199254740993", "-9223372036854775808", "18446744073709551615"]) {
    const constant = { kind: "integer", value };
    const projected = sourceConstFor(constant, {});
    assert.deepEqual(projected, Number.isSafeInteger(Number(value))
      ? { kind: "literal", value: Number(value) }
      : { kind: "bigint-literal", value });
    assert.deepEqual(targetConstFor(constant, {}), constant);
  }
});
