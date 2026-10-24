import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeOptionBranch, planRustOptionBranch } from "../../../../dist/backend/planner/expressions/option-branch.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";
import { rustTsValueTargetType } from "../../../../dist/target-model/types/index.js";
import { printRustExpr } from "../../../../dist/print/source/index.js";
import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";

// The planner reads each Option carrier's sealed storage and rendering; a real program selects them.
const stringCarrier = { kind: "target-named", id: "rust.std.String" };
const program = rustProgramWithTypeEmissions([
  { kind: "source-primitive", name: "int32" }, stringCarrier, { kind: "source-primitive", name: "float64" },
  { kind: "source-primitive", name: "bool" }, { kind: "source-primitive", name: "char" }, { kind: "tuple", elements: [] },
  rustOptionTargetType(stringCarrier),
].map(rustOptionTargetType));
const planContext = (overrides = {}) => rustProgramPlanContext(program, overrides);

test("native optional effects keep one input and payload scope without an empty match arm", () => {
  const option = { kind: "call", path: "next_optional", args: [] };
  const present = { kind: "call", path: "consume_present", args: [{ kind: "path", path: "present" }] };
  const absent = { kind: "tuple-literal", elements: [] };
  const branch = planRustNativeOptionBranch(option, "present", present, absent);
  assert.equal(branch.kind, "if-let", "a genuinely empty absence has no value or effect to emit");
  assert.equal(branch.expression === option, true, "the actual optional source is evaluated once in its original position");
  assert.equal(branch.whenTrue === present, true, "the payload is consumed in the same selected native branch scope");
  assert.equal(branch.pattern.kind, "tuple-variant", "the real Some pattern retains its native move or borrowed payload");
  assert.equal(branch.pattern.path, "Some");
  assert.equal(branch.pattern.elements[0].name, "present");
  assert.equal(Object.hasOwn(branch, "whenFalse"), false, "there is no artificial absent value binding or Drop scope");
  const carrier = rustOptionTargetType({ kind: "source-primitive", name: "int32" });
  const planned = planRustOptionBranch(option, carrier, "present", present, absent, planContext());
  assert.equal(planned.kind, "if-let", "the canonical carrier-selected option branch uses the same native effect recipe");
  assert.equal(planned.expression === option && planned.whenTrue === present, true,
    "the shared recipe does not reconstruct or duplicate either original expression");
  for (const fallback of [
    { kind: "call", path: "on_absent", args: [] },
    { kind: "evaluate-then", effect: { kind: "call", path: "on_absent", args: [] }, value: absent },
    { kind: "tuple-literal", elements: [{ kind: "call", path: "on_absent", args: [] }] },
    { kind: "none" },
  ]) {
    const selected = planRustNativeOptionBranch(option, "present", present, fallback);
    assert.equal(selected.kind, "match", "an actual absent value, effect or fallback alternative remains conditional");
    assert.equal(selected.expression === option, true, "fallback selection retains the identical input evaluation");
    assert.equal(selected.arms[0].expression === present && selected.arms[1].expression === fallback, true,
      "neither branch evaluation, effect nor lifetime boundary is discarded");
  }
});

test("native optional effects preserve temporary receiver and payload Drop order", { timeout: 300_000 }, () => {
  const option = { kind: "method-call", receiver: { kind: "field", name: "payload", receiver: {
    kind: "call", path: "holder", args: [{ kind: "path", path: "trace" }, { kind: "path", path: "present" }],
  } }, method: "as_ref", args: [] };
  const present = { kind: "call", path: "observe", args: [{ kind: "path", path: "payload" }] };
  const selected = planRustNativeOptionBranch(option, "payload", present, { kind: "tuple-literal", elements: [] });
  const project = writeGeneratedProject("native-option-effect-drop-order", [
    { kind: "source", path: "Cargo.toml", text: '[package]\nname = "native_option_effect_drop_order"\nversion = "0.1.0"\nedition = "2024"\n' },
    { kind: "source", path: "src/lib.rs", text: `
#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;
    type Trace = Rc<RefCell<Vec<&'static str>>>;
    struct Payload { trace: Trace }
    impl Drop for Payload {
        fn drop(&mut self) { self.trace.borrow_mut().push("payload"); }
    }
    struct Holder { payload: Option<Payload>, trace: Trace }
    impl Drop for Holder {
        fn drop(&mut self) { self.trace.borrow_mut().push("subject"); }
    }
    fn holder(trace: &Trace, present: bool) -> Holder {
        trace.borrow_mut().push("input");
        Holder { payload: if present { Some(Payload { trace: Rc::clone(trace) }) } else { None }, trace: Rc::clone(trace) }
    }
    fn observe(payload: &Payload) { payload.trace.borrow_mut().push("present"); }
    fn selected(trace: &Trace, present: bool) {
        ${printRustExpr(selected)};
        trace.borrow_mut().push("after");
    }
    #[test]
    fn exact_native_lifetimes_and_effects() {
        for (present, expected) in [
            (true, vec!["input", "present", "subject", "payload", "after"]),
            (false, vec!["input", "subject", "after"]),
        ] {
            let trace = Rc::new(RefCell::new(Vec::new()));
            selected(&trace, present);
            assert_eq!(*trace.borrow(), expected);
        }
    }
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["test", "--locked", "--offline"]);
});

test("a complex optional scrutinee is evaluated once within its branch lifetime", () => {
  const option = { kind: "block", body: { statements: [{ kind: "tail", expr: { kind: "call", path: "produce", args: [] } }] } };
  const present = { kind: "path", path: "present" };
  const absent = { kind: "call", path: "fallback", args: [] };
  const state = { reserved: new Set(["optional_input"]), nextSuffixByBase: new Map() };
  const context = planContext({ syntheticNames: state });
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
  assert.equal(planRustOptionBranch(option, carrier, "present", present, absent, planContext()) === option, true,
    "no second evaluation, wrapper, branch, conversion or mapping closure");
  const owner = { kind: "named", path: "Option", genericArguments: [
    { kind: "type", type: { kind: "primitive", name: "i32" } },
  ] };
  const typedAbsence = { kind: "associated-value", owner, name: "None" };
  assert.equal(planRustOptionBranch(option, carrier, "present", present, typedAbsence, planContext()) === option, true,
    "the exact selected native absence needs no identity match");
  for (const changed of [
    { ...typedAbsence, name: "Other" },
    { ...typedAbsence, trait: { kind: "named", path: "OtherTrait" } },
    { ...typedAbsence, owner: { kind: "named", path: "OtherOption", genericArguments: owner.genericArguments } },
    { ...typedAbsence, owner: { ...owner, genericArguments: [
      { kind: "type", type: { kind: "primitive", name: "i64" } },
    ] } },
  ]) {
    const selected = planRustOptionBranch(option, carrier, "present", present, changed, planContext());
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
    const selected = planRustOptionBranch(option, carrier, "present", changed, absent, planContext());
    assert.equal(selected.kind, "match", "a different present operation is not identity");
    assert.equal(selected.arms[0].expression === changed, true, "retain every conversion or effect");
    assert.equal(selected.arms[1].expression === absent, true);
  }
  const effect = { kind: "call", path: "on_absent", args: [] };
  const selected = planRustOptionBranch(option, carrier, "present", present, effect, planContext());
  assert.equal(selected.kind, "match");
  assert.equal(selected.arms[1].expression === effect, true, "the absent effect remains lazy");
});

test("an identity Option branch uses the native empty String default without allocating a fallback", () => {
  const option = { kind: "path", path: "input" };
  const present = { kind: "path", path: "present" };
  const empty = { kind: "string-literal", value: "" };
  const carrier = rustOptionTargetType({ kind: "target-named", id: "rust.std.String" });
  const selected = planRustOptionBranch(option, carrier, "present", present, empty, planContext());
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
    const branch = planRustOptionBranch(option, rustOptionTargetType(valueCarrier), "present", present, fallback, planContext());
    assert.equal(branch.method, "unwrap_or_default", fallback.kind);
    assert.deepEqual(branch.args, []);
  }
  const negativeZero = { kind: "unary", operator: "-", operand: { kind: "float-literal", text: "0.0" } };
  const negative = planRustOptionBranch(option, rustOptionTargetType({ kind: "source-primitive", name: "float64" }),
    "present", present, negativeZero, planContext());
  assert.equal(negative.method, "unwrap_or",
    "preserve the authored negative-zero sign rather than replacing it with positive zero");
  assert.equal(negative.args[0] === negativeZero, true);
  for (const fallback of [{ kind: "string-literal", value: "not empty" },
    { kind: "call", path: "effect", args: [] },
    { kind: "await", expr: { kind: "path", path: "pending" } }]) {
    const branch = planRustOptionBranch(option, carrier, "present", present, fallback, planContext());
    assert.equal(branch.kind, "match");
    assert.equal(branch.arms[1].expression === fallback, true, "preserve exact lazy evaluation");
  }
  const converted = { kind: "call", path: "convert", args: [present] };
  const branch = planRustOptionBranch(option, carrier, "present", converted, empty, planContext());
  assert.equal(branch.kind, "match");
  assert.equal(branch.arms[0].expression === converted, true, "do not discard the selected conversion");
});

test("an exact custom optional identity arm returns its consuming native payload without an artificial local", () => {
  const carrier = rustTsValueTargetType();
  const selectedProgram = rustProgramWithTypeEmissions([carrier]);
  assert.equal(selectedProgram.records.typeEmission.get(carrier)?.optionalStorage.kind, "custom",
    "the real native type owner selects the consuming custom optional storage");
  const context = rustProgramPlanContext(selectedProgram);
  const option = { kind: "call", path: "produce", args: [] };
  const present = { kind: "path", path: "present" };
  const absent = { kind: "call", path: "fallback", args: [] };
  const result = planRustOptionBranch(option, carrier, "present", present, absent, context);
  assert.equal(result.kind, "block", "the source input retains its one existing storage binding");
  const [binding, tail] = result.body.statements;
  assert.equal(binding.kind, "let");
  assert.equal(binding.init === option, true, "the complete source input is evaluated exactly once");
  assert.equal(tail.kind, "tail");
  const branch = tail.expr;
  assert.equal(branch.kind, "conditional");
  assert.equal(branch.condition.kind, "associated-call");
  assert.equal(branch.condition.method, "is_absent");
  assert.equal(branch.condition.args[0].kind, "reference");
  assert.equal(branch.condition.args[0].expr.path, binding.name, "presence inspects that same native storage");
  assert.equal(branch.whenTrue === absent, true, "fallback effects remain lazy and unchanged");
  assert.equal(branch.whenFalse.kind, "associated-call", "the helper introduces no return-only payload binding");
  assert.equal(branch.whenFalse.method, "into_present");
  assert.equal(branch.whenFalse.args.length, 1);
  assert.equal(branch.whenFalse.args[0].kind, "path", "the selected native ABI consumes the stored value by value");
  assert.equal(branch.whenFalse.args[0].path, binding.name);
  assert.equal(branch.whenFalse.trait.kind, "named");
  assert.equal(branch.whenFalse.trait.path, "rt::OptionalStorage", "the already admitted native trait remains the sole payload contract");
  for (const [label, mapped] of [
    ["conversion effect", { kind: "call", path: "convert", args: [present] }],
    ["borrowed address", { kind: "reference", expr: present }],
    ["two payload uses", { kind: "binary", operator: "+", left: present, right: present }],
    ["unrelated native path", { kind: "path", path: "other" }],
    ["generic native item", { ...present, genericArguments: [{ kind: "type", type: { kind: "primitive", name: "i32" } }] }],
  ]) {
    const selected = planRustOptionBranch(option, carrier, "present", mapped, absent, context).body.statements[1].expr;
    assert.equal(selected.whenTrue === absent, true, `${label}: the fallback is never changed or eagerly evaluated`);
    assert.equal(selected.whenFalse.kind, "block", `${label}: a nonidentity arm retains its original payload binding and scope`);
    const [payload, returned] = selected.whenFalse.body.statements;
    assert.equal(payload.kind, "let", label);
    assert.equal(payload.name, "present", label);
    assert.equal(payload.init.kind, "associated-call", label);
    assert.equal(payload.init.method, "into_present", `${label}: the payload is still extracted exactly once`);
    assert.equal(returned.kind, "tail", label);
    assert.equal(returned.expr === mapped, true, `${label}: preserve the complete original mapped expression`);
  }
});
