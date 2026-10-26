import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, sourcePrimitiveFactKey } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { resolveRustCallableEvidence, resolveRustCallableStorageCarrier } from "../../../dist/analysis/source-evidence/types/resolution/source-evidence.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { resolveRustConstructSignature } from "../../../dist/analysis/source-evidence/types/resolution/constructors.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustCallableInputProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustSourceClosureValueCarrier } from "../../../dist/analysis/callables/function-values.js";
import { rustResolutionContext } from "../../../dist/analysis/program/walk.js";
import { analyzeRustOperations } from "../../helpers/rust-operation-analysis.mjs";
import { selectRustCallableOwnership } from "../../../dist/analysis/callables/ownership-plan.js";


for (const surfaces of [[], ["js"]]) {
  test(`only the complete declared parameter can select invocation-only storage in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      function direct(value: () => number): number { return value(); }
      function union(value: string | (() => number)): number { return (value as () => number)(); }
      export function main(): void { direct(() => 1); union(() => 2); }
    ` } });
    const parameters = [];
    const visit = node => {
      if (program.source.ast.is.IsParameterDeclaration(node)) parameters.push(node);
      program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(parameters.length, 2);
    const borrowed = parameters.map(parameter => rustCallableInputProtocol(
      program.records.sourceParameterAbi.get(parameter)?.parameterCarrier) !== undefined);
    assert.deepEqual(borrowed, [true, false], "a narrowed union arm cannot replace the entire formal parameter ABI");
  });
}

function fixture(purpose) {
  const resultType = Object.freeze({});
  const symbol = Object.freeze({});
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/purpose", files: {
    "/purpose/index.ts": "const callback = (): number => 0;",
  }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the physical context is an actual checked value");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/purpose/index.ts");
  const storage = createSourceStorageQuery(source, [file]);
  const declaration = storage.nodes.find(node => source.ast.is.IsVariableDeclaration(node));
  const selected = storage.subjectFor(declaration);
  const scope = storage.bindingsForLexicalOwner(declaration);
  assert.equal(selected.kind === "resolved" && scope.kind === "resolved", true);
  const subject = selected.subject;
  let storageQueries = 0;
  const semantics = {
    declarations: { typeSymbol: () => symbol, typeAliasSymbol: () => undefined, symbolDeclarations: () => [] },
    types: { isTypeReference: () => false, isNonPrimitive: () => false },
    facts: { typeSubjects: () => [] },
  };
  const context = {
    callableRepresentation: purpose,
    sourceStorage: storage,
    sourceStorageResolution: { kind: "resolved", subject, bindings: scope.bindings },
    currentSemantics: semantics,
    ast: { ...source.ast },
    source: { sourceFacts: { getFact: (selected, key) => selected === symbol && key === sourcePrimitiveFactKey ? { kind: "float64" } : undefined } },
    sourceLifetimes: { contractFor: () => undefined },
  };
  const options = {
    jsEnabled: true,
    callableValueLifetime: () => assert.fail("the primitive signature fixture has no retained native method body"),
    sourceTypes: { structuralObjectForType: () => undefined },
    callableStorageCarrier(selected, selection, logical) {
      storageQueries++;
      assert.equal(selected.subject === subject && selected.bindings === scope.bindings, true);
      assert.equal(selection.kind, "storage", "physical storage retains its explicit selection purpose");
      assert.equal(selection.producers.kind, "complete", "physical ownership consumes the one completed selection");
      assert.equal(rustCallableProtocol(logical)?.result.name, "float64");
      throw new Error("physical ownership remains unsealed");
    },
  };
  return { context, options, callable: { parameters: [], result: { selectedType: resultType } }, queries: () => storageQueries };
}

test("signature purpose never queries physical activation storage", () => {
  const selected = fixture("signature");
  const carrier = resolveRustCallableEvidence(selected.callable, selected.context, selected.options, new Set());
  assert.equal(rustCallableProtocol(carrier)?.parameters.length, 0);
  assert.equal(rustCallableProtocol(carrier)?.result.name, "float64");
  assert.equal(selected.queries(), 0);
});

test("storage purpose retains the physical ownership guard", () => {
  const selected = fixture("storage");
  assert.throws(() => resolveRustCallableEvidence(selected.callable, selected.context, selected.options, new Set()),
    /physical ownership remains unsealed/u);
  assert.equal(selected.queries(), 1);
});

function originalConstruction() {
  const current = analyzeRustOperations(`
export function make(value: number) { return { async read(): Promise<number> { return value; } }; }
export async function read(): Promise<number> { return await make(7).read(); }
`, { surfaces: ["js"] });
  const declaration = current.context.sourceStorage.nodes.find(node => current.context.ast.is.IsMethodDeclaration(node));
  assert.equal(declaration !== undefined, true, "the original method body is actual checked source");
  assert.equal(current.context.records.sourceCallableReturn.get(declaration) !== undefined, true,
    "the existing native return producer completes before constructing its callable value");
  const recorded = current.context.records.targetOperation.get(declaration);
  assert.equal(recorded?.kind, "closure", "actual source analysis constructs the original native body");
  const carrier = recorded.resultCarrier;
  assert.equal(rustCallableProtocol(carrier) !== undefined, true, "the completed original has its native invocation contract");
  return { ...current, declaration, carrier };
}

test("original callable construction never closes its future externally written method storage", () => {
  const { walk, context, declaration, carrier } = originalConstruction();
  const selected = rustResolutionContext(walk, declaration, "value");
  const source = selected.sourceStorageResolution;
  assert.equal(source.kind, "resolved");
  const producers = context.sourceStorage.storageProducersFor(source.subject, source.bindings);
  assert.equal(producers.kind, "open", "future external method-slot writes remain an open storage domain");
  assert.equal(producers.boundaries.some(boundary => boundary.kind === "external-write" &&
    boundary.subject.node === declaration), true, "the actual future boundary belongs to this original method");
  let constructions = 0;
  const originalSelector = walk.operationOptions.callableStorageCarrier;
  const constructorWalk = { ...walk, operationOptions: { ...walk.operationOptions,
    callableStorageCarrier(actual, selection, ...remaining) {
      constructions += 1;
      assert.equal(selection.kind, "construction");
      assert.equal(selection.declaration === declaration && actual.subject === source.subject &&
        actual.bindings === source.bindings, true, "original construction preserves its exact body and invocation binding");
      return originalSelector(actual, selection, ...remaining);
    },
  } };
  assert.equal(rustSourceClosureValueCarrier(constructorWalk, declaration, carrier) !== undefined, true,
    "the actual native constructor retains its completed original body and captures");
  assert.equal(constructions, 1, "one selector receives the explicit original-construction input");
  assert.equal(resolveRustCallableStorageCarrier(carrier, selected, walk.operationOptions, new Set()) === undefined, true,
    "the same callable's future storage cannot borrow the constructor's closed-body proof");
});

test("native construction requires its completed original body, captures and ownership proof", () => {
  const { walk, context, declaration, carrier } = originalConstruction();
  const lexical = context.retainedEnvironments.lexicalFor(declaration);
  assert.equal(lexical.kind, "resolved");
  const captured = lexical.captures[0]?.declaration;
  assert.equal(captured !== undefined, true, "the native constructor retains the actual scalar capture");
  const failures = [
    ["missing native return record", { ...context, records: { ...context.records,
      sourceCallableReturn: { ...context.records.sourceCallableReturn,
        get: node => node === declaration ? undefined : context.records.sourceCallableReturn.get(node) } } }],
    ["missing original body", { ...context, ast: { ...context.ast,
      body: node => node === declaration ? undefined : context.ast.body(node) } }],
    ["unresolved capture environment", { ...context, retainedEnvironments: { ...context.retainedEnvironments,
      lexicalFor: node => node === declaration ? { kind: "unresolved", reason: "actual capture unavailable" }
        : context.retainedEnvironments.lexicalFor(node) } }],
    ["unresolved captured native input", { ...context, records: { ...context.records,
      sourceParameterAbi: { ...context.records.sourceParameterAbi,
        get: node => node === captured ? undefined : context.records.sourceParameterAbi.get(node) } } }],
    ["finite ownership failure", { ...context, callableOwnership: { ...context.callableOwnership,
      failureReason: () => "actual ownership budget exhausted" } }],
  ];
  for (const [label, changed] of failures) {
    assert.equal(rustSourceClosureValueCarrier({ ...walk, context: changed }, declaration, carrier) === undefined, true, label);
  }
  const selected = rustResolutionContext(walk, declaration, "value");
  const original = selected.sourceStorageResolution;
  const ownershipIssue = selectRustCallableOwnership({ ...context.callableOwnership,
    issues: [...context.callableOwnership.issues, { node: declaration, reason: "actual construction ownership unavailable" }],
  }, original.subject, { kind: "construction", declaration }, []);
  assert.equal(ownershipIssue.kind, "unresolved", "an original construction issue is refused by its owning selector");
  assert.equal(ownershipIssue.reason, "actual construction ownership unavailable");
  for (const subject of [{ ...original.subject }, { ...original.subject, projection: [{ kind: "array-element" }] }]) {
    assert.equal(resolveRustCallableStorageCarrier(carrier, { ...selected, callableRepresentation: "construction",
      sourceStorageResolution: { ...original, subject } }, walk.operationOptions, new Set()) === undefined, true,
    "a forged or projected storage subject cannot stand in for original construction");
  }
});

test("constructor contracts remain logical even when their enclosing value has physical storage", () => {
  const selected = fixture("storage");
  const declaration = {};
  const signature = {};
  selected.context.ast.typeParameters = () => [];
  selected.context.ast.typeNode = () => undefined;
  selected.context.ast.is = { IsMethodDeclaration: () => false };
  selected.context.sourceStorage = { subject: () => ({ kind: "unresolved", reason: "A signature is not a value." }) };
  selected.context.pointerReturns = { resolve: () => undefined };
  selected.context.semanticsFor = () => selected.context.currentSemantics;
  selected.context.currentSemantics.declarations.signatureDeclaration = candidate => candidate === signature ? declaration : undefined;
  const signatureInfo = { signature, parameters: [], returnType: selected.callable.result.selectedType };
  const construction = resolveRustConstructSignature(signatureInfo, selected.context, selected.options, new Set());
  assert.equal(construction !== undefined, true);
  assert.equal(construction.declaration === declaration, true);
  assert.equal(construction.signatureInfo === signatureInfo, true);
  assert.equal(selected.queries(), 0, "logical construction cannot request unsealed physical ownership");
});
