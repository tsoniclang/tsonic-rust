import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustCarrierProbe } from "../../../../dist/analysis/program/carrier-probe.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { recordProjectSourceBinding } from "../../../../dist/analysis/storage/source-bindings.js";
import { resolveIdentifierCarrier } from "../../../../dist/analysis/source-evidence/types/resolution/references.js";
import { recordExportAssignmentFacts } from "../../../../dist/analysis/control-flow/statements.js";
import { finalizeRustCallableSignature } from "../../../../dist/analysis/callables/calls/signature-query.js";
import { recordPredeclaredNativeFunctionBindingFacts } from "../../../../dist/analysis/callables/calls/signatures.js";
import { recordRustIndexedCallKeyArguments } from "../../../../dist/analysis/operations/indexed-call-keys.js";
import { rustUnitTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourceCallableValueEquals } from "../../../../dist/target-model/records/operations/equality.js";

function isolate(current, readers) {
  const probe = createRustCarrierProbe(current.walk);
  const records = createRustProgramRecordBuilder(undefined, createRustRecordFixture(readers, current.context.records));
  return { ...probe, context: { ...probe.context, records } };
}

function identifierRetryFixture() {
  const input = analyzeRustOperations(`
    function identity(): number { return 3; }
    export const callback: () => number = identity;
  `, { surfaces: [] });
  const { ast } = input.context;
  const declaration = input.context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node));
  assert.equal(declaration !== undefined, true);
  const reference = input.context.sourceStorage.nodes.find(node => ast.is.IsIdentifier(node) &&
    node !== ast.name(declaration) && input.context.source.navigation.sourceReferenceFor(node)?.declaration === declaration);
  assert.equal(reference !== undefined, true);
  const sourceFile = ast.getSourceFile(reference);
  assert.equal(sourceFile !== undefined, true);
  const module = input.context.records.moduleBinding.get(declaration);
  assert.equal(module?.storage, "native-callable");
  assert.equal(module.value !== undefined, true, "the checked fixture observes the function value");
  assert.equal(input.context.source.navigation.declarationUseSummary(declaration).bindingWritten, false);
  return { input, declaration, reference, sourceFile };
}

test("identifier carrier waits for an actual callable owner without reconstructing its admitted binding", () => {
  const { input, declaration, reference, sourceFile } = identifierRetryFixture();
  const parentCheckpoints = [[input.context.records.sourceBinding, reference],
    [input.context.records.directCallableReference, reference], [input.context.records.sourceCallableReturn, declaration],
    [input.context.records.moduleBinding, declaration], [input.context.records.runtimeCarrier, declaration],
    [input.context.records.runtimeCarrier, reference]].map(([reader, subject]) => [reader, subject, reader.get(subject)]);
  const root = createRustProgramRecordBuilder(input.context.typeDefinitions);
  const current = createRustCarrierProbe({ ...input.walk, context: { ...input.context, records: root } });
  root.seal([]);
  const records = current.context.records;
  let bindingWrites = 0;
  let moduleWrites = 0;
  let directWrites = 0;
  const walk = { ...current, context: { ...current.context, records: { ...records,
    sourceBindings: { ...records.sourceBindings, module(...args) {
      const fact = records.sourceBindings.module(...args);
      bindingWrites++;
      return fact;
    } },
    moduleBindings: { ...records.moduleBindings, function(...args) {
      records.moduleBindings.function(...args);
      moduleWrites++;
    } },
    directCallableReferences: { ...records.directCallableReferences, function(...args) {
      records.directCallableReferences.function(...args);
      directWrites++;
    } },
  } } };
  recordPredeclaredNativeFunctionBindingFacts(walk, sourceFile);
  assert.equal(records.sourceCallableReturn.get(declaration) === undefined, true, "return owner has not run");
  assert.equal(records.moduleBinding.get(declaration) === undefined, true, "module owner waits for the actual return dependency");
  assert.equal(records.runtimeCarrier.get(declaration) === undefined, true);
  assert.equal(resolveIdentifierCarrier(walk, reference, sourceFile) === undefined, true, "the actual query is pending");
  const binding = records.sourceBinding.get(reference);
  assert.equal(binding?.scope, "module");
  assert.equal(binding.sourceDeclaration === declaration, true);
  assert.equal(records.directCallableReference.get(reference) === undefined, true);
  assert.equal(records.runtimeCarrier.get(reference) === undefined, true);
  assert.deepEqual([bindingWrites, moduleWrites, directWrites], [1, 0, 0]);
  assert.equal(resolveIdentifierCarrier(walk, reference, sourceFile) === undefined, true, "an unfinished dependency remains pending");
  assert.equal(records.sourceBinding.get(reference) === binding, true);
  assert.deepEqual([bindingWrites, moduleWrites, directWrites], [1, 0, 0]);
  const completed = finalizeRustCallableSignature(walk, declaration);
  assert.equal(completed.kind, "complete");
  assert.equal(records.sourceCallableReturn.get(declaration) === completed.result, true);
  recordPredeclaredNativeFunctionBindingFacts(walk, sourceFile);
  const module = records.moduleBinding.get(declaration);
  assert.equal(module?.storage, "native-callable");
  assert.equal(module.value !== undefined, true);
  assert.equal(module.callableDeclaration === declaration, true);
  assert.equal(module.value.resultCarrier === completed.result.returnCarrier, true);
  assert.equal(resolveIdentifierCarrier(walk, reference, sourceFile) === module.value.carrier, true);
  const direct = records.directCallableReference.get(reference);
  assert.equal(direct !== undefined, true);
  assert.equal(rustSourceCallableValueEquals(direct, { form: "function", sourceDeclaration: module.callableDeclaration,
    fileName: binding.fileName, name: module.name, carrier: module.value.carrier,
    parameterCarriers: module.value.parameterCarriers, resultCarrier: module.value.resultCarrier }), true);
  assert.equal(records.sourceBinding.get(reference) === binding, true);
  assert.deepEqual([bindingWrites, moduleWrites, directWrites], [1, 1, 1]);
  assert.deepEqual(walk.context.diagnostics.map(diagnostic => diagnostic.code), []);
  const sealed = records.seal(walk.context.requiredRecords);
  assert.equal(sealed.sourceBinding.get(reference) === binding, true);
  assert.equal(sealed.directCallableReference.get(reference) === direct, true);
  assert.equal(sealed.sourceCallableReturn.get(declaration) === completed.result, true);
  for (const [reader, subject, fact] of parentCheckpoints) assert.equal(reader.get(subject) === fact, true, "checked-parent identity");
  for (const [family, subject] of [["sourceBinding", reference], ["directCallableReference", reference],
    ["sourceCallableReturn", declaration], ["moduleBinding", declaration], ["runtimeCarrier", declaration],
    ["runtimeCarrier", reference]]) assert.equal(root[family].get(subject) === undefined, true, family + ": sealed empty parent");
});

test("inherited direct callable conflict is checked on an existing source-binding hit", () => {
  const { input, declaration, reference, sourceFile } = identifierRetryFixture();
  const binding = input.context.records.sourceBinding.get(reference);
  const direct = input.context.records.directCallableReference.get(reference);
  assert.equal(binding?.scope, "module");
  assert.equal(binding.sourceDeclaration === declaration, true);
  assert.equal(direct?.form, "function");
  const incompatible = Object.freeze({ ...direct, name: direct.name + "__foreign" });
  const inherited = createRustRecordFixture({ directCallableReference: {
    get: subject => subject === reference ? incompatible : input.context.records.directCallableReference.get(subject),
  } }, input.context.records);
  const current = createRustCarrierProbe({ ...input.walk, context: { ...input.context,
    records: createRustProgramRecordBuilder(input.context.typeDefinitions, inherited) } });
  const records = current.context.records;
  let bindingWrites = 0;
  let directWrites = 0;
  const walk = { ...current, context: { ...current.context, records: { ...records,
    sourceBindings: { ...records.sourceBindings, module(...args) {
      const fact = records.sourceBindings.module(...args);
      bindingWrites++;
      return fact;
    } },
    directCallableReferences: { ...records.directCallableReferences, function(...args) {
      records.directCallableReferences.function(...args);
      directWrites++;
    } },
  } } };
  assert.equal(records.sourceBinding.get(reference) === binding, true);
  assert.throws(() => resolveIdentifierCarrier(walk, reference, sourceFile),
    /Conflicting Rust semantic plan 'tsonic\.rust\.directCallableReference'/u);
  assert.deepEqual([bindingWrites, directWrites], [0, 0]);
  assert.equal(records.sourceBinding.get(reference) === binding, true);
  assert.equal(records.directCallableReference.get(reference) === incompatible, true);
  assert.equal(input.context.records.sourceBinding.get(reference) === binding, true);
  assert.equal(input.context.records.directCallableReference.get(reference) === direct, true);
});

test("checked binding retries preserve one complete binding and admit late native callable metadata once", () => {
  const input = analyzeRustOperations(`
    function identity(value: number): number { return value; }
    export const callback: (value: number) => number = identity;
  `, { surfaces: [] });
  const { ast } = input.context;
  const declaration = input.context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node));
  const reference = input.context.sourceStorage.nodes.find(node => ast.is.IsIdentifier(node) &&
    node !== ast.name(declaration) && input.context.source.navigation.sourceReferenceFor(node)?.declaration === declaration);
  assert.equal(reference !== undefined, true);
  const selected = input.context.records.moduleBinding.get(declaration);
  assert.equal(selected?.storage, "native-callable");
  assert.equal(selected.value !== undefined, true);
  const current = isolate(input, { sourceBinding: { get: () => undefined }, moduleBinding: { get: () => undefined },
    directCallableReference: { get: () => undefined } });
  const records = current.context.records;
  let bindings = 0;
  let callables = 0;
  const walk = { ...current, context: { ...current.context, records: { ...records,
    sourceBindings: { ...records.sourceBindings, module(...args) { bindings++; return records.sourceBindings.module(...args); } },
    directCallableReferences: { ...records.directCallableReferences,
      function(...args) { callables++; return records.directCallableReferences.function(...args); } },
  } } };
  const first = recordProjectSourceBinding(walk, reference);
  assert.equal(first?.scope, "module");
  assert.equal(records.directCallableReference.get(reference) === undefined, true, "unavailable module data is not fabricated");
  assert.equal(recordProjectSourceBinding(walk, reference) === first, true, "an unfinished caller can retry its binding");
  records.moduleBindings.function(declaration, selected.name, selected.value);
  assert.equal(recordProjectSourceBinding(walk, reference) === first, true);
  const callable = records.directCallableReference.get(reference);
  assert.equal(callable?.sourceDeclaration === declaration, true);
  assert.equal(callable.carrier === selected.value.carrier, true);
  assert.equal(recordProjectSourceBinding(walk, reference) === first, true);
  assert.equal(records.directCallableReference.get(reference) === callable, true);
  assert.deepEqual([bindings, callables], [1, 1]);
  for (const changed of [{ ...first, sourceName: "foreign" }, { ...first, fileName: "/src/foreign.ts" },
    { ...first, sourceDeclaration: {} }, { scope: "lexical", sourceDeclaration: declaration, sourceName: first.sourceName }]) {
    const conflict = isolate(input, { sourceBinding: { get: node => node === reference ? changed : input.context.records.sourceBinding.get(node) } });
    assert.throws(() => recordProjectSourceBinding(conflict, reference), /Conflicting Rust semantic plan 'tsonic.rust.sourceBinding'/u);
    assert.equal(conflict.context.records.sourceBinding.get(reference) === changed, true);
  }
  assert.equal(input.context.records.sourceBinding.get(reference) === first, false, "a child cannot overwrite the parent");
  records.seal(walk.context.requiredRecords);
});

for (const reversed of [false, true]) {
  test(`default export declaration and two checked reads share one exact admission in ${reversed ? "reverse" : "forward"} file order`, () => {
    const index = 'import value from "./value.js"; export function first(): number { return value; } export function second(): number { return value; }';
    const files = reversed ? { "value.ts": "export default 7;", "index.ts": index } : { "index.ts": index, "value.ts": "export default 7;" };
    const input = analyzeRustOperations(index, { surfaces: [], files });
    const { ast } = input.context;
    const declaration = input.context.sourceStorage.nodes.find(node => ast.kindName(node) === "KindExportAssignment");
    assert.equal(declaration !== undefined, true);
    const current = isolate(input, { moduleBinding: { get: node => node === declaration ? undefined : input.context.records.moduleBinding.get(node) } });
    const records = current.context.records;
    let admissions = 0;
    const walk = { ...current, context: { ...current.context, records: { ...records,
      moduleBindings: { ...records.moduleBindings,
        defaultExport(...args) { admissions++; return records.moduleBindings.defaultExport(...args); } },
    } } };
    const first = recordExportAssignmentFacts(walk, declaration);
    assert.equal(first !== undefined, true);
    const selected = records.moduleBinding.get(declaration);
    const references = input.context.sourceStorage.nodes.filter(node => ast.is.IsIdentifier(node) &&
      ast.text(node) === "value" && ast.is.IsReturnStatement(ast.parent(node)));
    assert.equal(references.length, 2);
    for (const reference of references) assert.equal(resolveIdentifierCarrier(walk, reference, ast.getSourceFile(reference)) !== undefined, true);
    assert.equal(recordExportAssignmentFacts(walk, declaration) === first, true);
    assert.equal(records.moduleBinding.get(declaration) === selected, true);
    assert.equal(selected.storage, "module-cell");
    assert.equal(selected.declarationKind, "const");
    assert.equal(selected.initialization, "value");
    assert.equal(selected.valueCarrier === first, true);
    assert.equal(admissions, 1);
    for (const changed of [{ ...selected, declarationKind: "let" }, { ...selected, initialization: "deferred" },
      { ...selected, storage: "native-const" }, { ...selected, valueCarrier: { kind: "source-primitive", name: "uint8" } }]) {
      const conflict = isolate(input, { moduleBinding: { get: node => node === declaration ? changed : input.context.records.moduleBinding.get(node) } });
      assert.throws(() => recordExportAssignmentFacts(conflict, declaration), /Conflicting Rust semantic plan 'tsonic.rust.moduleBinding'/u);
      assert.equal(conflict.context.records.moduleBinding.get(declaration) === changed, true);
    }
    records.seal(walk.context.requiredRecords);
  });
}

test("default and explicit unit setter requests reuse a complete result instead of a second constructor", () => {
  const input = analyzeRustOperations(`
    class Box { value = 0; set current(value: number) { this.value = value; } }
    export function run(): void { const box = new Box(); box.current = 3; }
  `, { surfaces: [] });
  const declaration = input.context.sourceStorage.nodes.find(node => input.context.ast.is.IsSetAccessorDeclaration(node));
  assert.equal(declaration !== undefined, true);
  const current = isolate(input, { sourceCallableReturn: { get: node =>
    node === declaration ? undefined : input.context.records.sourceCallableReturn.get(node) } });
  const records = current.context.records;
  let admissions = 0;
  const walk = { ...current, context: { ...current.context, records: { ...records,
    sourceCallableReturns: { ...records.sourceCallableReturns,
      setter(...args) { admissions++; return records.sourceCallableReturns.setter(...args); } },
  } } };
  const first = finalizeRustCallableSignature(walk, declaration);
  assert.equal(first.kind, "complete");
  assert.equal(finalizeRustCallableSignature(walk, declaration) === first, true);
  const explicit = finalizeRustCallableSignature(walk, declaration, { selectedReturn: rustUnitTargetType() });
  assert.equal(explicit.kind === "complete" && explicit.result === first.result, true);
  assert.equal(finalizeRustCallableSignature(walk, declaration, { selectedReturn: rustUnitTargetType() }) === explicit, true);
  assert.equal(admissions, 1);
  assert.throws(() => records.sourceCallableReturns.setter(declaration), /Duplicate Rust semantic plan/u);
  const wrong = { ...first.result, canFallThrough: true };
  const conflict = isolate(input, { sourceCallableReturn: { get: node => node === declaration ? wrong : input.context.records.sourceCallableReturn.get(node) } });
  assert.throws(() => finalizeRustCallableSignature(conflict, declaration), /Conflicting Rust semantic plan 'tsonic.rust.sourceCallableReturn'/u);
  assert.equal(conflict.context.records.sourceCallableReturn.get(declaration) === wrong, true);
  records.seal(walk.context.requiredRecords);
});

test("indexed-key retries and repeated contributions preserve complete choices and one actual write", () => {
  const records = createRustProgramRecordBuilder();
  const required = [];
  const argument = {};
  const carrier = { kind: "source-primitive", name: "uint64" };
  const binding = { sourceParameterIndex: 0, sourceArgumentIndex: 0, sourceForm: "value" };
  const selected = { member: { parameters: [{ type: { kind: "type-parameter", identity: "Key", name: "Key" } }] },
    sourceArgumentBindings: [binding, { ...binding }] };
  let admissions = 0;
  let evaluations = 0;
  const counted = { ...records, indexedFieldKeys: { ...records.indexedFieldKeys,
    selected(...args) { admissions++; return records.indexedFieldKeys.selected(...args); } } };
  const evaluate = () => { evaluations++; return true; };
  assert.equal(recordRustIndexedCallKeyArguments(counted, required, selected, [argument], new Map([["Key", carrier]]), evaluate), true);
  const first = records.indexedFieldKeyArgument.get(argument);
  assert.equal(evaluations, 1, "duplicate contributions are classified once per request");
  assert.equal(recordRustIndexedCallKeyArguments(counted, required, selected, [argument], new Map([["Key", { ...carrier }]]), evaluate), true);
  assert.equal(evaluations, 2, "a new request validates its exact evaluation choice without re-publication");
  assert.equal(admissions, 1);
  assert.equal(records.indexedFieldKeyArgument.get(argument) === first, true);
  assert.equal(first.carrier === carrier && first.evaluate, true);
  assert.throws(() => records.indexedFieldKeys.selected(argument, carrier, true), /Duplicate Rust semantic plan/u);
  records.seal(required);
});

test("indexed-key retries retain the producer's exact closed metadata correspondence", () => {
  const records = createRustProgramRecordBuilder();
  const required = [];
  const argument = {};
  const carrier = { kind: "target-named", id: "acme.Key", genericArguments: [] };
  const selected = { member: { parameters: [{ type: { kind: "type-parameter", identity: "Key", name: "Key" } }] },
    sourceArgumentBindings: [{ sourceParameterIndex: 0, sourceArgumentIndex: 0, sourceForm: "value" }] };
  let admissions = 0;
  const counted = { ...records, indexedFieldKeys: { ...records.indexedFieldKeys,
    selected(...args) { admissions++; return records.indexedFieldKeys.selected(...args); } } };
  const request = (key, evaluate = true) => recordRustIndexedCallKeyArguments(counted, required, selected,
    [argument], new Map([["Key", key]]), () => evaluate);
  assert.equal(request(carrier), true);
  const first = records.indexedFieldKeyArgument.get(argument);
  assert.equal(request({ ...carrier, genericArguments: [] }), true, "distinct equal closed data remains equivalent");
  for (const changed of [{ ...carrier, errorOwner: undefined }, { ...carrier, id: "acme.OtherKey" }]) {
    assert.throws(() => request(changed), /Conflicting Rust semantic plan 'tsonic.rust.indexedFieldKeyArgument'/u);
    assert.equal(records.indexedFieldKeyArgument.get(argument) === first, true);
  }
  assert.throws(() => request(carrier, false), /Conflicting Rust semantic plan 'tsonic.rust.indexedFieldKeyArgument'/u);
  assert.equal(admissions, 1);
  assert.equal(records.indexedFieldKeyArgument.get(argument) === first, true);
  records.seal(required);
});
