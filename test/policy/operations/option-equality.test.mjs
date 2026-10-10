import assert from "node:assert/strict";
import test from "node:test";
import { rustOptionEqualityContract } from "../../../dist/target-model/operations/option-equality.js";
import { isRustStringViewCarrier } from "../../../dist/target-model/types/carriers/native.js";
import { rustBorrowedStrTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType, rustStrTargetType,
  rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { selectRustBinaryOperator } from "../../../dist/policy/operations/operators/rules.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";

function optional(carrier, depth) {
  for (let index = 0; index < depth; index += 1) carrier = rustOptionTargetType(carrier);
  return carrier;
}

test("native optional equality retains presence depth and borrows every owned/borrowed string pairing", () => {
  for (const left of [rustStringTargetType(), rustBorrowedStrTargetType()]) {
    for (const right of [rustStringTargetType(), rustBorrowedStrTargetType()]) {
      for (const leftDepth of [0, 1, 2, 3]) for (const rightDepth of [0, 1, 2, 3]) {
        if (leftDepth === 0 && rightDepth === 0) continue;
        const leftCarrier = optional(left, leftDepth);
        const rightCarrier = optional(right, rightDepth);
        const contract = rustOptionEqualityContract(leftCarrier, rightCarrier);
        assert.equal(contract !== undefined, true, `${leftDepth}/${rightDepth}`);
        assert.deepEqual(contract, { leftCarrier, rightCarrier,
          comparisonCarrier: optional(rustBorrowedStrTargetType(), Math.max(leftDepth, rightDepth)),
          leftLiftDepth: Math.max(0, rightDepth - leftDepth), rightLiftDepth: Math.max(0, leftDepth - rightDepth),
          borrowString: true });
        assert.equal(Object.isFrozen(contract), true);
      }
    }
  }
  for (const carrier of [rustSourcePrimitiveTargetType("bool"), rustSourcePrimitiveTargetType("int64")]) {
    const contract = rustOptionEqualityContract(optional(carrier, 2), carrier);
    assert.deepEqual(contract, { leftCarrier: optional(carrier, 2), rightCarrier: carrier,
      comparisonCarrier: optional(carrier, 2), leftLiftDepth: 0, rightLiftDepth: 2, borrowString: false });
  }
});

test("native string comparison admits shared str lifetimes without broadening owned storage or mutable references", () => {
  const staticText = { ...rustBorrowedStrTargetType(), lifetime: rustStaticLifetime };
  assert.equal(isRustStringViewCarrier(staticText), true);
  for (const left of [rustStringTargetType(), rustBorrowedStrTargetType(), staticText]) {
    for (const right of [rustStringTargetType(), rustBorrowedStrTargetType(), staticText]) {
      for (const operator of ["===", "!==", "<", "<=", ">", ">="]) {
        assert.equal(selectRustBinaryOperator(operator, left, right) !== undefined, true, operator);
      }
    }
  }
  const malformed = optional(rustStringTargetType(), 1);
  malformed.genericArguments = [];
  const cyclic = optional(rustStringTargetType(), 1);
  cyclic.genericArguments = [{ kind: "type", type: cyclic }];
  for (const carrier of [undefined, rustStrTargetType(), { ...rustBorrowedStrTargetType(), mutable: true },
    { ...rustBorrowedStrTargetType(), extra: true }, malformed, cyclic, rustSourcePrimitiveTargetType("float64")]) {
    assert.equal(isRustStringViewCarrier(carrier), false);
    assert.equal(rustOptionEqualityContract(optional(rustStringTargetType(), 1), carrier), undefined);
    assert.equal(rustOptionEqualityContract(carrier, optional(rustStringTargetType(), 1)), undefined);
  }
  assert.equal(rustOptionEqualityContract(rustStringTargetType(), rustBorrowedStrTargetType()), undefined);
});
