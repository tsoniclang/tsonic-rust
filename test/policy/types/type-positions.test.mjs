import assert from "node:assert/strict";
import test from "node:test";
import { selectRustTypePositions } from "../../../dist/policy/types/resolution/type-emission.js";

const concrete = Object.freeze({ opaque: false, general: true, parameter: true, return: true });
const anonymous = Object.freeze({ opaque: true, general: false, parameter: true, return: true });
const input = fields => ({ carrier: { kind: "source-primitive", name: "int32" }, children: [],
  opaque: "none", boundPositions: { parameter: true, return: true }, capturesOpaque: false, nested: true, ...fields });

test("anonymous native bounds admit signature positions but never concrete storage", () => {
  for (const opaque of ["explicit", "input"]) {
    assert.deepEqual(selectRustTypePositions(input({ opaque })), anonymous, opaque);
    assert.deepEqual(selectRustTypePositions(input({ opaque, capturesOpaque: true })),
      { opaque: true, general: false, parameter: false, return: false }, opaque + ": no escaping opaque capture");
    assert.deepEqual(selectRustTypePositions(input({ opaque, boundPositions: { parameter: false, return: true } })),
      { opaque: true, general: false, parameter: false, return: true }, opaque + ": exact native bound positions");
  }
  for (const count of [1, 2, 3]) {
    assert.deepEqual(selectRustTypePositions(input({ children: Array(count).fill(anonymous) })), anonymous,
      "exact nested native containers retain signature-only positions");
  }
});

test("callable containers never hide anonymous positional arguments or results", () => {
  assert.deepEqual(selectRustTypePositions(input({ opaque: "callable", children: [concrete, concrete] })), anonymous);
  for (const children of [[anonymous], [concrete, anonymous], [anonymous, concrete]]) {
    assert.deepEqual(selectRustTypePositions(input({ opaque: "callable", children })),
      { opaque: true, general: false, parameter: false, return: false },
      "a callable ABI must have concrete parameter and result carriers");
  }
  assert.deepEqual(selectRustTypePositions(input({ children: [anonymous], nested: false })),
    { opaque: true, general: false, parameter: false, return: false }, "a non-nestable owner cannot hide an opaque child");
});

test("concrete native carriers remain legal independently of spelling or generated syntax", () => {
  assert.deepEqual(selectRustTypePositions(input({ children: [concrete] })), concrete);
});
