import assert from "node:assert/strict";
import test from "node:test";
import { rustExpressionChildren } from "../../../../dist/backend/target-ast/inspection/expression-children.js";
import { rustExpressionMayExitCallable } from "../../../../dist/backend/target-ast/inspection/callable-exits.js";
import { rustExpressionReferencesPath, rustStatementsReferencePath } from "../../../../dist/backend/target-ast/inspection/source-usage.js";
import { firstAccessesInStatements, firstDirectPathAccessInStatements, maxWritesInStatements } from "../../../../dist/backend/target-ast/inspection/source-dataflow.js";
import { finalizeRustBlockLiveness } from "../../../../dist/backend/target-ast/inspection/source-liveness.js";
import { rustPlannedImplementationsReferenceSelfField } from "../../../../dist/backend/planner/liveness/planned-item-usage.js";
import { printRustBlockStatements } from "../../../../dist/print/source/blocks.js";
import { formatRustCompileOutput } from "../../../../dist/backend/emission/rustfmt.js";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

const path = name => ({ kind: "path", path: name });
const integer = text => ({ kind: "int-literal", text });
const invocation = (tokens = []) => ({ kind: "macro-invocation", path: "native_effect", input: { delimiter: "parentheses", tokens } });
const binding = (name, init) => ({ kind: "let", pattern: { kind: "binding", name, mutable: true }, ...(init === undefined ? {} : { init }) });
const statement = expr => ({ kind: "expr", expr });

for (const [name, tokens] of [
  ["empty", []],
  ["raw", [{ kind: "identifier", text: "ignored", raw: false }]],
  ["structured", [{ kind: "fragment", fragment: { kind: "expression", expression: path("input") } }]],
]) {
  test(`unexpanded ${name} macro syntax is not execution evidence`, () => {
    const expression = invocation(tokens);
    const statements = [statement(expression)];
    assert.equal(rustExpressionReferencesPath(expression, "unmentioned"), true);
    assert.equal(maxWritesInStatements(statements, "unmentioned"), 2);
    assert.deepEqual(new Set(firstAccessesInStatements(statements, "unmentioned")), new Set(["none", "read", "write", "exit"]));
    assert.equal(firstDirectPathAccessInStatements(statements, "unmentioned"), "read");
    assert.equal(rustExpressionMayExitCallable(expression), true);
    assert.equal(rustExpressionChildren(expression).length, name === "structured" ? 1 : 0);
  });
}

test("macro hygiene can retain an outer binding through same-spelling shadowing", () => {
  const macro = invocation();
  const shadow = binding("outer", integer("1"));
  const examples = [
    [shadow, statement(macro)],
    [statement({ kind: "closure", params: [{ pattern: shadow.pattern }], body: macro })],
    [statement({ kind: "closure-block", params: [{ pattern: shadow.pattern }], move: false, async: false, body: { statements: [statement(macro)] } })],
    [statement({ kind: "block", bindings: [{ name: "outer", value: integer("1") }], value: macro })],
    [{ kind: "if-let", pattern: shadow.pattern, expression: path("input"), body: { statements: [statement(macro)] } }],
    [{ kind: "for", pattern: shadow.pattern, iterable: path("input"), body: { statements: [statement(macro)] } }],
    [{ kind: "item", item: macro }],
    [{ kind: "macro-statement", invocation: macro, semicolon: true }],
  ];
  for (const statements of examples) {
    assert.equal(rustStatementsReferencePath(statements, "outer"), true);
    assert.equal(maxWritesInStatements(statements, "outer"), 2);
    const result = finalizeRustBlockLiveness({ statements: [binding("outer", integer("0")), ...statements] });
    assert.equal(result.statements[0].pattern.mutable, true);
    assert.equal(result.statements[0].attrs, undefined);
  }
});

test("ordinary shadowing remains precise and unnecessary mutability is removed", () => {
  const statements = [binding("outer", integer("1")), statement(path("outer"))];
  assert.equal(rustStatementsReferencePath(statements, "outer"), false);
  assert.equal(maxWritesInStatements(statements, "outer"), 0);
  const result = finalizeRustBlockLiveness({ statements: [binding("value", integer("2")), statement(path("value"))] });
  assert.equal(result.statements[0].pattern.mutable, false);
  assert.equal(result.statements[0].attrs, undefined);
  const closure = { kind: "closure", params: [{ pattern: { kind: "binding", name: "outer" } }], body: path("outer") };
  assert.equal(rustExpressionReferencesPath(closure, "outer"), false);
  assert.equal(maxWritesInStatements([statement(closure)], "outer"), 0);
});

test("late initialization cannot move across a macro expansion", () => {
  const statements = [
    binding("output"),
    statement(invocation()),
    { kind: "assign", target: path("output"), operator: "=", value: integer("3") },
    { kind: "tail", expr: path("output") },
  ];
  const result = finalizeRustBlockLiveness({ statements });
  assert.equal(result.statements.length, 4);
  assert.equal(result.statements[0].init, undefined);
  assert.equal(result.statements[0].pattern.mutable, true);
  assert.equal(result.statements[1], statements[1]);
  const ordinary = finalizeRustBlockLiveness({ statements: [statements[0], statements[2], statement(path("output"))] });
  assert.equal(ordinary.statements.length, 2);
  assert.deepEqual(ordinary.statements[0].init, integer("3"));
  assert.equal(ordinary.statements[0].pattern.mutable, false);
});

test("only genuine authored closures contain macro return effects", () => {
  const macro = invocation();
  assert.equal(rustExpressionMayExitCallable({ kind: "call", path: "consume", args: [macro] }), true);
  assert.equal(rustExpressionMayExitCallable({ kind: "block", bindings: [], value: macro }), true);
  assert.equal(rustExpressionMayExitCallable({ kind: "closure", params: [], body: macro }), false);
  assert.equal(rustExpressionMayExitCallable({ kind: "closure-block", params: [], move: false, async: false, body: { statements: [statement(macro)] } }), false);
  assert.equal(rustExpressionMayExitCallable({ kind: "call", path: "consume", args: [integer("3")] }), false);
});

test("macro patterns and impl members cannot erase unknown self-field dependencies", () => {
  const query = members => rustPlannedImplementationsReferenceSelfField([{ kind: "impl", members }], "state");
  assert.equal(query([invocation()]), true);
  for (const expression of [
    invocation(),
    { kind: "matches", expression: path("input"), pattern: invocation() },
    { kind: "match", expression: path("input"), arms: [{ pattern: invocation(), expression: integer("1") }] },
  ]) {
    assert.equal(query([{ kind: "function", body: { statements: [statement(expression)] } }]), true);
  }
  assert.equal(query([{ kind: "function", body: { statements: [statement(integer("1"))] } }]), false);
  assert.equal(query([{ kind: "function", body: { statements: [statement({ kind: "field", receiver: path("self"), name: "state" })] } }]), true);
});

test("native execution preserves macro-only mutation, hygienic capture and early return", () => {
  const macro = invocation();
  const mutation = printRustBlockStatements(finalizeRustBlockLiveness({ statements: [
    statement(macro), { kind: "tail", expr: path("outer") },
  ] }), 1);
  const capture = { kind: "closure", params: [{ pattern: { kind: "binding", name: "outer" } }], body: {
    kind: "binary", operator: "+", left: path("outer"), right: macro,
  } };
  const captureBody = printRustBlockStatements(finalizeRustBlockLiveness({ statements: [
    binding("read", capture),
    { kind: "tail", expr: { kind: "invoke", callee: path("read"), args: [integer("10")] } },
  ] }), 1);
  const artifact = { path: "src/main.rs", text: `
fn mutate() -> i32 {
    let mut outer = 1;
    macro_rules! native_effect { () => { outer += 2 }; }
${mutation}
}
fn capture() -> i32 {
    let outer = 4;
    macro_rules! native_effect { () => { outer }; }
${captureBody}
}
fn early() -> i32 {
    macro_rules! native_effect { () => { return 7 }; }
${printRustBlockStatements({ statements: [{ kind: "tail", expr: macro }] }, 1)}
}
fn main() {
    assert_eq!(mutate(), 3);
    assert_eq!(capture(), 14);
    assert_eq!(early(), 7);
}
`, kind: "source" };
  const formatted = formatRustCompileOutput({ artifacts: [artifact] }, "2024");
  validateGeneratedProject("opaque-macro-inspection", [
    { path: "Cargo.toml", text: '[package]\nname = "opaque_macro_inspection"\nversion = "0.1.0"\nedition = "2024"\n' },
    ...formatted.artifacts,
  ], { run: true });
});
