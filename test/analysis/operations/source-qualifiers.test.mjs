import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { acmeTestingPackage, checkRustSession, compileRust, createRustSession } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/project/source-profiles.js";
import { checkedPropertySelectionInput } from "../../../dist/analysis/operations/member-access.js";
import { isIntrinsicSourceQualifier, selectRustProviderSourceReceiver } from "../../../dist/analysis/operations/members/source-qualifiers.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";

test("qualified source builtins preserve static operations and local shadow implementations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function local(globalThis: { String: { fromCharCode: (value: number) => number } }): number {
  return globalThis.String.fromCharCode(7);
}
export function main(): void {
  const codes = [65, 66];
  check(globalThis.String.fromCharCode(...codes) === "AB");
  check((globalThis).String.fromCharCode(65) === "A");
  check((globalThis.String).fromCodePoint(128512) === "😀");
  check(globalThis["String"].fromCharCode(...codes) === "AB");
  check(globalThis.Math.max(...[3, 7]) === 7);
  const frozen = globalThis.Object.freeze({});
  check(globalThis.Object.isFrozen(frozen));
  check(local({ String: { fromCharCode: value => value + 1 } }) === 8);
}
main();
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("qualified-source-builtins", result.artifacts, { run: true });
});

test("source qualifiers require exact intrinsic, declaration, profile and read evidence", () => {
  const checked = checkRustSession(createRustSession({ surfaces: ["js"], files: {
    "index.ts": `export function value(): string { return globalThis.String.fromCharCode(65); }`,
  } }));
  const source = createTargetSourceProgram(checked);
  const context = { source, ast: source.ast };
  const options = {
    jsEnabled: true,
    sourceProfiles: createRustSourceProfileRegistry(source, true),
  };
  const requests = [];
  function visit(node) {
    if (source.ast.is.IsPropertyAccessExpression(node)) {
      const info = source.semantics.forNode(node).operations.propertyAccess(node);
      if (info?.receiver.intrinsic === "global-object") requests.push(checkedPropertySelectionInput(context, node, info));
    }
    source.ast.forEachChild(node, visit);
  }
  visit(checked.getSourceFile("/src/index.ts"));
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(isIntrinsicSourceQualifier(request, context, options), true);
  for (const mutation of [
    { sourceReceiverIntrinsic: undefined },
    { sourceSelectedDeclaration: undefined },
    { sourceSelectedDeclaration: source.ast.statements(checked.getSourceFile("/src/index.ts"))[0] },
    { accessMode: "write" },
    { optionalChain: true },
  ]) assert.equal(isIntrinsicSourceQualifier({ ...request, ...mutation }, context, options), false);
  assert.equal(isIntrinsicSourceQualifier(request, context, { ...options, jsEnabled: false }), false);
  assert.equal(isIntrinsicSourceQualifier(request, context, {
    ...options, sourceProfiles: { profileForNode() { return undefined; } },
  }), false);
});

test("qualifier lowering does not erase computed-key or receiver calls", () => {
  for (const input of [
    `let visits = 0;
     function key(): "String" { visits += 1; return "String"; }
     export function value(): string { return globalThis[key()].fromCharCode(65); }`,
    `function scope(): typeof globalThis { return globalThis; }
     export function value(): string { return scope().String.fromCharCode(65); }`,
    `export function value(): typeof String { return globalThis.String; }`,
  ]) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": input } });
    assert(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
    assert.equal(result.artifacts.length, 0);
  }
});

test("checked provider namespaces require their one exact namespace export and never erase runtime receivers", () => {
  const provider = createRustProviderPackage({
    id: "qualifier-namespace", displayName: "Qualifier namespace", version: "1.0.0",
    modules: [{ moduleSpecifier: "@qualifier/native", providerModuleId: "qualifier.native", exports: [{
      id: "qualifier.Native", name: "Native", kind: "namespace", members: [{
        id: "qualifier.Native.read", name: "read", kind: "method",
        signatures: [{ id: "qualifier.Native.read(value)", parameters: [{ name: "value", type: { kind: "number" } }],
          returnType: { kind: "number" } }],
      }],
    }] }], operations: [], crates: [],
  });
  const checked = checkRustSession(createRustSession({ packages: [provider], files: { "index.ts": `
import { Native as selected } from "@qualifier/native";
const ordinary = { read(value: number): number { return value + 1; } };
function scope(): typeof selected { return selected; }
export function native(): number { return selected.read(1); }
export function shadow(): number { return ordinary.read(1); }
export function effectful(): number { return scope().read(1); }
` } }));
  assert.equal(checked.diagnostics.length, 0, "the real provider namespace and both runtime inverses check");
  const source = createTargetSourceProgram(checked);
  const context = { source, ast: source.ast, semanticsFor: node => source.semantics.forNode(node) };
  const accesses = [];
  const visit = node => {
    if (source.ast.is.IsPropertyAccessExpression(node)) accesses.push(source.semantics.forNode(node).operations.propertyAccess(node));
    source.ast.forEachChild(node, visit);
  };
  visit(checked.getSourceFile("/src/index.ts"));
  const receiver = name => accesses.find(access => source.ast.is.IsIdentifier(access?.receiver.expression) &&
    source.ast.text(access.receiver.expression) === name)?.receiver;
  const selected = receiver("selected");
  assert.equal(selected !== undefined && source.ast.is.IsVariableDeclaration(selected.valueDeclaration), true,
    "the compiler materializes the namespace as an exact checked const, not an authored runtime value");
  const identity = source.sourceFacts.getFact(selected.valueDeclaration, providerVirtualDeclarationFactKey);
  assert.equal(identity?.exportId, "qualifier.Native", "the imported alias retains its canonical provider export identity");
  const row = { ...identity, providerPackageId: provider.id, declarationKind: "namespace" };
  const options = { providerExports: [row], sourceProfiles: createRustSourceProfileRegistry(source, false) };
  assert.equal(selectRustProviderSourceReceiver(selected.expression, undefined, context, options)?.kind, "compile-time",
    "the existing exact namespace row admits a qualifier without a fabricated runtime carrier");
  for (const [label, rows] of [
    ["missing export", []], ["ambiguous export", [row, row]],
    ...["value", "function", "class", "interface", "type", "enum"].map(declarationKind =>
      [`non-namespace ${declarationKind}`, [{ ...row, declarationKind }]]),
    ...["providerId", "providerVersion", "providerModuleId", "moduleSpecifier", "exportId"].map(field =>
      [`foreign ${field}`, [{ ...row, [field]: "foreign" }]]),
  ]) assert.equal(selectRustProviderSourceReceiver(selected.expression, undefined, context,
    { ...options, providerExports: rows }) === undefined, true, label);
  const missing = { ...context, source: { ...source, sourceFacts: { getFact: () => undefined } } };
  assert.equal(selectRustProviderSourceReceiver(selected.expression, undefined, missing, options) === undefined, true,
    "an export row cannot substitute for missing checked declaration identity");
  assert.equal(selected.valueSymbol !== undefined, true, "the actual checked receiver has its canonical value symbol");
  for (const [label, mutation] of [
    ["member fact is not an export", { memberId: "qualifier.Native.read" }],
    ["signature fact is not an export", { signatureId: "qualifier.Native.read(value)" }],
  ]) {
    const altered = { ...context, source: { ...source, sourceFacts: { getFact(subject, key) {
      const fact = source.sourceFacts.getFact(subject, key);
      return key === providerVirtualDeclarationFactKey && fact !== undefined ? { ...fact, ...mutation } : fact;
    } } } };
    assert.equal(selectRustProviderSourceReceiver(selected.expression, undefined, altered, options) === undefined, true, label);
  }
  const conflict = { ...context, source: { ...source, sourceFacts: { getFact(subject, key) {
    const fact = source.sourceFacts.getFact(subject, key);
    return subject === selected.valueSymbol && key === providerVirtualDeclarationFactKey
      ? { ...identity, exportId: "foreign" } : fact;
  } } } };
  const runtime = { kind: "source-primitive", name: "float64" };
  assert.equal(selectRustProviderSourceReceiver(selected.expression, runtime, conflict, options) === undefined, true,
    "conflicting checked identities cannot fall through to a runtime receiver");
  const ordinary = receiver("ordinary");
  const effectful = accesses.find(access => source.ast.is.IsCallExpression(access?.receiver.expression))?.receiver;
  for (const [label, actual] of [["local shadow", ordinary], ["effectful call result", effectful]]) {
    assert.equal(actual !== undefined, true, `${label}: the original checked receiver is retained`);
    const selectedRuntime = selectRustProviderSourceReceiver(actual.expression, runtime, context, options);
    assert.equal(selectedRuntime?.kind === "runtime" && selectedRuntime.carrier === runtime, true,
      `${label}: preserve evaluation and its exact supplied carrier, not namespace spelling`);
    assert.equal(selectRustProviderSourceReceiver(actual.expression, undefined, context, options) === undefined, true,
      `${label}: missing runtime evidence remains unresolved`);
  }
});
