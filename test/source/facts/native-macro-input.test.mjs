import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createCompilerSessionFromFiles, createSourceProgramQueries } from "@tsonic/tsts";
import { createSourceSemanticsVirtualModuleProvider } from "@tsonic/source-core/extension";
import { createTestWorkspace } from "../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../helpers/rust-session/paths.mjs";
import { readRustSourceMacroInput } from "../../../dist/source/semantics/macro-input.js";
import { createRustNativeSourceTool } from "../../../dist/providers/native/elaboration/tool.js";
import { rustSyntaxIntrinsicDeclarations } from "../../../dist/source/semantics/declarations/syntax.js";
import { isRustTokenQuotationDeclaration } from "../../../dist/source/semantics/syntax-intrinsics.js";
import { rustLangModule, rustSourceProviderVersion, rustSourceSemanticsExtensionId,
  rustSourceVirtualModulesProviderId } from "../../../dist/source/semantics/identity.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-source-macro-input-");
let nativeTool;
const core = ["Object", "Function", "CallableFunction", "NewableFunction", "IArguments", "String", "Number", "Boolean", "RegExp"]
  .map(name => `interface ${name} {}`).join("\n") + "\ninterface Array<T> { [index:number]:T; length:number; }";

function syntax(expression, { quotation = false, tokenize } = {}) {
  const imports = quotation ? `import { tokens as quote, tokens as renamed } from "${rustLangModule}";
import * as namespace from "${rustLangModule}";
` : "";
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: { "/src/core.d.ts": core, "/src/index.ts": imports + expression },
    compilerOptions: { noLib: true, module: "esnext", target: "esnext" },
    extensionHostOptions: { extensions: [{
      identity: { id: rustSourceSemanticsExtensionId, version: rustSourceProviderVersion },
      initialize(context) {
        context.registerSourceDeclarationProvider(createSourceSemanticsVirtualModuleProvider({
          id: rustSourceVirtualModulesProviderId,
          version: rustSourceProviderVersion,
          displayName: "Rust syntax declarations",
          virtualDirectory: "rust-source",
          modules: [{ moduleSpecifier: rustLangModule, packageName: "@tsonic/rust", subpath: "lang.js", exports: [] }],
          exportsForModule: rustSyntaxIntrinsicDeclarations,
          evidenceMessage: "Rust syntax declaration identity under test.",
        }));
      },
    }] },
  });
  assert.deepEqual(session.getDiagnostics("syntactic"), []);
  session.ensureBound();
  const source = createSourceProgramQueries(session.program);
  const ast = source.ast;
  const file = source.getSourceFile("/src/index.ts");
  const queries = source.getSourceFileQueries(file);
  const nodes = [];
  const visit = node => {
    if (node === undefined) return;
    nodes.push(node);
    ast.forEachChild(node, visit);
  };
  visit(file);
  const call = nodes.find(node => ast.is.IsCallExpression(node) || ast.is.IsTaggedTemplateExpression(node));
  assert.ok(call);
  const fragments = [];
  const selectedIntrinsics = [];
  const result = readRustSourceMacroInput(call, {
    ast,
    fragment(node) { fragments.push(node); return node; },
    intrinsic(tag) {
      const intrinsic = queries.checker.getIntrinsicDeclarationInfo(tag);
      if (intrinsic !== undefined) selectedIntrinsics.push(intrinsic);
      return intrinsic;
    },
    tokenize: tokenize ?? (source => {
      nativeTool ??= createRustNativeSourceTool({ cacheRoot: join(root, "native-cache") });
      return nativeTool.tokens(source, "2024");
    }),
  });
  return { result, ast, call, nodes, fragments, selectedIntrinsics };
}

function available(value) {
  assert.equal(value.result.kind, "available", value.result.reason);
  assert.ok(Object.isFrozen(value.result));
  assert.ok(Object.isFrozen(value.result.input));
  assert.ok(Object.isFrozen(value.result.input.tokens));
  return value.result.input;
}

test("token quotation is one noncallable compiler intrinsic, not a guessed tag name", () => {
  const declarations = rustSyntaxIntrinsicDeclarations();
  assert.deepEqual(declarations, [{ id: "tokens", name: "tokens", kind: "intrinsic" }]);
  assert.ok(Object.isFrozen(declarations));
  assert.ok(Object.isFrozen(declarations[0]));
  for (const tag of ["quote", "renamed", "namespace.tokens", 'namespace["tokens"]']) {
    const value = syntax(`unrelated(${tag}\`[]\`)`, { quotation: true });
    assert.equal(available(value).delimiter, "brackets");
    assert.ok(value.selectedIntrinsics.length > 0);
    for (const selected of value.selectedIntrinsics) {
      assert.equal(selected.declaration.exportId, "tokens");
      assert.equal(selected.ordinary, undefined);
      assert.equal(isRustTokenQuotationDeclaration(selected.declaration), true);
    }
  }
  for (const source of [
    "unrelated(tokens`[]`)",
    "function run(quote: (value: unknown) => unknown) { unrelated(quote`[]`); }",
    "function run() { const quote = (value: unknown) => value; unrelated(quote`[]`); }",
  ]) {
    const value = syntax(source, { quotation: true, tokenize: () => assert.fail("Unrelated tags are ordinary source fragments.") });
    assert.equal(available(value).delimiter, "parentheses");
    assert.equal(available(value).tokens[0].kind, "fragment");
    assert.deepEqual(value.selectedIntrinsics, []);
  }
});

test("quotation identity rejects foreign providers, versions and member/signature facts", () => {
  const value = syntax("unrelated(quote`[]`)", { quotation: true });
  const declaration = value.selectedIntrinsics[0].declaration;
  assert.equal(isRustTokenQuotationDeclaration(undefined), false);
  for (const field of ["providerId", "providerVersion", "providerModuleId", "moduleSpecifier", "exportId", "exportName"]) {
    assert.equal(isRustTokenQuotationDeclaration({ ...declaration, [field]: "unrelated" }), false, field);
  }
  for (const replacement of [
    { memberId: "tokens" }, { memberName: "tokens" },
    { memberKey: { kind: "property-key", name: "tokens" } }, { memberStatic: false }, { signatureId: "tokens" },
  ]) {
    assert.equal(isRustTokenQuotationDeclaration({ ...declaration, ...replacement }), false);
  }
});

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

test("selected native tags reuse exact quotation grammar without a tokens wrapper", () => {
  for (const source of ["`[${first}; ${count}]`", "`{ GET \"/\" => ${handler}; }`", "`(${value},)`", "``", "`${value}; ${count}`"]) {
    const direct = syntax(`arbitrary${source}`);
    const explicit = syntax(`arbitrary(quote${source})`, { quotation: true });
    const normalize = value => {
      const input = available(value);
      const visit = token => token.kind === "fragment"
        ? { kind: "fragment", text: value.ast.text(token.fragment) }
        : token.kind === "group" ? { ...token, tokens: token.tokens.map(visit) } : token;
      return { ...input, tokens: input.tokens.map(visit) };
    };
    assert.deepEqual(normalize(direct), normalize(explicit));
    assert.equal(direct.fragments.length, explicit.fragments.length);
    const visit = tokens => {
      for (const token of tokens) {
        if (token.kind === "fragment") assert.ok(direct.fragments.includes(token.fragment));
        else if (token.kind === "group") visit(token.tokens);
      }
    };
    visit(available(direct).tokens);
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
  for (const source of ["emit?.(first)", "emit<number>(first)", "emit(quote`first`, second)", "emit(quote<number>`first`)", "emit(quote`\\x`)",
    "emit<number>`first`", "emit`\\x`"]) {
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
