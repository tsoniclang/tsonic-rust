import assert from "node:assert/strict";
import test from "node:test";
import { closeRustCompletionBindings } from "../../../../dist/backend/target-ast/normalization/completion-bindings.js";
import { lowerRustCompletionScope } from "../../../../dist/backend/target-ast/normalization/completion-regions.js";
import { printRustBlockStatements } from "../../../../dist/print/source/blocks.js";

const path = name => ({ kind: "path", path: name });
const declaration = name => ({ kind: "let", name, mutable: true, type: { kind: "string" } });
const write = name => ({ kind: "assign", operator: "=", target: path(name), value: { kind: "call", path: "produce", args: [] } });
const read = name => ({ kind: "expr", expr: { kind: "call", path: "observe", args: [path(name)] } });
const region = overrides => ({ kind: "try-scope", bodyName: "body_flow", flowName: "flow",
  returnType: { kind: "string" }, fallible: true, asynchronous: false,
  body: { statements: [write("selected")] }, bodyFallible: true, bodyTerminates: false,
  catchClause: { binding: "error", fallible: false, terminates: true,
    body: { statements: [{ kind: "completion-exit", completion: "return", resultWrapped: false,
      expr: { kind: "string-literal", value: "caught" } }] } },
  propagate: false, dispatchReturn: true, dispatchTargets: [], terminates: false, ...overrides });

test("normal completion owns definite locals and exposes native moved outputs", () => {
  const original = { statements: [declaration("selected"), declaration("second"),
    region({ body: { statements: [write("selected"), write("second")] } }), read("selected"), read("second")] };
  const closed = closeRustCompletionBindings(original);
  assert.equal(original.statements.length, 5);
  assert.equal(closed.statements[0].kind, "try-scope");
  assert.deepEqual(closed.statements[0].normalBindings.map(binding => binding.name), ["selected", "second"]);
  assert.equal(closed.statements[1].init.name, "0");
  assert.equal(closed.statements[2].init.name, "1");
  assert.equal(closed.statements[1].type === original.statements[0].type, true);
  assert.equal(closeRustCompletionBindings(closed) === closed, true);
  for (const asynchronous of [false, true]) {
    const lowered = lowerRustCompletionScope({ ...closed.statements[0], asynchronous });
    const text = printRustBlockStatements({ statements: [lowered, ...closed.statements.slice(1)] }, 0);
    assert.match(text, /Completion<String, \(String, String\)>/u);
    assert.match(text, /Completion::Normal\(\(selected, second\)\)/u);
    assert.match(text, /Completion::Normal\(normal\) => normal/u);
    assert.match(text, /let mut selected: String = flow\.0;/u);
    assert.doesNotMatch(text, /MaybeUninit|assume_init|unsafe|\.clone\(|Option|Default|RefCell|Box/u);
  }
});

test("all normal branches initialize while abrupt paths need no fabricated value", () => {
  const conditional = { kind: "if", condition: path("choose"), then: { statements: [write("selected")] },
    else: { statements: [{ kind: "completion-exit", completion: "return", resultWrapped: true,
      expr: { kind: "string-literal", value: "early" } }] } };
  const target = region({ body: { statements: [conditional] }, catchClause: {
    binding: "error", fallible: false, terminates: false, body: { statements: [write("selected")] } } });
  const closed = closeRustCompletionBindings({ statements: [declaration("selected"), target, read("selected")] });
  assert.equal(closed.statements[0].kind, "try-scope");
  assert.deepEqual(closed.statements[0].normalBindings.map(binding => binding.name), ["selected"]);
});

test("unproven writes, pre-initialization reads and intervening uses are not relocated", () => {
  const candidates = [
    region({ body: { statements: [read("selected"), write("selected")] } }),
    region({ body: { statements: [{ kind: "if", condition: path("choose"), then: { statements: [write("selected")] } }] } }),
    region({ catchClause: { binding: "error", fallible: false, terminates: false, body: { statements: [] } } }),
    region({ body: { statements: [{ ...write("selected"), value: path("selected") }] } }),
    region({ finallyClause: { body: { statements: [read("selected")] }, fallible: false, terminates: false }, finallyName: "finally_flow" }),
  ];
  for (const [index, target] of candidates.entries()) {
    const block = { statements: [declaration("selected"), target, read("selected")] };
    assert.equal(closeRustCompletionBindings(block) === block, true, `unproved case ${index}`);
  }
  const block = { statements: [declaration("selected"), read("selected"), region()] };
  assert.equal(closeRustCompletionBindings(block) === block, true);
});

test("a closure or shadow declaration cannot prove an outer initialization", () => {
  for (const body of [
    { statements: [{ kind: "let", name: "callback", mutable: false, init: { kind: "closure-block", params: [], move: false,
      async: false, body: { statements: [write("selected")] } } }] },
    { statements: [{ ...declaration("selected"), init: { kind: "string-literal", value: "shadow" } }, write("selected")] },
  ]) {
    const block = { statements: [declaration("selected"), region({ body }), read("selected")] };
    assert.equal(closeRustCompletionBindings(block) === block, true);
  }
});

test("nested completion outputs are closed after binding declarations enter their owner", () => {
  const inner = region({ bodyName: "inner_body", flowName: "inner_flow", propagate: true });
  const outer = region({ body: { statements: [inner] }, catchClause: undefined, bodyFallible: false });
  const closed = closeRustCompletionBindings({ statements: [declaration("selected"), outer, read("selected")] });
  assert.equal(closed.statements[0].kind, "try-scope");
  const text = printRustBlockStatements({ statements: [lowerRustCompletionScope(closed.statements[0])] }, 0);
  assert.match(text, /Completion::Normal\(\(selected,\)\)/u);
  assert.match(text, /let mut selected: String = inner_flow\.0;/u);
  assert.match(text, /Completion::Return\(value\) => break 'body_flow Ok\(rt::Completion::Return\(value\)\)/u);
});
