import assert from "node:assert/strict";
import test from "node:test";
import { planEnumDeclaration } from "../../../../dist/backend/planner/declarations/enums/planning.js";

for (const [name, values, width] of [
  ["empty", [], 32],
  ["one", [0n], 32],
  ["distinct", [-2147483648n, 0n, 2147483647n], 32],
  ["wide distinct", [-9223372036854775808n, 9223372036854775807n], 64],
  ["duplicate", [1n, 2n, 1n], 32],
  ["wide duplicate", [9007199254740993n, 9007199254740992n, 9007199254740993n], 64],
]) {
  test(`${name} enum renders one transparent integer form from exact sealed values`, () => {
    const frozen = Object.freeze(values);
    const declaration = {};
    const variants = frozen.map((value, index) => Object.freeze({ declaration: {}, name: `Member${index}`, discriminant: value.toString() }));
    const form = Object.freeze({ kind: "enum", name: "Value", integerWidth: width, variants: Object.freeze(variants) });
    const items = planEnumDeclaration(declaration, { input: { program: {
      source: { ast: { hasModifierKind: () => true } },
      nativeDeclarations: { get: node => node === declaration ? form : undefined },
      reachability: { suppressedDeclarations: new Set(), externallyReachable: new Set([declaration]) },
    } } });
    assert.equal(items.filter(item => item.kind === "struct").length, 1, `${name}: one nominal integer wrapper`);
    assert.equal(items.some(item => item.kind === "enum"), false, `${name}: no closed discriminant representation`);
    assert.equal(items[0].fields[0].type.name, width === 32 ? "i32" : "i64", `${name}: completed native width`);
    const constants = items.find(item => item.kind === "impl" && item.trait === undefined).members;
    assert.equal(constants.length, frozen.length, `${name}: no member or duplicate is discarded`);
    constants.forEach((constant, index) => assert.equal(constant.value.fields[0].value.text, frozen[index].toString(),
      `${name}: exact member ${index}`));
    assert.deepEqual(items.filter(item => item.kind === "impl" && item.trait !== undefined).map(item => item.trait.path),
      ["core::ops::BitOr", "core::ops::BitAnd", "core::ops::BitXor", "core::ops::Not",
        "core::ops::BitOrAssign", "core::ops::BitAndAssign", "core::ops::BitXorAssign"], `${name}: native integer operations`);
    assert.equal(Object.isFrozen(frozen), true, `${name}: the shared finite values remain unchanged`);
  });
}
