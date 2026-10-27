import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { analyzeRustNativeCallableGenerics } from "../../../../dist/analysis/callables/native/native-inputs.js";
import { selectRustCallableEntryGenerics } from "../../../../dist/analysis/callables/emission/entry-generics.js";
import { createRustNativeGenericProducer } from "../../../../dist/analysis/program/records/native/native-generics.js";
import { planRustNativeCallableGenerics } from "../../../../dist/backend/planner/declarations/callables/native-generics.js";
import { selectRustCallableEntryHeader } from "../../../../dist/policy/ownership/callable-entry-headers.js";
import { rustCallablePayloadContext } from "../../../../dist/backend/planner/expressions/capture-payloads.js";

// Native callable generic contexts are selected by analyzeRustNativeCallableGenerics (inputs, bounds and Future
// environments) and sealed as records.nativeGenerics; planRustNativeCallableGenerics names and substitutes them.
// Each case compiles a real program; a case that needs an analysis query in a specific state replaces only that
// query of the real program.
const header = 'import type { int32 } from "@tsonic/core/types.js";\n';

function declarationNamed(program, name) {
  const { ast } = program.source;
  let declaration;
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node) && program.records.sourceName.get(node) === name) declaration = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(declaration !== undefined, true, `the authored ${name} declaration`);
  return declaration;
}

function fixture(body, name) {
  const { program } = analyzeRust({ files: { "index.ts": header + body } });
  return { program, declaration: declarationNamed(program, name) };
}

function seal({ program, declaration }, replace = {}) {
  const producer = createRustNativeGenericProducer(() => {});
  const values = program.callableValues;
  const native = { ...values.native, ...replace.native };
  const nativeStorage = { ...values.nativeStorage, prepareReturn: values.nativeStorage.returnFor, ...replace.nativeStorage };
  const headers = new Map();
  for (const selected of values.nativeProducers.producers) {
    const result = selectRustCallableEntryGenerics({ source: program.source, ast: program.source.ast,
      lifetimes: program.sourceLifetimes, records: program.records, nativeStorage, native,
      nativeProducers: values.nativeProducers }, selected.declaration);
    if (result.kind === "rejected") return { result, selected: undefined, program };
    headers.set(selected.declaration, result.value);
  }
  const callableEntries = { get: node => {
    const selected = program.records.callableLeading.get(node);
    return selected === undefined ? undefined : { ...selected, genericHeader: headers.get(node) };
  } };
  const result = analyzeRustNativeCallableGenerics({ ast: program.source.ast,
    records: program.records, callableEntries, producer, native,
    nativeStorage, nativeProducers: values.nativeProducers,
    nativeGenericProducers: values.nativeGenericProducers, retainedCallableInputs: program.retainedCallableInputs,
    declarationGenericRequirements: program.declarationGenericRequirements });
  return { result, selected: producer.records.get(declaration),
    program: { ...program, records: { ...program.records, nativeGenerics: producer.records } } };
}

function generics(current, sealed, substitutions, typeParameterNames) {
  const context = rustSourceFilePlanContext(sealed.program, current.declaration, {
    ...(substitutions === undefined ? {} : { typeParameterSubstitutions: substitutions }),
    ...(typeParameterNames === undefined ? {} : { typeParameterNames }) });
  const selection = selectRustCallableEntryHeader({ header: sealed.selected, requirements: sealed.selected.sourceRequirements,
    inherited: { types: substitutions ?? new Map(), lifetimes: new Map(), consts: new Map() },
    ownerLifetimes: new Set(), capturedParameters: [], specialization: undefined, promiseBody: false,
    enclosingArguments: [], trailingArguments: [], finalArguments: undefined });
  const source = { context, selection, sourceTypeParameterIdentities: [], preservesExplicitLifetimes: false, parameterSlots: new Map(),
    finalizeGenerics: () => ({ parameters: [], wherePredicates: [] }) };
  return planRustNativeCallableGenerics(current.declaration, source).finalizeGenerics();
}

const invoked = "function inner(first: () => int32): int32 { return first(); }\n" +
  "export function outer(first: () => int32): int32 { return inner(first) + 1; }";
const protocol = /^crate::index::NativeCallable_[0-9a-f]+$/u;

test("native generic emission consumes the exact early header without selecting its membership again", () => {
  const { program, declaration } = fixture(invoked, "inner");
  const header = program.records.callableLeading.get(declaration)?.genericHeader;
  const published = program.records.nativeGenerics.get(declaration);
  assert.equal(header !== undefined && published !== undefined, true, "the actual checked declaration owns both completed stages");
  assert.equal(Object.isFrozen(header), true, "early header data is immutable");
  assert.equal(header.sourceContract === published.sourceContract, true, "native source binder ownership is shared exactly");
  assert.equal(header.implicitLifetimes === published.implicitLifetimes, true, "implicit lifetime membership is not selected again");
  assert.equal(header.retention === published.retention, true, "source and native-body retained lifetimes use one selected plan");
  assert.equal(Object.isFrozen(header.inputs) && Object.isFrozen(header.callableInputs), true,
    "original native input membership is immutable before later bounds completion");
  assert.equal(header.inputs.length === published.inputs.length && header.inputs.every((input, index) =>
    input.implementation === published.inputs[index].implementation), true,
  "late bounds preserve the exact early ordered implementation identities");
  const values = program.callableValues;
  const producer = createRustNativeGenericProducer(() => {});
  const nativeStorage = { returnFor: values.nativeStorage.returnFor, valueFor: values.nativeStorage.valueFor };
  Object.defineProperty(nativeStorage, "futureEnvironmentFor", { get() {
    assert.fail("late generic bounds must not request a second header membership decision");
  } });
  const result = analyzeRustNativeCallableGenerics({ ast: program.source.ast, records: program.records, producer,
    callableEntries: program.records.callableLeading,
    native: { ...values.native,
      inputsFor() { assert.fail("late generic bounds must not select native input membership again"); },
      capturesFor() { assert.fail("late generic bounds must not select native capture membership again"); } },
    nativeStorage, nativeProducers: values.nativeProducers,
    nativeGenericProducers: values.nativeGenericProducers, retainedCallableInputs: program.retainedCallableInputs,
    declarationGenericRequirements: program.declarationGenericRequirements });
  assert.equal(result.kind, "resolved", "later requirements and bounds consume the completed early header");
  assert.equal(producer.records.get(declaration)?.sourceContract === header.sourceContract, true,
    "repeated emission preserves the original selected source contract identity");
});

test("native generic implementation parameters are not redeclared after exact environment substitution", () => {
  const current = fixture(invoked, "inner");
  const sealed = seal(current);
  const [input] = sealed.selected.inputs;
  // The environment substitutes the caller's implementation (outer's own input) for inner's.
  const capture = sealed.program.records.nativeGenerics.get(declarationNamed(sealed.program, "outer")).inputs[0].implementation;
  assert.notEqual(capture.identity, input.implementation.identity);
  const selected = generics(current, sealed, new Map([[input.implementation.identity, capture]]),
    new Map([[capture.identity, "Captured"]]));
  assert.equal(selected.parameters.length, 0);
  assert.equal(selected.wherePredicates.length, 1);
  assert.equal(selected.wherePredicates[0].type.path, "Captured");
  assert.match(selected.wherePredicates[0].bounds[0].reference.trait.path, protocol);
});

test("unsubstituted native input still declares its own exact generic parameter", () => {
  const current = fixture(invoked, "inner");
  const selected = generics(current, seal(current));
  assert.equal(selected.parameters.length, 1);
  assert.equal(selected.parameters[0].name, "Implementation0");
  assert.equal(selected.parameters[0].bounds.length, 1);
  assert.equal(selected.wherePredicates.length, 0);
});

for (const [position, body, name] of [
  ["return", "export function pass(first: () => int32): () => int32 { return first; }", "pass"],
  ["conversion", "export function convert(first: () => int32): (value: int32) => int32 { return first; }", "convert"],
]) {
  test(`native generic bounds include associated types in physical ${position} storage without an authored call`, () => {
    const current = fixture(body, name);
    const sealed = seal(current);
    const selected = generics(current, sealed);
    assert.equal(selected.parameters.length, 1);
    assert.equal(selected.parameters[0].bounds.length, 1);
    assert.match(selected.parameters[0].bounds[0].reference.trait.path, protocol);
    const unresolved = () => ({ kind: "unresolved", reason: "missing exact physical selection" });
    const rejected = seal(current, { nativeStorage: { returnFor: unresolved, valueFor: unresolved } });
    assert.equal(rejected.result.kind, "rejected", "unresolved physical requirements cannot silently omit the native bound");
    assert.equal(rejected.selected === undefined, true);
  });
}

test("native generic bounds do not invent obligations for unused inputs", () => {
  const current = fixture("export function unused(first: () => int32): int32 { return 1; }", "unused");
  const sealed = seal(current);
  const [input] = current.program.callableValues.native.inputsFor(current.declaration);
  const selected = generics(current, sealed);
  assert.equal(selected.parameters.length, 1, "the original declared callable remains one native implementation");
  assert.equal(sealed.selected.inputs[0].implementation.identity, input.implementation.identity);
  assert.deepEqual(selected.parameters[0].bounds.map(bound => bound.kind === "trait-type"
    ? bound.reference.trait.path : bound.kind), [`crate::index::${input.trait.path}`],
  "only the exact declared callable protocol is required; unused inputs gain no Clone, Copy, Future or lifetime bound");
  assert.equal(selected.wherePredicates.length, 0, "an unused callable creates no extra associated obligations");
});

const futureFirst = { implementation: { kind: "type-parameter", identity: "future:first", name: "Future0" } };
const futureSecond = { implementation: { kind: "type-parameter", identity: "future:second", name: "Future0" } };
function futureOnly(current, environment) {
  return seal(current, { native: { inputsFor: () => [], capturesFor: () => [], callFor: () => undefined },
    nativeStorage: { futureEnvironmentFor: declaration => declaration === current.declaration ? environment
      : current.program.callableValues.nativeStorage.futureEnvironmentFor(declaration) } });
}

test("unobserved Future inputs and captures declare exact implementation parameters without callable or output bounds", () => {
  const current = fixture(invoked, "inner");
  const selected = generics(current, futureOnly(current, { kind: "resolved", inputs: [futureFirst], captures: [futureFirst, futureSecond] }));
  assert.equal(selected.parameters.length, 2, "a repeated input capture remains one exact implementation");
  assert.equal(new Set(selected.parameters.map(parameter => parameter.name)).size, 2, "independent inputs cannot share a generated name");
  assert.equal(selected.parameters.every(parameter => parameter.bounds.length === 0), true, "transport does not impose Future<Output=Result<T,E>>");
  assert.equal(selected.wherePredicates.length, 0);
});

test("substituted Future captures are not redeclared or constrained merely for transport", () => {
  const current = fixture(invoked, "inner");
  const captured = { implementation: { kind: "type-parameter", identity: "future:captured", name: "Future0" } };
  const selected = generics(current, futureOnly(current, { kind: "resolved", inputs: [], captures: [captured] }),
    new Map([["future:captured", { kind: "type-parameter", identity: "outer", name: "Outer" }]]));
  assert.equal(selected.parameters.length, 0);
  assert.equal(selected.wherePredicates.length, 0);
});

test("unresolved Future environments reject without silently omitting implementation parameters", () => {
  const current = fixture(invoked, "inner");
  const rejected = futureOnly(current, { kind: "unresolved", reason: "missing exact capture identity" });
  assert.equal(rejected.result.kind, "rejected");
  assert.equal(rejected.selected === undefined, true);
});

test("callable payload bindings retain exact selected physical carriers without changing capture storage", () => {
  const current = fixture(invoked, "inner");
  const sealed = seal(current);
  const logical = { kind: "source-primitive", name: "float64" };
  const physical = sealed.selected.inputs[0].implementation;
  const capture = { declaration: {}, reference: {}, carrier: logical, storageCarrier: physical, storage: "value" };
  const selected = rustCallablePayloadContext({ captures: [capture], receiverFields: [], receivers: [] },
    { kind: "path", path: "environment" }, rustSourceFilePlanContext(sealed.program, current.declaration), "named");
  assert.equal(selected.capturedBindings[0].valueCarrier === physical, true);
  assert.equal(selected.capturedBindings[0].storage, capture.storage);
  assert.equal(selected.capturedBindings[0].declaration === capture.declaration, true);
  assert.equal(capture.carrier === logical, true);
});
