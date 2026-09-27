import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { rustPatternBindings, rustPatternBindsName } from "../../../dist/backend/target-ast/patterns.js";
import { rustBlockReferencesPath } from "../../../dist/backend/target-ast/inspection/source-usage.js";
import { firstAccessesInStatements, firstDirectPathAccessInStatements, maxWritesInStatements } from "../../../dist/backend/target-ast/inspection/source-dataflow.js";
import { finalizeRustBlockLiveness } from "../../../dist/backend/target-ast/inspection/source-liveness.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { rustLintAttributes } from "../../../dist/backend/target-ast/normalization/lint-policy.js";
import { applyFallibleShape } from "../../../dist/backend/planner/types/fallible-shape.js";
import { printRustBlockStatements } from "../../../dist/print/source/blocks.js";

const path = name => ({ kind: "path", path: name });
const binding = (name, mutable = false) => ({ kind: "binding", name, mutable });
const patternMacro = delimiter => ({ kind: "macro-invocation", path: "patterns::selected", input: { delimiter, tokens: [] } });
const empty = { statements: [] };
const expression = value => ({ kind: "expr", expr: value });
const assign = (name, value = { kind: "int-literal", text: "1" }) => ({ kind: "assign", target: path(name), operator: "=", value });
const returning = name => ({ statements: [{ kind: "return", expr: path(name) }] });
const fn = statements => ({ kind: "function", name: "selected", visibility: "public", generics: emptyRustGenerics,
  params: [], body: { statements } });
const render = statement => printRustBlockStatements({ statements: [statement] }, 0);

test("one pattern model occupies let, let-else, for, if-let and while-let", () => {
  for (const [delimiter, tokens] of [["parentheses", "()"], ["brackets", "[]"], ["braces", "{}"]]) {
    const pattern = patternMacro(delimiter);
    const printed = `patterns::selected!${tokens}`;
    assert.equal(render({ kind: "let", pattern, init: path("input") }), `let ${printed} = input;`);
    assert.equal(render({ kind: "let", pattern, init: path("input"), else: empty }), `let ${printed} = input else {};`);
    assert.equal(render({ kind: "for", pattern, iterable: path("input"), body: empty, label: "selected" }),
      `'selected: for ${printed} in input {}`);
    assert.equal(render({ kind: "while-let", pattern, expression: path("input"), body: empty, label: "selected" }),
      `'selected: while let ${printed} = input {}`);
    assert.equal(render({ kind: "if-let", pattern, expression: path("input"), body: empty, else: empty }),
      `if let ${printed} = input {} else {}`);
  }
  const pattern = { kind: "tuple", elements: [binding("first", true), { kind: "reference", mutable: false, pattern: binding("second") }] };
  assert.equal(render({ kind: "let", pattern, init: path("input") }), "let (mut first, &second) = input;");
  const alternate = { kind: "or", alternatives: [path("First"), path("Second")] };
  assert.equal(render({ kind: "let", pattern: alternate, init: path("input") }), "let (First | Second) = input;");
  assert.equal(render({ kind: "for", pattern: alternate, iterable: path("input"), body: empty }), "for (First | Second) in input {}");
  assert.equal(render({ kind: "if-let", pattern: alternate, expression: path("input"), body: empty }), "if let First | Second = input {}");
});

test("let-else groups only grammar-restricted initializer spellings", () => {
  for (const [init, expected] of [
    [path("input"), "input"],
    [{ kind: "call", path: "select", args: [] }, "select()"],
    [{ kind: "str-literal", value: "}" }, '"}"'],
    [{ kind: "macro-invocation", path: "selected", input: { delimiter: "braces", tokens: [] } }, "(selected!{})"],
    [{ kind: "block", bindings: [], value: path("input") }, "({ input })"],
    [{ kind: "closure-block", params: [], move: false, async: false, body: empty }, "(|| {})"],
    [{ kind: "binary", left: path("left"), operator: "&&", right: path("right") }, "(left && right)"],
    [{ kind: "binary", left: path("left"), operator: "||", right: path("right") }, "(left || right)"],
    [{ kind: "binary", left: path("left"), operator: "+", right: path("right") }, "left + right"],
  ]) {
    for (const initializer of [init, { kind: "bottom", expression: init }]) {
      assert.equal(render({ kind: "let", pattern: binding("value"), init: initializer, else: returning("fallback") }),
        `let value = ${expected} else {\n    return fallback;\n};`);
    }
  }
});

test("all statement positions retain pattern dependencies and let-else failure dependencies", () => {
  const pattern = patternMacro("parentheses");
  for (const statement of [
    { kind: "let", pattern, init: path("input") },
    { kind: "for", pattern, iterable: path("input"), body: empty },
    { kind: "if-let", pattern, expression: path("input"), body: empty },
    { kind: "while-let", pattern, expression: path("input"), body: empty },
  ]) {
    assert.equal(rustItemsReferenceModuleAlias([fn([statement])], "patterns"), true);
    assert.equal(rustItemsReferenceModuleAlias([fn([statement])], "unrelated"), false);
  }
  assert.equal(rustItemsReferenceModuleAlias([fn([{ kind: "let", pattern: binding("value"), init: path("input"),
    else: returning("failures::VALUE") }])], "failures"), true);
});

test("pattern scopes exclude bound bodies but retain initializer, failure and later outer accesses", () => {
  const pattern = { kind: "tuple", elements: [binding("value"), binding("other")] };
  const body = { statements: [expression(path("value")), assign("value")] };
  assert.equal(rustPatternBindsName(pattern, "value"), true);
  assert.equal(rustPatternBindsName(pattern, "outer"), false);
  const declaration = { kind: "let", pattern, init: path("input") };
  assert.equal(rustBlockReferencesPath({ statements: [declaration, ...body.statements] }, "value"), false);
  assert.equal(maxWritesInStatements([declaration, ...body.statements], "value"), 0);
  assert.deepEqual([...firstAccessesInStatements([declaration, ...body.statements], "value")], ["exit"]);
  const failing = { ...declaration, else: { statements: [assign("value"), { kind: "return", expr: path("value") }] } };
  assert.equal(rustBlockReferencesPath({ statements: [failing] }, "value"), true);
  assert.equal(maxWritesInStatements([failing, ...body.statements], "value"), 1);
  assert.deepEqual([...firstAccessesInStatements([failing], "value")].sort(), ["exit", "write"]);
  assert.equal(firstDirectPathAccessInStatements([failing], "value"), "read");
  assert.equal(rustBlockReferencesPath({ statements: [{ ...declaration, init: path("value") }] }, "value"), true);
  for (const statement of [
    { kind: "for", pattern, iterable: path("input"), body },
    { kind: "while-let", pattern, expression: path("input"), body },
    { kind: "if-let", pattern, expression: path("input"), body },
  ]) {
    assert.equal(rustBlockReferencesPath({ statements: [statement] }, "value"), false);
    assert.equal(maxWritesInStatements([statement], "value"), 0);
    assert.equal(rustBlockReferencesPath({ statements: [statement, expression(path("value"))] }, "value"), true);
  }
  const conditional = { kind: "if-let", pattern, expression: path("input"), body, else: body };
  assert.equal(rustBlockReferencesPath({ statements: [conditional] }, "value"), true);
  assert.equal(maxWritesInStatements([conditional], "value"), 1);
});

test("unknown macro bindings never authorize liveness or write elimination", () => {
  const pattern = patternMacro("brackets");
  assert.equal(rustPatternBindings(pattern), undefined);
  assert.equal(rustPatternBindsName(pattern, "value"), undefined);
  for (const statement of [
    { kind: "let", pattern, init: path("input") },
    { kind: "for", pattern, iterable: path("input"), body: empty },
    { kind: "if-let", pattern, expression: path("input"), body: empty },
    { kind: "while-let", pattern, expression: path("input"), body: empty },
  ]) {
    assert.equal(rustBlockReferencesPath({ statements: [statement] }, "value"), true);
    assert.equal(maxWritesInStatements([statement], "value"), 2);
    assert.ok(firstAccessesInStatements([statement], "value").has("read"));
  }
});

test("liveness preserves destructuring binding modes and never folds away let-else failure", () => {
  const pattern = { kind: "tuple-variant", path: "Some", elements: [binding("value", true)] };
  const failure = returning("fallback");
  const statements = [{ kind: "let", pattern, init: path("input"), else: failure }, { kind: "return", expr: path("value") }];
  const result = finalizeRustBlockLiveness({ statements });
  assert.equal(result.statements.length, 2);
  assert.deepEqual(result.statements[0].pattern, pattern);
  assert.deepEqual(result.statements[0].else, failure);
  const normal = finalizeRustBlockLiveness({ statements: [{ kind: "let", pattern: binding("value", true), init: path("input") },
    expression(path("value"))] });
  assert.equal(normal.statements[0].pattern.mutable, false);
  const late = finalizeRustBlockLiveness({ statements: [{ kind: "let", pattern: binding("value", true) },
    { kind: "let", pattern: { kind: "tuple", elements: [binding("value")] }, init: path("input") }, assign("value")] });
  assert.equal(late.statements.length, 3);
});

test("pattern names remain unchanged and let-else returns use the existing fallible boundary", () => {
  const pattern = { kind: "tuple-variant", path: "Some", elements: [binding("keptName")] };
  const source = [{ kind: "let", pattern, init: path("input"), else: returning("fallback") },
    { kind: "return", expr: path("keptName") }];
  const styled = finalizeRustSourceStyle({ headerComment: "fixture", items: [fn(source)] });
  assert.deepEqual(styled.items[0].body.statements[0].pattern, pattern);
  assert.ok(styled.items[0].body.innerAttrs.includes(rustLintAttributes.nonSnakeCaseName));
  const wrapped = applyFallibleShape({ statements: source }, { fallible: true, hasReturnValue: true,
    errorType: { kind: "named", path: "Failure" }, inferErrorTypeFromReturnType: true });
  assert.equal(wrapped.statements[0].else.statements[0].expr.path, "Ok");
  assert.equal(wrapped.statements[0].else.statements[0].expr.args[0].path, "fallback");
  assert.equal(wrapped.statements[1].expr.path, "Ok");
});
