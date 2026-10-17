import assert from "node:assert/strict";
import test from "node:test";
import { selectRustEnumConstantRepresentation } from "../../../../dist/policy/types/enums/constant-admission.js";

for (const [name, values, expected] of [
  ["empty", [], "constants"],
  ["one", [0n], "enum"],
  ["distinct", [-2147483648n, 0n, 2147483647n], "enum"],
  ["wide distinct", [-9223372036854775808n, 9223372036854775807n], "enum"],
  ["duplicate", [1n, 2n, 1n], "constants"],
  ["wide duplicate", [9007199254740993n, 9007199254740992n, 9007199254740993n], "constants"],
]) {
  test(`${name} enum selects only its native physical form from exact values`, () => {
    const frozen = Object.freeze(values);
    assert.equal(selectRustEnumConstantRepresentation(frozen), expected, name);
    assert.equal(Object.isFrozen(frozen), true, `${name}: the shared finite values remain unchanged`);
  });
}
