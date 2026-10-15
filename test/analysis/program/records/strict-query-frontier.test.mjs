import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustCarrierProbe } from "../../../../dist/analysis/program/carrier-probe.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { recordProjectSourceBinding, resolveIdentifierCarrier } from "../../../../dist/analysis/expressions/references.js";
import { recordExportAssignmentFacts } from "../../../../dist/analysis/control-flow/statements.js";
import { finalizeRustCallableSignature } from "../../../../dist/analysis/callables/signature-query.js";
import { recordRustIndexedCallKeyArguments } from "../../../../dist/analysis/operations/indexed-call-keys.js";
import { rustUnitTargetType } from "../../../../dist/target-model/types/index.js";

function isolate(current, readers) {
  const probe = createRustCarrierProbe(current.walk);
  const records = createRustProgramRecordBuilder(undefined, createRustRecordFixture(readers, current.context.records));
  return { ...probe, context: { ...probe.context, records } };
}

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
  assert.equal(first !== undefined, true);
  assert.equal(finalizeRustCallableSignature(walk, declaration) === first, true);
  const explicit = finalizeRustCallableSignature(walk, declaration, { selectedReturn: rustUnitTargetType() });
  assert.equal(explicit?.result === first.result, true);
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
