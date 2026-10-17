import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createTargetSourceProgram, Node_Initializer, sourceNodesOutsideErasedSubtrees } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createRustNativeCallableInputPlan } from "../../../dist/analysis/callables/native-inputs.js";
import { createRustNativeStorageQueries } from "../../../dist/analysis/callables/native-storage.js";
import { finalizeRustNativeParameterStorage } from "../../../dist/analysis/callables/native-parameters.js";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustGenericCallablePlan } from "../../../dist/analysis/callables/generic-values.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native-captures.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustProducerErrorReference } from "../../../dist/target-model/types/carriers/producer-errors.js";


import { rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph }
  from "../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";

function fixture(text, options = {}) {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": text }, ...options });
  const checkedSource = createTargetSourceProgram(checked);
  const guardedAst = Proxy.revocable(checkedSource.ast, {});
  const source = { ...checkedSource, ast: guardedAst.proxy };
  const storage = createSourceStorageQuery(source, program.sourceFiles);
  const participation = sourceNodesOutsideErasedSubtrees(source.ast, storage.nodes,
    node => program.records.nativeParticipation.get(node) === "erased");
  assert.equal(participation.kind, "resolved", "the checked source has complete native participation");
  const nativeNodes = participation.nodes;
  const nativeNodeSet = new Set(nativeNodes);
  const genericRegistry = createRustGenericCallablePlan(source.ast, program.sourceFiles, program.records, program.names, source.navigation,
    node => nativeNodeSet.has(node));
  const generic = genericRegistry.plan;
  let physical;
  const input = { ast: source.ast, storage, nativeNodes, records: program.records, definitions: program.typeDefinitions,
    structuralShapes: program.structuralShapes,
    generic, lexicalFunctions: program.lexicalFunctions, lifetimes: program.sourceLifetimes,
    physicalCarrierFor: (carrier, ownerFileName, producers) => physical.carrierFor(carrier, ownerFileName, producers) };
  const native = createRustNativeCallableInputPlan({ ...input, sourcePackages: program.host.sourcePackages, usedNames: new Set() });
  const producers = createRustNativeCallableProducerPlan({ ...input, native, nodes: nativeNodes,
    returnCarrierFor: declaration => {
      const selected = queries.returnFor(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  producers.selectConstructionErrors(new Map());
  input.producers = producers;
  const guardedQueries = Proxy.revocable(createRustNativeStorageQueries({ ...input, native }), {});
  const queries = guardedQueries.proxy;
  const captures = createRustNativeCapturePlan({ ...input, nativeStorage: queries });
  physical = genericRegistry.initializePhysical({ ...input, native, captures,
    boundSubjectFor: (subject, carrier, bindings) => queries.boundSubjectFor(subject, carrier, bindings) });
  const plan = finalizeRustNativeParameterStorage(input, queries);
  const declaration = name => storage.nodes.find(node => source.ast.name(node) !== undefined &&
    source.ast.text(source.ast.name(node)) === name &&
    (source.ast.is.IsFunctionDeclaration(node) || source.ast.is.IsVariableDeclaration(node) ||
      source.ast.is.IsPropertySignatureDeclaration(node)));
  const initializer = name => Node_Initializer(source.ast, declaration(name));
  const exactSubject = (node, kind, projection) => {
    const selected = kind === undefined ? storage.subjectFor(node) : storage.subject(node, kind, projection);
    assert.equal(selected.kind === "resolved", true, selected.reason ?? "owned storage subject");
    return selected.subject;
  };
  return { program, source, storage, input, native, plan, declaration, initializer, exactSubject,
    revokeSource: guardedAst.revoke, revokeQueries: guardedQueries.revoke };
}

test("finalized formal ABI storage is a stable owned lookup without caller carrier arbitration", () => {
  const current = fixture("export function read(value: number): number { return value; }");
  const owner = current.declaration("read");
  const parameter = current.source.ast.parameters(owner)[0];
  const selected = current.plan.parameterFor(parameter);
  assert.equal(selected.kind, "identity");
  assert.equal(selected.carrier === current.program.records.sourceParameterAbi.get(parameter).parameterCarrier, true);
  assert.equal(current.plan.parameterFor(parameter) === selected, true);
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(current.plan.parameterFor.length, 1, "the formal ABI owner supplies the carrier");
});

test("finalized formal ABI storage never inspects revoked source or fabricates foreign parameters", () => {
  const current = fixture("export function read(value: number): number { return value; }");
  const owner = current.declaration("read");
  const parameter = current.source.ast.parameters(owner)[0];
  current.revokeSource();
  current.revokeQueries();
  const selected = current.plan.parameterFor(parameter);
  assert.equal(current.plan.parameterFor(parameter) === selected, true);
  assert.equal(selected.kind, "identity");
  const missing = current.plan.parameterFor(owner);
  assert.equal(missing.kind, "unresolved");
  assert.equal(current.plan.parameterFor({}) === missing, true);
  assert.equal(Object.isFrozen(missing), true);
});

test("closed native generic queries validate ownership without manufacturing unused activations", () => {
  const current = fixture("export function closed(): number { return 7; }");
  const declaration = current.declaration("closed");
  const selected = current.plan.genericBindingsFor(declaration, current.storage.emptyBindings);
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.bindings.types.size + selected.bindings.lifetimes.size + selected.bindings.consts.size, 0);
  assert.equal(current.plan.genericBindingsFor(declaration, { ...current.storage.emptyBindings }).kind, "unresolved",
    "an empty-looking fabricated scope cannot acquire ownership");
  assert.equal(current.plan.genericBindingsFor({ ...declaration }, current.storage.emptyBindings).kind, "unresolved",
    "an equal-looking declaration cannot acquire source identity");
});

function selected(value, implementation, label) {
  assert.equal(value.kind === "selected", true, value.reason ?? label);
  assert.equal(value.carrier === implementation, true, label);
  assert.equal(value.inputs.length, 1, label);
  assert.equal(value.inputs[0].implementation === implementation, true, label);
  assert.equal(Object.isFrozen(value) && Object.isFrozen(value.inputs), true, "immutable exact selection");
}

test("physical forwarding preserves distinct equal-signature inputs through aliases and return", () => {
  const current = fixture(`
    export function choose(left: () => number, right: () => number): () => number {
      const first = left; const second = right; return first;
    }
  `);
  const owner = current.declaration("choose");
  const inputs = current.native.inputsFor(owner);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].implementation !== inputs[1].implementation, true);
  for (const [index, name] of ["first", "second"].entries()) {
    selected(current.plan.valueFor(current.declaration(name)), inputs[index].implementation, name);
    selected(current.plan.valueFor(current.initializer(name)), inputs[index].implementation, `${name} expression`);
  }
  selected(current.plan.returnFor(owner), inputs[0].implementation, "annotated return retains physical input");
});

test("physical forwarding crosses package calls without a recipient error or concrete caller closure", () => {
  const source = `
    import { forwarded } from "@acme/forward";
    export class RootFailure extends Error { code = 11; }
    export function pair(left: () => number, right: () => number): () => number {
      const first = forwarded(left); const second = forwarded(right); return second;
    }
  `;
  const current = fixture(source, { surfaces: ["js"], sourcePackages: sourcePackageCallbackErrorGraph,
    files: { ...sourcePackageCallbackErrorFiles, "index.ts": source } });
  for (const name of ["retain", "forwarded"]) {
    const owner = current.declaration(name);
    selected(current.plan.returnFor(owner), current.native.inputsFor(owner)[0].implementation, `${name} local input`);
  }
  const owner = current.declaration("pair");
  const inputs = current.native.inputsFor(owner);
  for (const [index, name] of ["first", "second"].entries()) {
    selected(current.plan.valueFor(current.declaration(name)), inputs[index].implementation, name);
    selected(current.plan.invocationReturnFor(current.declaration("forwarded"), current.initializer(name)),
      inputs[index].implementation, `${name} exact invocation substitution`);
    const targetInput = current.native.inputsFor(current.declaration("forwarded"))[0];
    selected(current.plan.invocationInputFor(targetInput, current.initializer(name)),
      inputs[index].implementation, `${name} cross-package input substitution`);
    assert.equal(targetInput.protocol.identity !== inputs[index].protocol.identity, true,
      "input transport does not assert protocol identity across declarations");
  }
  selected(current.plan.returnFor(owner), inputs[1].implementation, "second remains independent");
  const wrong = current.plan.invocationReturnFor(current.declaration("retain"), current.initializer("first"));
  assert.equal(wrong.kind, "unresolved", "an unselected implementation cannot supply the call result");
});

test("invocation input forwarding binds exact callee inputs rather than caller signatures", () => {
  const current = fixture(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(left: () => number, right: () => number): number {
      const first = invoke(left); const second = invoke(right); return first + second;
    }
    export function concrete(): number { const supplied = invoke(() => 7); return supplied; }
  `);
  const callee = current.native.inputsFor(current.declaration("invoke"))[0];
  const inputs = current.native.inputsFor(current.declaration("forward"));
  for (const [index, name] of ["first", "second"].entries()) {
    const value = current.plan.invocationInputFor(callee, current.initializer(name));
    assert.equal(value.kind, "selected", value.reason);
    assert.equal(value.inputs.length, 1);
    assert.equal(value.inputs[0] === inputs[index], true, "exact caller input preserved");
    assert.equal(value.carrier.kind, "reference", "callee's nonretaining borrowed input ABI preserved");
    assert.equal(value.carrier.referent === inputs[index].implementation, true, name);
    assert.equal(value.carrier.mutable, callee.carrier.mutable);
    assert.equal(value.carrier.lifetime === callee.carrier.lifetime, true);
    assert.equal(inputs[index].protocol === callee.protocol, true, "identical native contracts reuse their canonical trait");
    assert.equal(inputs[index].implementation.identity !== callee.implementation.identity, true,
      "contract interning never merges distinct caller and callee input identities");
  }
  const supplied = current.plan.invocationInputFor(callee, current.initializer("supplied"));
  assert.equal(supplied.kind, "selected", "concrete producer has its sealed physical error channel");
  assert.equal(supplied.inputs.length, 0, "a concrete producer is never rebranded as a formal input");
  const produced = rustCallablePhysicalSignature(supplied.carrier.referent);
  assert.equal(produced !== undefined, true, "concrete producer has the canonical exact callable signature");
  const error = rustProducerErrorReference(produced.error);
  assert.equal(error.channel, "invoke");
  assert.equal(current.input.producers.forIdentity(error.identity).declaration ===
    current.source.ast.arguments(current.initializer("supplied"))[0], true);
  assert.equal(current.plan.invocationInputFor(inputs[0], current.initializer("first")).kind, "unresolved",
    "input must belong to the invocation's exact selected implementation");
  let getterReads = 0;
  const forged = Object.defineProperty({}, "owner", { get() { getterReads += 1; return callee.owner; } });
  assert.equal(current.plan.invocationInputFor(forged, current.initializer("first")).kind, "unresolved");
  assert.equal(current.plan.invocationInputFor({ ...callee }, current.initializer("first")).kind, "unresolved");
  assert.equal(getterReads, 0, "a forged input token cannot execute accessors");
});

test("invocation input forwarding applies exact selected generic arguments without changing logical contracts", () => {
  const current = fixture(`
    export function retain<Value>(callback: () => Value): () => Value { return callback; }
    export function invoke(callback: () => number): () => number { const output = retain(callback); return output; }
  `);
  const callee = current.native.inputsFor(current.declaration("retain"))[0];
  const caller = current.native.inputsFor(current.declaration("invoke"))[0];
  const logical = callee.carrier;
  selected(current.plan.invocationInputFor(callee, current.initializer("output")), caller.implementation,
    "instantiated selected input preserves physical caller identity");
  selected(current.plan.invocationReturnFor(callee.owner, current.initializer("output")), caller.implementation,
    "instantiated selected result preserves physical caller identity");
  assert.equal(callee.carrier === logical, true, "declaration-local logical signature is not specialized in place");
});

test("physical captured forwarding retains outer inputs without mistaking a new closure for them", () => {
  const current = fixture(`
    export function capture(left: () => number, right: () => number): () => () => number {
      return () => { const captured = right; return captured; };
    }
  `);
  const owner = current.declaration("capture");
  const inputs = current.native.inputsFor(owner);
  const closure = current.storage.nodes.find(node => current.source.ast.is.IsArrowFunction(node));
  selected(current.plan.valueFor(current.declaration("captured")), inputs[1].implementation, "captured exact outer input");
  selected(current.plan.returnFor(closure), inputs[1].implementation, "nested return retains capture binding");
  const outward = current.plan.returnFor(owner);
  assert.equal(outward.kind, "selected", "concrete closure retains a sealed producer-owned signature");
  const callable = rustCallablePhysicalSignature(outward.carrier);
  assert.equal(callable !== undefined, true, "returned closure has the canonical exact callable signature");
  assert.equal(callable.result === inputs[1].implementation, true,
    "returned captured callback retains its exact physical input, not a logical runtime signature");
});

test("physical member and array reads use exact projected owner identities", () => {
  const current = fixture(`
    interface Callback { (): number; }
    interface Holder<Value> { readonly callback: Value; }
    export function project(left: Holder<Callback>, right: Holder<Callback>, many: Callback[]): Callback {
      const first = left.callback; const second = right.callback; const element = many[0]; return second;
    }
  `);
  const owner = current.declaration("project");
  const parameters = current.source.ast.parameters(owner);
  const inputs = current.native.inputsFor(owner);
  for (const [index, name] of ["first", "second", "element"].entries()) {
    const input = inputs.find(value => value.subject.node === parameters[index]);
    assert.equal(input !== undefined, true, `${name} has exact projected input`);
    selected(current.plan.valueFor(current.declaration(name)), input.implementation, name);
    const subject = current.exactSubject(current.initializer(name));
    const carrier = current.program.records.runtimeCarrier.get(current.declaration(name)).carrier;
    selected(current.plan.subjectFor(subject, carrier, owner), input.implementation, `${name} public subject query`);
    assert.equal(input.subject.projection[0].kind, index === 2 ? "array-element" : "member");
    if (index !== 2) assert.equal(input.subject.projection[0].declaration === current.declaration("callback"), true);
  }
  assert.equal(inputs[0].implementation !== inputs[1].implementation, true, "field spelling is not owner identity");
});

test("physical selection preserves optional topology and borrowed parameter lifetime", () => {
  const current = fixture(`
    export function maybe(callback: (() => number) | undefined): (() => number) | undefined {
      const optional = callback; return optional;
    }
    export function invoke(callback: () => number): number { return callback(); }
  `);
  const owner = current.declaration("maybe");
  const input = current.native.inputsFor(owner)[0];
  for (const value of [current.plan.returnFor(owner), current.plan.valueFor(current.declaration("optional"))]) {
    assert.equal(value.kind, "selected", value.reason);
    assert.equal(rustOptionElementCarrier(value.carrier) === input.implementation, true);
    assert.equal(value.carrier.kind, input.carrier.kind, "native option topology retained");
    assert.equal(value.carrier.sourceAbsence, input.carrier.sourceAbsence, "one native absence state retained");
    assert.equal(Object.isFrozen(value.carrier.genericArguments), true);
  }
  const borrowedOwner = current.declaration("invoke");
  const parameter = current.source.ast.parameters(borrowedOwner)[0];
  const abi = current.program.records.sourceParameterAbi.get(parameter);
  const borrowed = current.plan.subjectFor(current.exactSubject(parameter, "input"), abi.parameterCarrier, borrowedOwner);
  assert.equal(borrowed.kind, "selected", borrowed.reason);
  assert.equal(borrowed.carrier.kind, abi.parameterCarrier.kind);
  assert.equal(borrowed.carrier.referent === current.native.inputsFor(borrowedOwner)[0].implementation, true);
  assert.equal(borrowed.carrier.lifetime === abi.parameterCarrier.lifetime, true, "exact selected loan, not a recreated lifetime");
  assert.equal(borrowed.carrier.mutable, abi.parameterCarrier.mutable);
});

test("physical tuple and array transport reuses exact existing component inputs", () => {
  const current = fixture(`
    interface Callback { (): number; }
    export function tuple(callbacks: [Callback, Callback]): [Callback, Callback] {
      const left = callbacks[0]; const right = callbacks[1]; return callbacks;
    }
    export function array(callbacks: Callback[]): Callback[] {
      const item = callbacks[0]; return callbacks;
    }
  `);
  const tuple = current.declaration("tuple");
  const members = current.native.inputsFor(tuple);
  const pair = current.plan.returnFor(tuple);
  assert.equal(pair.kind, "selected", pair.reason);
  assert.equal(pair.carrier.kind, "tuple");
  assert.equal(pair.inputs.length, 2);
  for (const [index, element] of pair.carrier.elements.entries()) {
    const member = members.find(input => input.subject.projection[0]?.kind === "tuple-element" &&
      input.subject.projection[0].index === index);
    assert.equal(member !== undefined && element === member.implementation, true, `tuple component ${index}`);
  }
  const array = current.declaration("array");
  const list = current.plan.returnFor(array);
  assert.equal(list.kind, "selected", list.reason);
  assert.equal(list.carrier.kind, "array");
  assert.equal(list.carrier.element === current.native.inputsFor(array)[0].implementation, true);
});

test("physical generic callable forwarding retains its quantified contract", () => {
  const current = fixture(`
    interface Identity { <Value>(value: Value): Value; }
    export function retain(callback: Identity): Identity { const alias = callback; return alias; }
  `);
  const owner = current.declaration("retain");
  const input = current.native.inputsFor(owner)[0];
  assert.equal(input.protocol.signature.typeParameters.length, 1);
  selected(current.plan.returnFor(owner), input.implementation, "quantified identity preserved");
  selected(current.plan.valueFor(current.declaration("alias")), input.implementation, "generic alias physical identity");
});

test("concrete quantified producers retain the existing sealed family through aliases and returns", () => {
  const current = fixture(`
    type Identity = <Value>(value: Value) => Value;
    export function make(): Identity {
      const original = <Value>(value: Value): Value => value;
      const alias: Identity = original;
      return alias;
    }
  `);
  for (const value of [current.plan.returnFor(current.declaration("make")),
    current.plan.valueFor(current.declaration("original")), current.plan.valueFor(current.declaration("alias"))]) {
    assert.equal(value.kind, "selected", value.reason);
    const definition = current.input.generic.physical.definitionFor(value.carrier);
    const implementation = current.input.generic.implementationFor(current.initializer("original"));
    assert.equal(definition !== undefined && implementation !== undefined && definition.members.length === 1 &&
      definition.members[0].implementation === implementation, true,
      "only the exact existing producer family is retained");
  }
  const unavailable = createRustNativeStorageQueries({ ...current.input, native: current.native,
    physicalCarrierFor: () => undefined });
  assert.equal(unavailable.returnFor(current.declaration("make")).kind, "unresolved",
    "signature equality cannot substitute for a missing producer identity");
});

test("physical selection rejects ambiguous mutation alternatives and seals concrete producers", () => {
  const current = fixture(`
    export function choose(left: () => number, right: () => number): () => number {
      left = right; const selected = left; return selected;
    }
    export function create(): () => number { return () => 7; }
    export function concrete(): () => number { const supplied = create(); return supplied; }
  `);
  for (const result of [current.plan.returnFor(current.declaration("choose")),
    current.plan.valueFor(current.declaration("selected"))])
    assert.equal(result.kind, "unresolved", "no signature-based choice, closed error guess, or silent fallback");
  const created = current.plan.returnFor(current.declaration("create"));
  const returned = current.plan.invocationReturnFor(current.declaration("create"), current.initializer("supplied"));
  assert.equal(created.kind, "selected");
  assert.equal(returned.kind, "selected");
  assert.deepEqual(returned.carrier, created.carrier, "one exact producer survives the selected return boundary");
  const callable = rustCallablePhysicalSignature(created.carrier);
  assert.equal(callable !== undefined, true, "created closure has the canonical exact callable signature");
  assert.equal(rustProducerErrorReference(callable.error).channel, "invoke");
});

test("physical storage validates token ownership, exact contracts and finite projection budgets", () => {
  const source = `export function identity(callback: () => number): () => number { const alias = callback; return alias; }`;
  const current = fixture(source);
  const foreign = fixture(source);
  const owner = current.declaration("identity");
  const input = current.native.inputsFor(owner)[0];
  const subject = current.exactSubject(current.declaration("alias"));
  let getterReads = 0;
  const forged = Object.defineProperty({}, "node", { get() { getterReads += 1; return subject.node; } });
  for (const candidate of [forged, { ...subject }, foreign.exactSubject(foreign.declaration("alias"))])
    assert.equal(current.plan.subjectFor(candidate, input.carrier, owner).kind, "unresolved");
  assert.equal(getterReads, 0, "foreign shape cannot execute a getter");
  assert.equal(current.plan.returnFor(foreign.declaration("identity")).kind, "unresolved");
  assert.equal(current.plan.subjectFor(subject, input.carrier, foreign.declaration("identity")).kind, "unresolved");
  const mismatched = rustCallableTargetType([], rustSourcePrimitiveTargetType("bool"));
  assert.equal(current.plan.subjectFor(subject, mismatched, owner).kind, "unresolved", "equal arity cannot substitute a different signature");
  const otherPlan = createRustNativeStorageQueries({ ...current.input, native: foreign.native });
  assert.equal(otherPlan.returnFor(owner).kind, "unresolved", "another native plan cannot mint this graph's input identity");
  const limited = createRustNativeStorageQueries({ ...current.input, native: current.native, storage: {
    ...current.storage, boundValueFrontierFor() { return { kind: "resolved",
      frontier: Array(4097).fill({ kind: "origin", subject: input.subject, bindings: current.storage.emptyBindings }) }; },
  } });
  const rejected = limited.returnFor(owner);
  assert.equal(rejected.kind, "unresolved");
  assert.match(rejected.reason, /budget/u);
});

test("non-callable storage remains an exact identity without inspecting unrelated origins", () => {
  const current = fixture(`export function number(value: number): number { const selected = value; return selected; }`);
  let originQueries = 0;
  const plan = createRustNativeStorageQueries({ ...current.input, native: current.native, storage: {
    ...current.storage, boundOriginsFor() { originQueries += 1; throw new Error("non-callable origin scan"); },
    boundValueFrontierFor() { originQueries += 1; throw new Error("non-callable frontier scan"); },
  } });
  const owner = current.declaration("number");
  const value = plan.valueFor(current.declaration("selected"));
  assert.equal(value.kind, "identity");
  assert.equal(value.carrier === current.program.records.runtimeCarrier.get(current.declaration("selected")).carrier, true);
  assert.equal(plan.returnFor(owner).kind, "identity");
  assert.equal(originQueries, 0);
});

test("structural native dispatch signatures are not stored callable payloads and require exact field ownership", () => {
  const current = fixture(`
    interface Box { readonly value: number; }
    interface Factory { new(value: number): Box; accepts(value: number): boolean; }
    class Value implements Box {
      readonly value: number;
      constructor(value: number) { this.value = value; }
      static accepts(value: number): boolean { return value >= 0; }
    }
    export function run(): boolean {
      const selected: Factory = Value;
      return new selected(3).value === 3;
    }
  `);
  const value = current.declaration("selected");
  assert.equal(current.plan.valueFor(value).kind, "identity", "the native dispatch layout already owns its signatures");
  for (const [name, field] of [
    ["missing", () => undefined],
    ["stored", (carrier, index) => {
      const selected = current.input.structuralShapes.field(carrier, index);
      return selected === undefined ? undefined : { ...selected, nativeMethod: undefined, methodStorageCarrier: undefined };
    }],
  ]) {
    const plan = createRustNativeStorageQueries({ ...current.input, native: current.native, structuralShapes: { field } });
    const selected = plan.valueFor(value);
    assert.equal(selected.kind, "unresolved", name);
    assert.match(selected.reason, /layout owner/u, name);
  }
});
