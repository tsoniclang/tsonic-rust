import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRust, checkRustSession, createRustSession } from "../../helpers/rust-session.mjs";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/facts/source-profile-registry.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { rustSourceParameterAbiFactKey } from "../../../dist/analysis/facts/keys.js";
import { resolveRustTargetTypeRef } from "../../../dist/policy/types/resolution/source.js";
import { resolveRustCallableStorageCarrier } from "../../../dist/policy/types/resolution/source-evidence.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { emptyRustLifetimeIndex } from "../../../dist/target-model/lifetimes/index.js";

const recursive = `
  export function recurse(callback: () => number, depth: number): number {
    if (depth <= 0) return callback();
    return recurse(callback, depth - 1);
  }
`;

function policyFixture(text) {
  const checked = checkRustSession(createRustSession({ files: { "index.ts": text } }));
  const source = createTargetSourceProgram(checked);
  const ast = source.ast;
  const files = source.sourceFiles.filter(file => !ast.isDeclarationFile(file));
  const storage = createSourceStorageQuery(source, files);
  const parameter = storage.nodes.find(node => ast.is.IsParameterDeclaration(node) &&
    ast.text(ast.name(node)) === "callback");
  assert.equal(parameter !== undefined, true);
  const selection = storage.subject(parameter, "value");
  assert.equal(selection.kind, "resolved");
  const sourceTypes = createRustSourceTypeRegistry();
  const facts = { get: (subject, key) => source.sourceFacts.getFact(subject, key),
    getFact: (subject, key) => source.sourceFacts.getFact(subject, key), resolve: () => undefined,
    getRuntimeCarrierFact: () => undefined, getSelectedTargetOperator: () => undefined,
    getSelectedTargetCall: () => undefined };
  const context = { source, ast, sourceStorage: storage, sourceStorageSubject: selection.subject,
    currentSourceFile: ast.getSourceFile(parameter), currentSemantics: source.semantics.forNode(parameter),
    semanticsFor: source.semantics.forNode, semantics: source.semantics.forFile, facts,
    typeDefinitions: sourceTypes, callableRepresentation: "storage", sourceLifetimes: emptyRustLifetimeIndex,
    pointerReturns: { resolve: () => undefined } };
  let selections = 0;
  const options = { jsEnabled: false, providerRows: [], providerTypes: [], sourceTypes,
    sourceProfiles: createRustSourceProfileRegistry(source.sourceFiles, ast, false),
    resolveProjectUnionCarrier: () => undefined,
    callableSignatureCarrier: () => assert.fail("a declaration cannot be specialized from recursive actual arguments"),
    callableStorageCarrier() { selections += 1; return undefined; } };
  return { parameter, context, options, selections: () => selections };
}

test("a recursive formal signature does not inspect physical producer activation", () => {
  const current = policyFixture(recursive);
  const carrier = resolveRustTargetTypeRef(current.context.ast.typeNode(current.parameter), current.context, current.options);
  const protocol = rustCallableProtocol(carrier);
  assert.equal(protocol !== undefined, true);
  assert.equal(protocol.parameters.length, 0);
  assert.equal(protocol.result.name, "float64");
  assert.equal(current.selections(), 0, "the checked formal signature is independent of actual callback producers");
});

test("a narrowed callable arm cannot replace its complete formal union carrier", () => {
  const current = policyFixture("export function consume(callback: string | (() => number)): void {}");
  const carrier = rustCallableTargetType([], { kind: "source-primitive", name: "float64" });
  const selected = resolveRustCallableStorageCarrier(carrier, current.context, current.options, new Set());
  assert.equal(selected === undefined, true, "unsealed union-arm physical storage still rejects");
  assert.equal(current.selections(), 1);
});

test("projected callback storage cannot acquire the whole formal's signature privilege", () => {
  const current = policyFixture("export function consume(callback: (() => number)[]): void {}");
  const projection = current.context.sourceStorage.subject(current.parameter, "value", [{ kind: "array-element" }]);
  assert.equal(projection.kind, "resolved");
  const carrier = rustCallableTargetType([], { kind: "source-primitive", name: "float64" });
  const selected = resolveRustCallableStorageCarrier(carrier,
    { ...current.context, sourceStorageSubject: projection.subject }, current.options, new Set());
  assert.equal(selected === undefined, true, "projected storage still requires its exact physical owner");
  assert.equal(current.selections(), 1);
});

for (const surfaces of [[], ["js"]]) {
  for (const [name, source, owners] of [
    ["direct", recursive, ["recurse"]],
    ["mutual", `
      export function left(callback: () => number, depth: number): number {
        if (depth <= 0) return callback();
        return right(callback, depth - 1);
      }
      export function right(callback: () => number, depth: number): number {
        if (depth <= 0) return callback();
        return left(callback, depth - 1);
      }
    `, ["left", "right"]],
    ["aliased", `
      type Callback = () => number;
      export function recurse(callback: Callback, depth: number): number {
        if (depth <= 0) return callback();
        return recurse(callback, depth - 1);
      }
    `, ["recurse"]],
  ]) test(`${name} recursive callback parameters resolve their exact signatures in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    const ast = program.source.ast;
    const declarations = [];
    const visit = node => {
      if (ast.is.IsFunctionDeclaration(node) && owners.includes(ast.text(ast.name(node)))) declarations.push(node);
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(declarations.length, owners.length);
    for (const declaration of declarations) {
      const parameter = ast.parameters(declaration)[0];
      const abi = program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
      assert.equal(abi !== undefined, true);
      const protocol = rustCallableProtocol(abi.parameterCarrier);
      assert.equal(protocol !== undefined, true);
      assert.equal(protocol.parameters.length, 0);
      assert.equal(protocol.result.name, "float64");
      assert.equal(program.callableValues.native.inputsFor(declaration).length, 1);
    }
  });
}

test("recursive actual arguments still obey the checked callback result contract", () => {
  assert.throws(() => checkRustSession(createRustSession({ files: { "index.ts": `
    export function recurse(callback: () => number, depth: number): number {
      if (depth <= 0) return callback();
      return recurse(() => "wrong", depth - 1);
    }
  ` } })), /TypeScript diagnostics:[\s\S]*not assignable/u);
});
