import assert from "node:assert/strict";
import test from "node:test";
import { planRustOptionBranch } from "../../../../dist/backend/planner/expressions/option-branch.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";

test("a complex optional scrutinee is evaluated once within its branch lifetime", () => {
  const option = { kind: "block", body: { statements: [{ kind: "tail", expr: { kind: "call", path: "produce", args: [] } }] } };
  const present = { kind: "path", path: "present" };
  const absent = { kind: "call", path: "fallback", args: [] };
  const state = { reserved: new Set(["optional_input"]), nextSuffixByBase: new Map() };
  const context = { syntheticNames: state };
  const result = planRustOptionBranch(option, rustOptionTargetType({ kind: "source-primitive", name: "int32" }), "present", present, absent, context);
  assert.equal(result.kind, "block");
  const [binding, tail] = result.body.statements;
  assert.equal(binding.kind, "let");
  assert.equal(binding.name, "optional_input_2", "one canonical collision-safe allocator");
  assert.equal(binding.init === option, true, "evaluate the complete original input exactly once");
  assert.equal(tail.kind, "tail");
  assert.equal(tail.expr.kind, "match");
  assert.deepEqual(tail.expr.expression, { kind: "path", path: binding.name });
  assert.equal(tail.expr.arms[0].expression === present, true);
  assert.equal(tail.expr.arms[1].expression === absent, true, "no eager fallback execution");
  const direct = { kind: "path", path: "input" };
  const branch = planRustOptionBranch(direct, rustOptionTargetType({ kind: "source-primitive", name: "int32" }), "present", present, absent, context);
  assert.equal(branch.kind, "match");
  assert.equal(branch.expression === direct, true, "simple native input requires no temporary");
});

test("a native Option identity branch retains one unchanged input evaluation", () => {
  const option = { kind: "call", path: "produce", args: [] };
  const value = { kind: "path", path: "present" };
  const present = { kind: "call", path: "Some", args: [value] };
  const absent = { kind: "none" };
  const carrier = rustOptionTargetType({ kind: "source-primitive", name: "int32" });
  assert.equal(planRustOptionBranch(option, carrier, "present", present, absent, {}) === option, true,
    "no second evaluation, wrapper, branch, conversion or mapping closure");
  const owner = { kind: "named", path: "Option", genericArguments: [
    { kind: "type", type: { kind: "primitive", name: "i32" } },
  ] };
  const typedAbsence = { kind: "associated-value", owner, name: "None" };
  assert.equal(planRustOptionBranch(option, carrier, "present", present, typedAbsence, {}) === option, true,
    "the exact selected native absence needs no identity match");
  for (const changed of [
    { ...typedAbsence, name: "Other" },
    { ...typedAbsence, trait: { kind: "named", path: "OtherTrait" } },
    { ...typedAbsence, owner: { kind: "named", path: "OtherOption", genericArguments: owner.genericArguments } },
    { ...typedAbsence, owner: { ...owner, genericArguments: [
      { kind: "type", type: { kind: "primitive", name: "i64" } },
    ] } },
  ]) {
    const selected = planRustOptionBranch(option, carrier, "present", present, changed, {});
    assert.equal(selected.kind, "match", "an unrelated selected absence is not identity");
    assert.equal(selected.arms[1].expression === changed, true);
  }
  for (const changed of [
    { ...present, path: "convert" },
    { ...present, args: [{ kind: "path", path: "other" }] },
    { ...present, args: [{ kind: "call", path: "convert", args: [value] }] },
    { ...present, args: [value, value] },
    { ...present, genericArguments: [{ kind: "type", type: { kind: "primitive", name: "i64" } }] },
  ]) {
    const selected = planRustOptionBranch(option, carrier, "present", changed, absent, {});
    assert.equal(selected.kind, "match", "a different present operation is not identity");
    assert.equal(selected.arms[0].expression === changed, true, "retain every conversion or effect");
    assert.equal(selected.arms[1].expression === absent, true);
  }
  const effect = { kind: "call", path: "on_absent", args: [] };
  const selected = planRustOptionBranch(option, carrier, "present", present, effect, {});
  assert.equal(selected.kind, "match");
  assert.equal(selected.arms[1].expression === effect, true, "the absent effect remains lazy");
});

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
