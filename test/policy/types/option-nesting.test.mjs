import assert from "node:assert/strict";
import test from "node:test";
import { rustOptionNestingDepth, rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";

test("option nesting requires the exact final carrier and rejects malformed relationships", () => {
  const value = { kind: "source-primitive", name: "float64" };
  const option = rustOptionTargetType(value);
  const nested = rustOptionTargetType(option);
  assert.equal(rustOptionNestingDepth(value, value), 0);
  assert.equal(rustOptionNestingDepth(option, value), 1);
  assert.equal(rustOptionNestingDepth(nested, value), 2);
  assert.equal(rustOptionNestingDepth(nested, option), 1);
  assert.equal(rustOptionNestingDepth(option, nested), undefined);
  assert.equal(rustOptionNestingDepth(nested, { kind: "source-primitive", name: "int32" }), undefined);
  assert.equal(rustOptionNestingDepth({ ...option, genericArguments: [] }, value), undefined);
  const cyclic = { ...option, genericArguments: [{ kind: "type", type: value }] };
  cyclic.genericArguments[0].type = cyclic;
  assert.equal(rustOptionNestingDepth(cyclic, value), undefined);
});
