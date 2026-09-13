import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { acmeTestingPackage, checkRustSession, compileRust, createRustSession } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/facts/source-profile-registry.js";
import { checkedPropertySelectionInput } from "../../../dist/analysis/operations/provider/properties.js";
import { isIntrinsicSourceQualifier } from "../../../dist/analysis/operations/provider/source-qualifiers.js";

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
    sourceProfiles: createRustSourceProfileRegistry(source.sourceFiles, source.ast, true),
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
