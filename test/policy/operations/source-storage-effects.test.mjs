import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics, providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { jsSourceSemanticsIdentity } from "@tsonic/js-source-profile";
import { collectTargetSourceProfileContributions } from "../../../../tsonic/packages/host/dist/target/source-profile.js";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/facts/source-profile-registry.js";
import { rustJsSurfaceSourceProfileContributions, rustNativeSourceProfileContributions } from "../../../dist/source/profiles/declarations.js";
import { createRustSourceProfileStorageEffects } from "../../../dist/policy/operations/source-profiles/source-storage-effects.js";
import { rustPolicyNode } from "../../../dist/policy/model/context.js";
import { resolveSelectedSourceProfileMember } from "../../../dist/policy/evidence/selected-source.js";
import { createRustAnalysisContext } from "../../../dist/analysis/program/context.js";
import { analyzeRustRuntimeReferences, analyzeRustDispatchContextCatalog } from "../../../dist/analysis/runtime/index.js";
import { compileRust } from "../../helpers/rust-session.mjs";
import { nativeStorageOperationAuthoritySource, nativeStorageOperationFactSource, nativeStorageVirtualOperationSource } from "../../../../tsonic/test/fixtures/native-storage-operation-authority.mjs";

function fixture(body = `
  const original = { count: 3 };
  const frozen = Object.freeze(original);
  const observed = Object.isFrozen(original);
  const freeze = Object.freeze;
  const alias = freeze(original);
`, jsEnabled = true) {
  const profile = collectTargetSourceProfileContributions({
    project: {}, projectRoot: "/src", projectDirectory: "/src",
    target: { id: "rust", options: {} }, targetPackId: jsEnabled ? "js" : "rust",
    selectedCapabilities: [], selectedSurfaces: [],
    targetContributions: jsEnabled ? rustJsSurfaceSourceProfileContributions() : rustNativeSourceProfileContributions(),
  });
  assert.equal(profile.diagnostics.length, 0, "exact selected source profile");
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: new Map([["/src/index.ts", `export {};\n${body}`], ...profile.files.map(file => [file.path, file.text])]),
    compilerOptions: { noLib: true, strict: true, skipLibCheck: true,
      module: "esnext", moduleResolution: "bundler", target: "es2022" },
  }).checkSource();
  assert.equal(formatDiagnostics(checked.diagnostics.filter(value => value !== undefined), "/src"), "");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/src/index.ts");
  assert.equal(file !== undefined, true, "checked authored source");
  const variables = new Map();
  const visit = node => {
    if (source.ast.is.IsVariableDeclaration(node)) {
      variables.set(source.ast.text(source.ast.name(node)), source.ast.as.AsVariableDeclaration(node).Initializer);
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(file);
  const profiles = createRustSourceProfileRegistry(source.sourceFiles, source.ast, jsEnabled);
  const effects = createRustSourceProfileStorageEffects(source, profiles);
  const selected = name => {
    const invocation = variables.get(name);
    assert.equal(invocation !== undefined, true, name);
    const call = source.semantics.forNode(invocation).operations.call(invocation);
    assert.equal(call !== undefined, true, `${name} has exact checked call selection`);
    return { invocation, call };
  };
  return { source, file, variables, profiles, effects, selected };
}

test("native Error construction and calls contribute exact fresh allocation without aliases", () => {
  const current = fixture(`
    const constructed = new Error("native");
    const called = Error("native");
    const observed = Error.captureStackTrace(constructed);
  `, false);
  const storage = createSourceStorageQuery(current.source, [current.file], undefined, current.effects);
  assert.equal(storage.failureReason() === undefined, true, "exact native allocation contribution is accepted");
  for (const name of ["constructed", "called"]) {
    const { invocation, call } = current.selected(name);
    const declaration = current.source.semantics.forNode(invocation).declarations.signatureDeclaration(call.selectedSignature);
    assert.equal(current.profiles.profileForNode(declaration, current.source.ast), "native");
    const effect = current.effects.call(invocation, call);
    assert.equal(effect !== undefined, true, name);
    assert.equal(effect.resultAllocation === invocation, true, name);
    assert.equal(effect.resultAlias === undefined, true, name);
    assert.equal(effect.preservedInputs.length, 0, name);
    assert.equal(Object.isFrozen(effect) && Object.isFrozen(effect.preservedInputs), true);
    const subject = storage.subjectFor(invocation);
    assert.equal(subject.kind, "resolved", name);
    const origins = storage.originsFor(subject.subject);
    assert.equal(origins.kind, "resolved", name);
    assert.equal(origins.origins.length, 1, name);
    assert.equal(origins.origins[0].subject.node === invocation, true, name);
  }
  const { invocation, call } = current.selected("observed");
  assert.equal(current.effects.call(invocation, call) === undefined, true, "native member without allocation evidence");
});

test("local Error and ErrorConstructor names never manufacture native allocation evidence", () => {
  for (const jsEnabled of [false, true]) {
    for (const body of [
      `class Error { constructor(message?: string) {} } const constructed = new Error("local");`,
      `interface ErrorConstructor { new (message?: string): object; (message?: string): object; }
        declare const Error: ErrorConstructor;
        const constructed = new Error("local"); const called = Error("local");`,
    ]) {
      const current = fixture(body, jsEnabled);
      for (const name of ["constructed", ...(current.variables.has("called") ? ["called"] : [])]) {
        const { invocation, call } = current.selected(name);
        assert.equal(current.effects.call(invocation, call) === undefined, true, "unowned same-name declaration");
      }
    }
  }
});

test("external constructors with global Error signatures cannot prove fresh native allocations", () => {
  for (const jsEnabled of [false, true]) {
    for (const type of ["ErrorConstructor", "typeof Error"]) {
      const current = fixture(`
        declare const external: ${type};
        const constructed = new external("external");
        const called = external("external");
      `, jsEnabled);
      const storage = createSourceStorageQuery(current.source, [current.file], undefined, current.effects);
      assert.equal(storage.failureReason() === undefined, true);
      for (const name of ["constructed", "called"]) {
        const { invocation, call } = current.selected(name);
        assert.equal(current.effects.call(invocation, call) === undefined, true, "unknown same-signature callees publish no allocation claim");
        const subject = storage.subjectFor(invocation);
        assert.equal(subject.kind, "resolved", name);
        const domain = storage.closedOriginsFor(subject.subject);
        assert.equal(domain.kind, "open", "signature ownership is not runtime producer ownership");
        assert.equal(domain.boundaries.length > 0, true, "exact unknown callee boundary is retained");
      }
    }
  }
});

test("native alias and preservation effects require actual owned operation identity", () => {
  const current = fixture(nativeStorageOperationAuthoritySource);
  const storage = createSourceStorageQuery(current.source, [current.file], undefined, current.effects);
  const complete = new Set(["owned", "ownedAlias"]);
  for (const name of ["owned", "ownedAlias", "externalMember", "externalFunction"]) {
    const { invocation, call } = current.selected(name);
    const effect = current.effects.call(invocation, call);
    assert.equal(effect?.resultAlias === call.sourceArguments[0].expression, complete.has(name),
      `${name} proves implementation identity, not merely the signature`);
    assert.equal(effect !== undefined, complete.has(name), `${name} cannot publish unchecked preservation either`);
    const subject = storage.subjectFor(invocation);
    assert.equal(subject.kind, "resolved", name);
    const domain = storage.closedOriginsFor(subject.subject);
    assert.equal(domain.kind, complete.has(name) ? "complete" : "open", name);
  }
  const retained = current.variables.get("externalPreserved");
  assert.equal(retained !== undefined, true, "the actual selected holder member is checked");
  const selected = storage.subjectFor(retained);
  assert.equal(selected.kind, "resolved");
  const domain = storage.closedOriginsFor(selected.subject);
  assert.equal(domain.kind, "open", "an unknown same-signature operation can mutate the exposed member");
  assert.equal(domain.boundaries.some(boundary => boundary.kind === "opaque-write"), true,
    "the actual unknown invocation retains its member-write witness");
  assert.equal(storage.failureReason(), undefined, "one finite proof graph");
});

test("immutable aliases to the owned global Error retain exact native allocation identity", () => {
  for (const jsEnabled of [false, true]) {
    const current = fixture(`
      const Original = Error;
      const Selected = Original;
      const constructed = new Selected("owned");
      const called = Selected("owned");
    `, jsEnabled);
    const storage = createSourceStorageQuery(current.source, [current.file], undefined, current.effects);
    assert.equal(storage.failureReason() === undefined, true);
    for (const name of ["constructed", "called"]) {
      const { invocation, call } = current.selected(name);
      const effect = current.effects.call(invocation, call);
      assert.equal(effect !== undefined, true, name);
      assert.equal(effect.resultAllocation === invocation, true, name);
      const subject = storage.subjectFor(invocation);
      assert.equal(subject.kind, "resolved", name);
      const domain = storage.closedOriginsFor(subject.subject);
      assert.equal(domain.kind, "complete", name);
      assert.equal(domain.origins.length, 1, name);
      assert.equal(domain.origins[0].subject.node === invocation, true, name);
    }
  }
});

test("freeze retains the exact selected argument and publishes immutable source-only effects", () => {
  const current = fixture();
  const { invocation, call } = current.selected("frozen");
  const effect = current.effects.call(invocation, call);
  assert.equal(effect !== undefined, true);
  assert.equal(effect.resultAlias === call.sourceArguments[0].expression, true);
  assert.equal(effect.preservedInputs.length, 1);
  assert.equal(effect.preservedInputs[0] === effect.resultAlias, true);
  assert.equal(Object.isFrozen(current.effects) && Object.isFrozen(effect) && Object.isFrozen(effect.preservedInputs), true);
});

test("isFrozen preserves its input without manufacturing a result alias", () => {
  const current = fixture();
  const { invocation, call } = current.selected("observed");
  const effect = current.effects.call(invocation, call);
  assert.equal(effect !== undefined, true);
  assert.equal(effect.resultAlias === undefined, true);
  assert.equal(effect.preservedInputs.length, 1);
  assert.equal(effect.preservedInputs[0] === call.sourceArguments[0].expression, true);
});

test("selected immutable callable aliases retain declaration identity rather than callee spelling", () => {
  const current = fixture();
  const { invocation, call } = current.selected("alias");
  const effect = current.effects.call(invocation, call);
  assert.equal(effect !== undefined, true);
  assert.equal(effect.resultAlias === call.sourceArguments[0].expression, true);
});

test("local Object and ObjectConstructor lookalikes cannot contribute JavaScript storage policy", () => {
  for (const body of [
    `const original = {}; const Object = { freeze(value: object) { return value; } };
      const frozen = Object.freeze(original);`,
    `interface ObjectConstructor { freeze(value: object): object; }
      declare const local: ObjectConstructor; const original = {}; const frozen = local.freeze(original);`,
  ]) {
    const current = fixture(body);
    const { invocation, call } = current.selected("frozen");
    assert.equal(current.effects.call(invocation, call) === undefined, true, "unowned same-name declaration");
  }
});

test("disabled or ambiguous source-profile provenance cannot invent an effect", () => {
  const current = fixture();
  const { invocation, call } = current.selected("frozen");
  const disabled = createRustSourceProfileRegistry(current.source.sourceFiles, current.source.ast, false);
  assert.equal(createRustSourceProfileStorageEffects(current.source, disabled).call(invocation, call) === undefined, true);
  assert.equal(createRustSourceProfileStorageEffects(current.source, {
    profileForNode: () => undefined,
  }).call(invocation, call) === undefined, true);
});

function virtualSource(current, identity, bindingIdentity) {
  const { invocation, call } = current.selected("frozen");
  return nativeStorageOperationFactSource(current.source, call, identity, bindingIdentity);
}

const virtualFreezeBody = nativeStorageVirtualOperationSource;
const virtualIdentity = Object.freeze({
  providerId: jsSourceSemanticsIdentity.providerId, providerVersion: "1",
  providerModuleId: "test.selected-js", moduleSpecifier: "@test/selected-js",
  artifactFileName: "/src/selected-js.d.ts", exportName: "ObjectConstructor",
  memberName: "freeze", memberKey: { kind: "property-key", name: "freeze" },
});

test("exact JavaScript-owned virtual declarations carry effects independently of source-profile paths", () => {
  const current = fixture(virtualFreezeBody);
  const { invocation, call } = current.selected("frozen");
  assert.equal(current.effects.call(invocation, call) === undefined, true, "no unowned inference");
  for (const identity of [
    virtualIdentity,
    { ...virtualIdentity, memberName: undefined },
    { ...virtualIdentity, memberKey: undefined },
    { ...virtualIdentity, memberName: "assign" },
  ]) {
    const source = virtualSource(current, identity, { ...identity, exportName: "Object", memberName: undefined,
      memberKey: undefined, memberId: undefined, signatureId: undefined });
    const effect = createRustSourceProfileStorageEffects(source, current.profiles).call(invocation, call);
    assert.equal(effect !== undefined, true, "canonical provider property key does not require a redundant label");
    assert.equal(effect.resultAlias === call.sourceArguments[0].expression, true);
  }
});

test("a virtual native member signature alone cannot certify a foreign runtime binding", () => {
  const current = fixture(virtualFreezeBody);
  const { invocation, call } = current.selected("frozen");
  for (const binding of [undefined,
    { ...virtualIdentity, exportName: "Other", memberName: undefined, memberKey: undefined },
    { ...virtualIdentity, exportName: "Object", memberName: undefined, memberKey: undefined, providerModuleId: "other-module" },
    { ...virtualIdentity, exportName: "Object", memberName: undefined, memberKey: undefined, providerId: "foreign-provider" },
  ]) {
    const source = virtualSource(current, virtualIdentity, binding);
    assert.equal(createRustSourceProfileStorageEffects(source, current.profiles).call(invocation, call) === undefined, true,
      "exact operation and actual binding must share the owned provider contract");
  }
});

test("foreign or incomplete virtual owners and unknown JavaScript members fail closed", () => {
  const current = fixture(virtualFreezeBody);
  const { invocation, call } = current.selected("frozen");
  for (const [label, identity] of [
    ["foreign provider", { ...virtualIdentity, providerId: "not-the-javascript-owner" }],
    ["missing owner", { ...virtualIdentity, exportName: undefined }],
    ["missing member", { ...virtualIdentity, memberName: undefined, memberKey: undefined }],
    ["other type", { ...virtualIdentity, exportName: "OtherConstructor" }],
    ["other operation", { ...virtualIdentity, memberName: "assign", memberKey: { kind: "property-key", name: "assign" } }],
  ]) {
    const source = virtualSource(current, identity);
    assert.equal(createRustSourceProfileStorageEffects(source, current.profiles).call(invocation, call) === undefined, true, label);
  }
});

test("provider member keys cannot be replaced by a misleading optional member label", () => {
  const current = fixture(virtualFreezeBody);
  const { invocation, call } = current.selected("frozen");
  for (const memberKey of [
    { kind: "property-key", name: "assign" },
    { kind: "well-known-symbol", name: "iterator" },
  ]) {
    const source = virtualSource(current, { ...virtualIdentity, memberKey });
    const declaration = source.semantics.forNode(invocation).declarations.signatureDeclaration(call.selectedSignature);
    const identity = resolveSelectedSourceProfileMember({
      ast: source.ast,
      facts: { get: source.sourceFacts.getFact },
      semanticsFor: source.semantics.forNode,
    }, declaration, current.profiles);
    assert.equal(identity?.memberName, memberKey.kind === "property-key" ? "assign" : "@@iterator");
    assert.equal(createRustSourceProfileStorageEffects(source, current.profiles).call(invocation, call) === undefined, true);
  }
});

test("unresolved signatures stop before semantic identity lookup", () => {
  const current = fixture();
  const { invocation, call } = current.selected("frozen");
  let reads = 0;
  const source = { ...current.source, semantics: { ...current.source.semantics,
    forNode(node) { reads += 1; return current.source.semantics.forNode(node); },
  } };
  const effects = createRustSourceProfileStorageEffects(source, current.profiles);
  assert.equal(effects.call(invocation, { ...call, sourceSelectedSignatureKind: "untyped" }) === undefined, true);
  assert.equal(reads, 0);
});

test("the shared materializer rejects unknown spread rest duplicate and missing parameter bindings", () => {
  const current = fixture();
  const { invocation, call } = current.selected("frozen");
  const binding = call.sourceArgumentBindings[0];
  for (const [label, changed] of [
    ["no binding", { sourceArgumentBindings: [] }],
    ["unknown parameter", { sourceArgumentBindings: [{ ...binding, sourceParameterIndex: 1 }] }],
    ["spread argument", { sourceArgumentBindings: [{ ...binding, sourceForm: "spread" }] }],
    ["rest parameter", { sourceArgumentBindings: [{ ...binding, sourceParameterForm: "rest" }] }],
    ["duplicate parameter", { sourceArgumentBindings: [binding, binding] }],
    ["missing argument", { sourceArguments: [] }],
    ["fractional index", { sourceArgumentBindings: [{ ...binding, sourceArgumentIndex: 0.5 }] }],
    ["negative index", { sourceArgumentBindings: [{ ...binding, sourceArgumentIndex: -1 }] }],
  ]) {
    assert.equal(current.effects.call(invocation, { ...call, ...changed }) === undefined, true, label);
  }
});

test("a genuinely checked tuple-spread call does not manufacture scalar storage evidence", () => {
  const current = fixture("const original = {}; const frozen = Object.freeze(...([original] as const));");
  const { invocation, call } = current.selected("frozen");
  assert.equal(call.sourceArgumentBindings.some(binding => binding.sourceForm !== "value"), true);
  assert.equal(current.effects.call(invocation, call) === undefined, true);
});

test("shared source storage carries freeze origins but not isFrozen result aliases", () => {
  const current = fixture();
  const storage = createSourceStorageQuery(current.source, [current.file], undefined, current.effects);
  assert.equal(storage.failureReason() === undefined, true);
  for (const name of ["frozen", "alias", "observed"]) {
    const invocation = current.variables.get(name);
    const subject = storage.subjectFor(invocation);
    assert.equal(subject.kind, "resolved", name);
    const origins = storage.originsFor(subject.subject);
    assert.equal(origins.kind, "resolved", name);
    assert.equal(origins.origins.length, 1, name);
    assert.equal(origins.origins[0].subject.node === (name === "observed"
      ? invocation : current.variables.get("original")), true, name);
  }
});

test("the canonical node reader accepts a source-only context without target representations", () => {
  const current = fixture();
  const node = current.variables.get("original");
  assert.equal(rustPolicyNode({ ast: current.source.ast }, node) === node, true);
  assert.equal(rustPolicyNode({ ast: current.source.ast }, undefined) === undefined, true);
});

test("the real Rust target session wires the same freeze alias query into its context", () => {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: {
    "index.ts": "export function run(): number { const original = { count: 3 }; const frozen = Object.freeze(original); return frozen.count; }",
  }, compileTarget(request) {
    const runtime = analyzeRustRuntimeReferences(request.input.runtimeReferences, request.configuration.foundation);
    assert.equal(runtime.kind, "resolved");
    const dispatch = analyzeRustDispatchContextCatalog(request.providerSemantics.dispatchContexts, runtime.plan.activeCrates);
    assert.equal(dispatch.kind, "resolved");
    context = createRustAnalysisContext(request.input, request.providerSemantics,
      request.jsEnabled, request.rootPublishesLibrary, dispatch.plan);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
  } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
  assert.equal(context !== undefined, true, "target session invokes real context construction");
  let original;
  let frozen;
  const visit = node => {
    if (context.ast.is.IsVariableDeclaration(node)) {
      const name = context.ast.text(context.ast.name(node));
      if (name === "original") original = context.ast.as.AsVariableDeclaration(node).Initializer;
      if (name === "frozen") frozen = context.ast.as.AsVariableDeclaration(node).Initializer;
    }
    context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  context.sourceFiles.forEach(visit);
  assert.equal(original !== undefined && frozen !== undefined, true);
  const subject = context.sourceStorage.subjectFor(frozen);
  assert.equal(subject.kind, "resolved");
  const origins = context.sourceStorage.originsFor(subject.subject);
  assert.equal(origins.kind, "resolved");
  assert.equal(origins.origins.length, 1);
  assert.equal(origins.origins[0].subject.node === original, true);
});
