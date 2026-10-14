import assert from "node:assert/strict";
import test from "node:test";
import { selectRustValueReadOwnership } from "../../../dist/policy/ownership/value-read.js";

test("read selection uses only exact native trait and source-use premises", () => {
  for (const [input, expected] of [
    [{ copy: true, clone: true, transfer: false }, { kind: "copy" }],
    [{ copy: false, clone: true, transfer: true }, { kind: "move" }],
    [{ copy: false, clone: true, transfer: false }, { kind: "clone" }],
    [{ copy: false, clone: false, transfer: false, borrowed: "shared" }, { kind: "borrow", mutable: false }],
    [{ copy: false, clone: false, transfer: false, borrowed: "mutable" }, { kind: "borrow", mutable: true }],
  ]) assert.deepEqual(selectRustValueReadOwnership(input), expected);
  assert.equal(selectRustValueReadOwnership({ copy: false, clone: false, transfer: false }) === undefined, true);
});
