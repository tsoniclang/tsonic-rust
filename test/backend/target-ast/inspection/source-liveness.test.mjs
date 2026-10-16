import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustBlockLiveness } from "../../../../dist/backend/target-ast/inspection/source-liveness.js";
import { rustLintAttributes } from "../../../../dist/backend/target-ast/normalization/lint-policy.js";

const input = { kind: "path", path: "input" };
const present = { kind: "path", path: "present" };
const owner = { kind: "path", path: "owner" };
const increment = { kind: "block", body: { statements: [
  { kind: "let", name: "value", mutable: false,
    init: { kind: "method-call", receiver: owner, method: "get", args: [] } },
  { kind: "let", name: "next", mutable: false, init:
    { kind: "binary", operator: "+", left: { kind: "path", path: "value" }, right: { kind: "int-literal", text: "1" } } },
  { kind: "expr", expr: { kind: "method-call", receiver: owner, method: "set", args: [
    { kind: "path", path: "next" },
  ] } },
  { kind: "tail", expr: { kind: "path", path: "next" } },
] } };
const sequenced = { ...increment, body: { statements: [
  ...increment.body.statements.slice(0, -2),
  { kind: "tail", expr: { kind: "evaluate-then", discard: "unit",
    effect: increment.body.statements[2].expr, value: increment.body.statements[3].expr } },
] } };
const branch = (selector, fallback) => ({ kind: "match", expression: selector, arms: [
  { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: "present" }] }, expression: present },
  { pattern: { kind: "path", path: "None" }, expression: fallback },
] });
const block = expression => ({ statements: [
  { kind: "let", name: "selected", mutable: false, init: expression },
  { kind: "tail", expr: { kind: "path", path: "selected" } },
] });

test("terminal conditional values fold one redundant binding without changing lazy mutation", () => {
  for (const expression of [branch(input, increment), branch(input, sequenced),
    { kind: "conditional", condition: input, whenTrue: present, whenFalse: increment }]) {
    const normalized = finalizeRustBlockLiveness(block(expression));
    assert.equal(normalized.statements.length, 1);
    assert.equal(normalized.statements[0].kind, "tail");
    assert.equal(JSON.stringify(normalized.statements[0].expr) === JSON.stringify(expression), true,
      "the branch retains every effect, order and exact owning scope");
  }
});

test("terminal folding retains bindings required by temporary receiver, label and type scopes", () => {
  const guard = { kind: "method-call", receiver: owner, method: "borrow", args: [] };
  const borrowed = { kind: "method-call", receiver: guard, method: "get", args: [] };
  for (const expression of [branch(guard, increment), branch(input, borrowed),
    branch(input, { kind: "evaluate-then", discard: "unit", effect: borrowed, value: present }),
    branch(input, { ...increment, label: "scope" })]) {
    assert.equal(finalizeRustBlockLiveness(block(expression)).statements.length, 2,
      "do not extend a guard or remove an authored scope");
  }
  const typed = block(branch(input, increment));
  typed.statements[0].type = { kind: "named", path: "i32" };
  assert.equal(finalizeRustBlockLiveness(typed).statements.length, 2,
    "explicit type selection remains mandatory");
});

test("native absence predicates fold terminal defaults only with stable operands", () => {
  const selected = { kind: "associated-call", owner: { kind: "named", path: "Stored" },
    trait: { kind: "named", path: "OptionalStorage" }, method: "is_absent",
    args: [{ kind: "reference", expr: input }] };
  const owned = { kind: "call", path: "ClosedValue::from", args: [
    { kind: "call", path: "String::from", args: [{ kind: "str-literal", value: "fallback" }] },
  ] };
  const expression = { kind: "conditional", condition: selected, whenTrue: owned, whenFalse: increment };
  const normalized = finalizeRustBlockLiveness(block(expression));
  assert.equal(normalized.statements.length, 1);
  assert.equal(JSON.stringify(normalized.statements[0].expr) === JSON.stringify(expression), true,
    "exact predicate and lazy branch effects are retained");
  const guard = { kind: "method-call", receiver: owner, method: "borrow", args: [] };
  const guarded = { ...expression, condition: { ...selected, args: [{ kind: "reference", expr: guard }] } };
  assert.equal(finalizeRustBlockLiveness(block(guarded)).statements.length, 2,
    "a temporary predicate argument retains its original drop scope");
  const borrowed = { kind: "call", path: "read", args: [{ kind: "reference", expr: guard }] };
  const temporary = { ...expression, whenTrue: { kind: "call", path: "retain", args: [borrowed] } };
  assert.equal(finalizeRustBlockLiveness(block(temporary)).statements.length, 2,
    "nested calls must not conceal a borrowed temporary argument");
});

const marker = { kind: "path", path: "marker" };
const scalar = value => ({ kind: "int-literal", text: String(value) });
const readMarker = { kind: "expr", expr: marker };
const exit = { kind: "return", expr: { kind: "bool-literal", value: true } };
const overwriteMarker = { kind: "assign", operator: "=", target: marker, value: scalar(11) };
const conditionStore = { kind: "assign", operator: "=", target: marker,
  value: { kind: "call", path: "step", args: [] } };
const storeValue = { kind: "block", body: { statements: [conditionStore, { kind: "tail", expr: scalar(7) }] } };

function conditionProgram(condition, thenStatements, elseStatements, following = []) {
  return { statements: [
    { kind: "let", name: "marker", mutable: true, type: { kind: "named", path: "i32" }, init: scalar(0) },
    { kind: "if", condition, then: { statements: thenStatements },
      ...(elseStatements === undefined ? {} : { else: { statements: elseStatements } }) },
    ...following,
  ] };
}

function checkConditionStore(source, selectStore, dead, label) {
  const normalized = finalizeRustBlockLiveness(source);
  const selected = selectStore(normalized.statements[1].condition);
  assert.equal(selected.kind, dead ? "scope" : "assign", `${label}: exact incoming store liveness`);
  const write = dead ? selected.body.statements[0] : selected;
  assert.equal(write.kind === "assign" && write.operator === "=" && write.target.path === "marker", true,
    `${label}: the same native destination and store remain`);
  assert.equal(JSON.stringify(write.value) === JSON.stringify(conditionStore.value), true,
    `${label}: the effectful RHS is unchanged`);
  if (dead) assert.equal(selected.body.innerAttrs.length === 1 &&
    selected.body.innerAttrs[0] === rustLintAttributes.unusedAssignmentsInner, true,
  `${label}: only the established exact unused-write expectation is applied`);
  assert.equal(JSON.stringify(finalizeRustBlockLiveness(normalized)) === JSON.stringify(normalized), true,
    `${label}: normalization is idempotent`);
}

const storeComparison = { kind: "binary", operator: ">", left: storeValue, right: scalar(0) };
const comparisonStore = condition => condition.left.body.statements[0];

for (const [name, thenStatements, elseStatements, following, dead] of [
  ["then reads the incoming value", [readMarker, exit], [exit], [], false],
  ["else reads the incoming value", [exit], [readMarker, exit], [], false],
  ["an absent else reaches an after-if read", [], undefined, [readMarker, exit], false],
  ["both alternatives overwrite before reading", [overwriteMarker, readMarker, exit],
    [overwriteMarker, readMarker, exit], [], true],
  ["one overwrite does not hide the other alternative's read", [overwriteMarker, readMarker, exit],
    [readMarker, exit], [], false],
  ["a read before overwrite observes the incoming version", [readMarker, overwriteMarker, exit], [exit], [], false],
  ["exiting alternatives do not reach an after-if read", [exit], [exit], [readMarker], true],
  ["branch-local shadows do not hide the later outer read",
    [{ kind: "let", name: "marker", mutable: false, init: scalar(1) }, readMarker],
    [{ kind: "let", name: "marker", mutable: false, init: scalar(2) }, readMarker], [readMarker, exit], false],
]) {
  test(`condition assignment liveness: ${name}`, () => {
    checkConditionStore(conditionProgram(storeComparison, thenStatements, elseStatements, following),
      comparisonStore, dead, name);
  });
}

test("condition assignment liveness excludes earlier operands and retains later operands", () => {
  for (const [earlier, dead] of [[true, true], [false, false]]) {
    const condition = { kind: "binary", operator: "+", left: earlier ? marker : storeValue,
      right: earlier ? storeValue : marker };
    checkConditionStore(conditionProgram(condition, [exit], [exit]),
      selected => (earlier ? selected.right : selected.left).body.statements[0], dead,
      earlier ? "earlier operand" : "later operand");
  }
});

test("condition assignment liveness treats conditional arms as alternatives", () => {
  for (const [reads, dead] of [[true, false], [false, true]]) {
    const condition = { kind: "conditional", condition: storeComparison,
      whenTrue: reads ? marker : { kind: "block", body: { statements: [overwriteMarker, { kind: "tail", expr: scalar(1) }] } },
      whenFalse: { kind: "block", body: { statements: [overwriteMarker, { kind: "tail", expr: scalar(2) }] } } };
    checkConditionStore(conditionProgram(condition, [exit], [exit]),
      selected => comparisonStore(selected.condition), dead, `conditional ${reads ? "read" : "overwrite"}`);
  }
});

test("condition assignment liveness never replays a match scrutinee after its selected arm", () => {
  const condition = { kind: "match", expression: marker, arms: [
    { pattern: { kind: "path", path: "None" }, expression: storeValue },
    { pattern: { kind: "wildcard" }, expression: scalar(0) },
  ] };
  for (const [reads, dead] of [[true, false], [false, true]]) {
    checkConditionStore(conditionProgram(condition, reads ? [readMarker, exit] : [overwriteMarker, readMarker, exit],
      [overwriteMarker, readMarker, exit]), selected => selected.arms[0].expression.body.statements[0], dead,
    `match ${reads ? "live branch" : "overwritten branch"}`);
  }
});

test("condition assignment liveness distinguishes a block-value tail from a function return", () => {
  checkConditionStore(conditionProgram(storeComparison, [readMarker, exit], [exit]), comparisonStore, false,
    "block-value tail reaches its branch");
  const returned = { kind: "binary", operator: ">", left: { kind: "block", body: { statements: [
    conditionStore, { kind: "return", expr: scalar(7) },
  ] } }, right: scalar(0) };
  checkConditionStore(conditionProgram(returned, [readMarker, exit], [readMarker, exit]), comparisonStore, true,
    "a real return prevents later branch observation");
});
