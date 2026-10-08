import assert from "node:assert/strict";
import test from "node:test";
import { planRustOptionBranch } from "../../../../dist/backend/planner/expressions/option-branch.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";

test("an identity Option branch uses the native empty String default without allocating a fallback", () => {
  const option = { kind: "path", path: "input" };
  const present = { kind: "path", path: "present" };
  const empty = { kind: "string-literal", value: "" };
  const carrier = rustOptionTargetType({ kind: "target-named", id: "rust.std.String" });
  const selected = planRustOptionBranch(option, carrier, "present", present, empty, {});
  assert.equal(selected.kind, "method-call");
  assert.equal(selected.receiver === option, true, "evaluate the optional input once");
  assert.equal(selected.method, "unwrap_or_default");
  assert.deepEqual(selected.args, []);
  for (const [fallback, valueCarrier] of [
    [{ kind: "int-literal", text: "0" }, { kind: "source-primitive", name: "int32" }],
    [{ kind: "float-literal", text: "0.0" }, { kind: "source-primitive", name: "float64" }],
    [{ kind: "bool-literal", value: false }, { kind: "source-primitive", name: "bool" }],
    [{ kind: "char-literal", value: "\0" }, { kind: "source-primitive", name: "char" }],
    [{ kind: "tuple-literal", elements: [] }, { kind: "tuple", elements: [] }],
    [{ kind: "none" }, carrier],
  ]) {
    const branch = planRustOptionBranch(option, rustOptionTargetType(valueCarrier), "present", present, fallback, {});
    assert.equal(branch.method, "unwrap_or_default", fallback.kind);
    assert.deepEqual(branch.args, []);
  }
  const negativeZero = { kind: "unary", operator: "-", operand: { kind: "float-literal", text: "0.0" } };
  const negative = planRustOptionBranch(option, rustOptionTargetType({ kind: "source-primitive", name: "float64" }),
    "present", present, negativeZero, {});
  assert.equal(negative.method, "unwrap_or",
    "preserve the authored negative-zero sign rather than replacing it with positive zero");
  assert.equal(negative.args[0] === negativeZero, true);
  for (const fallback of [{ kind: "string-literal", value: "not empty" },
    { kind: "call", path: "effect", args: [] },
    { kind: "await", expr: { kind: "path", path: "pending" } }]) {
    const branch = planRustOptionBranch(option, carrier, "present", present, fallback, {});
    assert.equal(branch.kind, "match");
    assert.equal(branch.arms[1].expression === fallback, true, "preserve exact lazy evaluation");
  }
  const converted = { kind: "call", path: "convert", args: [present] };
  const branch = planRustOptionBranch(option, carrier, "present", converted, empty, {});
  assert.equal(branch.kind, "match");
  assert.equal(branch.arms[0].expression === converted, true, "do not discard the selected conversion");
});
