import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createCompilerSessionFromFiles, createSourceSemanticsExtension, TstsSourceProviderContractVersion } from "@tsonic/tsts";
import { createRustSourceSemanticsExtension } from "../../../dist/source/extension/source-extension.js";
import { rustSourceSemanticsModules } from "../../../dist/source/profiles/source-modules.js";
import { rustSourceSemanticsExtensionId } from "../../../dist/source/semantics/identity.js";
import { rustSourceNativeInputFactKey } from "../../../dist/source/semantics/native-input.js";
import { createRustNativeSourceTool } from "../../../dist/providers/native/elaboration/tool.js";
import { createTestWorkspace } from "../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../helpers/rust-session/paths.mjs";

const moduleSpecifier = "@test/native/input.js";
const exports = [
  { id: "collect", name: "collect", kind: "intrinsic" },
  { id: "procedure", name: "procedure", kind: "intrinsic" },
  { id: "attribute", name: "attribute", kind: "intrinsic" },
  { id: "derive", name: "derive", kind: "intrinsic" },
  { id: "foreign", name: "foreign", kind: "intrinsic" },
  { id: "ordinary", name: "ordinary", kind: "function", intrinsicId: "mixed", signatures: [
    { id: "ordinary.call", parameters: [{ name: "value", type: { kind: "number" } }], returnType: { kind: "number" } },
  ] },
];
const kinds = new Map([["collect", "declarative"], ["procedure", "function"], ["attribute", "attribute"], ["derive", "derive"], ["mixed", "declarative"]]);

function demand(expression, { prefix = "", files = {}, tokenize, request = true } = {}) {
  const resolutions = [];
  const nativeSelections = [];
  const tokenInputs = [];
  const macros = new Map([...kinds].map(([id, macroKind]) => [id, {
    id: `native-${id}`, name: `Authored${id}`, kind: "macro", macroKind,
    targetPath: ["unrelated_crate", `Authored${id}`], canonicalPath: ["original_crate", `Authored${id}`], helpers: [],
  }]));
  const providers = [{
    identity: { id: "test.native-input", version: "1", extensionContractVersion: TstsSourceProviderContractVersion },
    declarationMaterialization: "complete",
    ownsModule: specifier => ({ kind: specifier === moduleSpecifier ? "owned" : "unowned" }),
    resolveModule: specifier => ({ kind: "virtual", moduleSpecifier: specifier,
      providerModuleId: "Input", virtualFileName: "/provider/input.d.ts" }),
    getDeclarationModel: () => ({ moduleSpecifier, providerModuleId: "Input", exports }),
  }];
  const sourceText = `import { collect, procedure, attribute, derive, foreign, ordinary } from "${moduleSpecifier}";
import * as input from "${moduleSpecifier}";
${prefix}
const selected = ${expression};`;
  let nativeCalls = 0;
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/src", files: { ...files, "/src/index.ts": sourceText },
    compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler" },
    extensionHostOptions: { extensions: [
      createSourceSemanticsExtension({ modules: rustSourceSemanticsModules() }),
      createRustSourceSemanticsExtension({ providers, native: {
        macro(declaration) {
          nativeCalls += 1;
          nativeSelections.push(declaration);
          assert.equal(declaration.providerId, "test.native-input");
          assert.equal(declaration.providerVersion, "1");
          assert.equal(declaration.providerModuleId, "Input");
          assert.equal(declaration.moduleSpecifier, moduleSpecifier);
          return macros.get(declaration.exportId);
        },
        tokenize(source) {
          tokenInputs.push(source);
          assert.ok(tokenize, "Direct inputs must not initialize native tokenization.");
          return tokenize(source);
        },
      } }),
      {
        identity: { id: "test.native-input-consumer", version: "1" },
        dependencies: { dependsOn: [rustSourceSemanticsExtensionId] },
        elaborateSource(context) {
          if (!request) return;
          const file = context.source.getSourceFile("/src/index.ts");
          const ast = context.source.ast;
          let selected;
          const visit = node => {
            if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "selected") selected = ast.as.AsVariableDeclaration(node).Initializer;
            ast.forEachChild(node, visit);
          };
          visit(file);
          assert.ok(selected);
          resolutions.push({ node: selected, source: context.source });
          context.request(selected, rustSourceNativeInputFactKey);
        },
      },
    ] },
  }).checkSource();
  assert.deepEqual(checked.extensionDiagnostics, []);
  const node = resolutions.at(-1)?.node;
  const result = node === undefined ? undefined : checked.sourceFacts.getFact(node, rustSourceNativeInputFactKey);
  return { checked, result, node, nativeSelections, nativeCalls, tokenInputs, resolutions, macros };
}

function invocation(value) {
  assert.equal(value.result.kind, "invocation", value.result.reason);
  assert.ok(Object.isFrozen(value.result));
  assert.ok(Object.isFrozen(value.result.macro));
  assert.ok(Object.isFrozen(value.result.macro.targetPath));
  assert.ok(Object.isFrozen(value.result.input.tokens));
  assert.equal(value.checked.resolveElaborationReference(value.result.source), value.node);
  return value.result;
}

test("native input demands retain exact identities and source references through shared replay", () => {
  for (const expression of ["collect([1, 2, 3])", "input.collect([1, 2, 3])", 'input["collect"]([1, 2, 3])', "renamed([1, 2, 3])"]) {
    const value = demand(expression, { prefix: "const renamed = collect;" });
    const result = invocation(value);
    assert.equal(result.declaration.exportId, "collect");
    assert.deepEqual(result.macro.targetPath, ["unrelated_crate", "Authoredcollect"]);
    assert.equal(result.input.delimiter, "brackets");
    const fragments = result.input.tokens.filter(token => token.kind === "fragment");
    assert.equal(fragments.length, 3);
    assert.deepEqual(fragments.map(token => value.checked.ast.text(value.checked.resolveElaborationReference(token.fragment.source))), ["1", "2", "3"]);
    assert.ok(value.resolutions.length >= 2);
    assert.throws(() => value.resolutions[0].source.getSourceFiles(), /retired compiler program or epoch/u);
    assert.deepEqual(value.tokenInputs, []);
    assert.ok(value.checked.diagnostics.some(diagnostic => diagnostic?.code === 2349), "Input evidence alone must not authorize an unchecked native result.");
  }
});

test("function-like procedural macros use the same source-input owner and exact native category", () => {
  const value = demand("procedure(1, 2,)");
  const result = invocation(value);
  assert.equal(result.macro.macroKind, "function");
  assert.equal(result.input.delimiter, "parentheses");
  assert.deepEqual(result.input.tokens.map(token => token.kind), ["fragment", "punctuation", "fragment", "punctuation"]);
});

test("native token and declaration splices retain exact replay-owned source scopes", { timeout: 120_000 }, () => {
  const tool = createRustNativeSourceTool({ cacheRoot: createTestWorkspace(join(repositoryRoot, ".temp/generated"), "native-input-demands-") });
  const value = demand('collect(quote`[${quote.type<number>()}, ${quote.items(() => { type Local = number; function helper(value: Local): Local { return value; } })}]`)', {
    prefix: 'import { tokens as quote } from "@tsonic/rust/lang.js";',
    tokenize: source => tool.tokens(source, "2024"),
  });
  const result = invocation(value);
  assert.equal(value.tokenInputs.length, 1);
  assert.equal(result.input.delimiter, "brackets");
  const fragments = result.input.tokens.filter(token => token.kind === "fragment").map(token => token.fragment);
  assert.deepEqual(fragments.map(fragment => fragment.kind), ["type", "items"]);
  const ast = value.checked.ast;
  const type = value.checked.resolveElaborationReference(fragments[0].type);
  assert.equal(ast.is.IsKeywordTypeNode(type), true);
  const scope = value.checked.resolveElaborationReference(fragments[1].scope);
  const body = value.checked.resolveElaborationReference(fragments[1].body);
  assert.equal(ast.is.IsArrowFunction(scope), true);
  assert.equal(ast.body(scope), body);
  assert.equal(ast.statements(body).length, 2);
  assert.equal(ast.is.IsTypeAliasDeclaration(ast.statements(body)[0]), true);
  assert.equal(ast.is.IsFunctionDeclaration(ast.statements(body)[1]), true);
  const tagged = demand("collect`[1, 2]`", { tokenize: source => tool.tokens(source, "2024") });
  assert.equal(invocation(tagged).input.delimiter, "brackets");
  assert.equal(tagged.tokenInputs.length, 1);
});

test("native tokenizer failure aborts the demand rather than publishing partial input", () => {
  assert.throws(() => demand("collect`[unclosed`", {
    tokenize: () => { throw new Error("Native lexical failure"); },
  }), /Native lexical failure/u);
});

test("native input demands preserve imported reexports without matching source names", () => {
  const value = demand("renamed(19)", {
    prefix: 'import { renamed } from "./reexport.js";',
    files: { "/src/reexport.ts": `export { collect as renamed } from "${moduleSpecifier}";` },
  });
  assert.equal(invocation(value).declaration.exportId, "collect");
});

test("mixed provider facets require explicit selection and ordinary code stays ordinary", () => {
  const prefix = 'import { native } from "@tsonic/rust/lang.js";';
  const ambiguous = demand("ordinary(1)");
  assert.equal(ambiguous.result.kind, "rejected");
  assert.match(ambiguous.result.reason, /both macro and ordinary facets/u);
  assert.equal(invocation(demand("native.macro(ordinary)(1)", { prefix })).declaration.exportId, "mixed");
  for (const value of [
    demand("native.value(ordinary)(1)", { prefix }),
    demand("local(1)", { prefix: "function local(value: number): number { return value; }" }),
    demand("foreign(1)"),
  ]) assert.deepEqual(value.result, { kind: "not-native" });
});

test("native input demand rejects malformed calls and misplaced attribute or derive macros", () => {
  for (const expression of ["collect?.(1)", "collect<number>(1)", "attribute(1)", "derive(1)", "collect"]) {
    const value = demand(expression);
    assert.equal(value.result.kind, "rejected", expression);
    assert.ok(value.checked.resolveElaborationReference(value.result.source));
    assert.deepEqual(value.tokenInputs, []);
  }
});

test("native input evidence retains ignored source syntax without pretending it has ordinary types", () => {
  const value = demand("collect(missingInside())", { prefix: "missingOutside();" });
  const result = invocation(value);
  const operand = value.checked.resolveElaborationReference(result.input.tokens[0].fragment.source);
  assert.equal(value.checked.ast.is.IsCallExpression(operand), true);
  assert.equal(value.checked.ast.text(value.checked.ast.as.AsCallExpression(operand).Expression), "missingInside");
  assert.ok(value.checked.diagnostics.filter(diagnostic => diagnostic?.code === 2304).length >= 2);
  assert.deepEqual(value.tokenInputs, []);
});

test("registering native input support does no native work without a demand", () => {
  const value = demand("1", { request: false });
  assert.equal(value.result, undefined);
  assert.equal(value.nativeCalls, 0);
  assert.deepEqual(value.tokenInputs, []);
});

test("native input facts snapshot metadata and reject references from another compiler session", () => {
  const first = demand("collect(1)");
  const second = demand("collect(1)");
  const result = invocation(first);
  first.macros.get("collect").targetPath[1] = "Mutated";
  assert.deepEqual(result.macro.targetPath, ["unrelated_crate", "Authoredcollect"]);
  assert.throws(() => second.checked.resolveElaborationReference(result.source), /session|revision/u);
  assert.equal(rustSourceNativeInputFactKey.equals(result, rustSourceNativeInputFactKey.snapshot(result)), true);
});
