import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTestWorkspace } from "../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../helpers/rust-session/paths.mjs";
import { readRustSourceMacroInput } from "../../../dist/source/semantics/macro-input.js";
import { createRustNativeSourceTool } from "../../../dist/providers/native/elaboration/tool.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-source-macro-input-");
let nativeTool;
const core = ["Object", "Function", "CallableFunction", "NewableFunction", "IArguments", "String", "Number", "Boolean", "RegExp"]
  .map(name => `interface ${name} {}`).join("\n") + "\ninterface Array<T> { [index:number]:T; length:number; }";

function syntax(expression, { quotation = false, tokenize } = {}) {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: { "/src/core.d.ts": core, "/src/index.ts": expression },
    compilerOptions: { noLib: true, module: "esnext", target: "esnext" },
  });
  assert.deepEqual(session.getDiagnostics("syntactic"), []);
  const checked = session.checkSource();
  const ast = checked.ast;
  const nodes = [];
  const visit = node => {
    if (node === undefined) return;
    nodes.push(node);
    ast.forEachChild(node, visit);
  };
  visit(checked.getSourceFile("/src/index.ts"));
  const call = nodes.find(ast.is.IsCallExpression);
  assert.ok(call);
  const tags = new Set(quotation ? nodes.filter(ast.is.IsTaggedTemplateExpression)
    .map(node => ast.as.AsTaggedTemplateExpression(node).Tag) : []);
  const fragments = [];
  const result = readRustSourceMacroInput(call, {
    ast,
    fragment(node) { fragments.push(node); return node; },
    isTokenQuotation: tag => tags.has(tag),
    tokenize: tokenize ?? (source => {
      nativeTool ??= createRustNativeSourceTool({ cacheRoot: join(root, "native-cache") });
      return nativeTool.tokens(source, "2024");
    }),
  });
  return { result, ast, call, nodes, fragments };
}

function available(value) {
  assert.equal(value.result.kind, "available", value.result.reason);
  assert.ok(Object.isFrozen(value.result));
  assert.ok(Object.isFrozen(value.result.input));
  assert.ok(Object.isFrozen(value.result.input.tokens));
  return value.result.input;
}

test("direct macro input preserves parentheses, trailing commas and source identity", () => {
  for (const [source, punctuation] of [["arbitrary()", []], ["arbitrary(first)", []],
    ["arbitrary(first, second)", [","]], ["arbitrary(first, second,)", [",", ","]]]) {
    const value = syntax(source, { tokenize: () => assert.fail("Direct input must not invoke the tokenizer.") });
    const input = available(value);
    assert.equal(input.delimiter, "parentheses");
    assert.deepEqual(input.tokens.filter(token => token.kind === "punctuation").map(token => token.text), punctuation);
    const expressions = input.tokens.filter(token => token.kind === "fragment").map(token => token.fragment);
    assert.deepEqual(expressions, value.ast.arguments(value.call));
    for (const [index, expression] of expressions.entries()) assert.equal(expression, value.fragments[index]);
  }
});

test("array envelopes are generic bracket syntax, including empty and omitted tokens", () => {
  for (const [source, expected] of [["unrelated([])", []], ["unrelated([first])", ["fragment"]],
    ["unrelated([first, second,])", ["fragment", ",", "fragment", ","]],
    ["unrelated([,])", [","]], ["unrelated([first,,])", ["fragment", ",", ","]]]) {
    const value = syntax(source, { tokenize: () => assert.fail("An envelope is not raw source text.") });
    const input = available(value);
    assert.equal(input.delimiter, "brackets");
    assert.deepEqual(input.tokens.map(token => token.kind === "punctuation" ? token.text : token.kind), expected);
    const envelope = value.ast.arguments(value.call)[0];
    assert.ok(!value.fragments.includes(envelope));
  }
  const grouped = syntax("unrelated(([first, second]))");
  assert.equal(available(grouped).delimiter, "parentheses");
  assert.equal(grouped.fragments.length, 1);
  assert.equal(grouped.ast.kindName(grouped.fragments[0]), "KindParenthesizedExpression");
});

test("ordinary callbacks, calls and tagged expressions remain exact source fragments", () => {
  const value = syntax("unrelated(() => consume(value), quoted`body`, next())", {
    tokenize: () => assert.fail("An ordinary tag is not the native quotation declaration."),
  });
  const input = available(value);
  assert.deepEqual(input.tokens.filter(token => token.kind === "fragment").map(token => value.ast.kindName(token.fragment)),
    ["KindArrowFunction", "KindTaggedTemplateExpression", "KindCallExpression"]);
  assert.equal(value.fragments.length, 3);
});

test("exact quotation uses native delimiters and retains each original splice", () => {
  for (const [source, delimiter] of [
    ["emit(renamed`[${first}; ${count}]`)", "brackets"],
    ["emit(namespace.tokens`{ GET \"/\" => ${handler}; }`)", "braces"],
    ["emit(renamed`(${value},)`)", "parentheses"],
    ["emit(renamed`${value}; ${count}`)", "parentheses"],
    ["emit(renamed``)", "parentheses"],
  ]) {
    const value = syntax(source, { quotation: true });
    const input = available(value);
    assert.equal(input.delimiter, delimiter);
    const tokens = input.tokens.filter(token => token.kind === "fragment");
    assert.equal(tokens.length, value.fragments.length);
    for (const [index, token] of tokens.entries()) assert.equal(token.fragment, value.fragments[index]);
  }
});

test("quotation preserves Rust literal spelling after ordinary TypeScript escaping", () => {
  const value = syntax("emit(quote`(b\"\\\\xff\", r##\"😀\"##, 'scope, r#type, 9007199254740993_u64)`)", { quotation: true });
  const input = available(value);
  const literals = input.tokens.filter(token => token.kind === "literal").map(token => token.text);
  assert.deepEqual(literals, ['b"\\xff"', 'r##"😀"##', "9007199254740993_u64"]);
  assert.ok(input.tokens.some(token => token.kind === "punctuation" && token.text === "'" && token.joint));
  assert.ok(input.tokens.some(token => token.kind === "identifier" && token.text === "type" && token.raw));
});

test("quotation splices inside literals, comments or compound identifiers reject", () => {
  for (const source of ['emit(quote`"${value}"`)', "emit(quote`/* ${value} */`)", "emit(quote`prefix${value}`)"]) {
    const value = syntax(source, { quotation: true });
    assert.equal(value.result.kind, "rejected");
    assert.match(value.result.reason, /source fragment/u);
  }
});

test("native-only input constraints reject without a normal-call workaround", () => {
  for (const source of ["emit?.(first)", "emit<number>(first)", "emit(quote`first`, second)", "emit(quote<number>`first`)", "emit(quote`\\x`)"]) {
    const value = syntax(source, { quotation: true,
      tokenize: () => assert.fail("Invalid source input must reject before native lexing.") });
    assert.equal(value.result.kind, "rejected");
    assert.ok(value.nodes.includes(value.result.subject));
    assert.notEqual(value.result.reason.length, 0);
  }
});

test("native tokenizer failure propagates rather than manufacturing an input", () => {
  const failure = new Error("native lexical failure");
  assert.throws(() => syntax("emit(quote`[]`)", { quotation: true, tokenize() { throw failure; } }),
    error => error === failure);
});
