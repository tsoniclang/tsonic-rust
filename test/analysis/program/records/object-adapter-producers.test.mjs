import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { rustCallableTargetType, rustSourceTypeCarrier, rustStructuralObjectTargetType } from "../../../../dist/target-model/types/index.js";
import { rustClassConstructorTargetType } from "../../../../dist/target-model/types/carriers/class-constructors.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustObjectReferenceViewProducer } from "../../../../dist/analysis/program/records/objects/object-reference-view.js";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const callable = rustCallableTargetType([integer], integer);
const wideCallable = rustCallableTargetType([wide], wide);
const producers = [
  ["receiverIndependentMethod", "receiverIndependentMethods", owner => owner.finalize({}, [], () => "unused")],
  ["classValue", "classValues", owner => owner.resolve({}, {}, undefined)],
  ["objectLiteralMethodAdapter", "objectLiteralMethodAdapters", owner => owner.finalize({ expressions: new Set() })],
  ["projectCallableAdapters", "projectCallableAdapterPlans", owner => owner.finalize({})],
  ["objectReferenceView", "objectReferenceViews", owner => owner.select({}, {}, integer, integer)],
];

test("object and adapter families have one frozen reader, no generic writer and a closed producer", () => {
  const builder = createRustProgramRecordBuilder();
  const records = builder.seal([]);
  for (const [family, producer, attempt] of producers) {
    assert.equal(builder[family] === builder[producer].records, true, family);
    assert.equal(records[family] === builder[family], true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(Object.isFrozen(records[family]), true, family);
    assert.equal(Object.isFrozen(builder[producer]), true, producer);
    assert.equal(records[family].get(undefined) === undefined, true, family);
    assert.equal(records[family].get({}) === undefined, true, family);
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(records[producer] === undefined, true, producer);
    assert.throws(() => attempt(builder[producer]), /after analysis is sealed/u, producer);
  }
});

function copiedFixture(builder, { method = { kind: "KindMethodDeclaration", children: [] }, carrier = callable, receiver = false, fieldName = "value" } = {}) {
  const literal = {};
  const read = {};
  const root = { children: [literal, read] };
  const shape = rustStructuralObjectTargetType("/source.ts", [
    { sourceName: fieldName, type: callable, presence: "required", readonly: false, method: true },
  ]);
  const operation = { kind: "record-literal", storage: "structural-object", resultCarrier: shape,
    fields: [{ storageIndex: 0, carrier }],
    contributions: [{ kind: "structural-method", targetStorageIndex: 0, expression: method }] };
  const records = createRustRecordFixture({ targetOperation: { get: node => node === literal ? operation : node === read
    ? { kind: "source-field", storage: "structural-object", receiverCarrier: shape, storageIndex: 0, valueSemantics: { kind: "method" } }
    : node === method ? { kind: "closure", resultCarrier: carrier } : undefined },
    selectedOperation: { get: node => node === read ? { provenance: {
      sourceReceiver: literal, sourceSelectedDeclaration: method,
    } } : undefined },
  }, builder);
  if (receiver) method.children = [{ kind: "KindThisKeyword" }];
  const walk = { context: { requiredRecords: [], records, diagnostics: [], isNativeNode: () => true, ast: {
    forEachChild(node, visit) { for (const child of node.children ?? []) visit(child); },
    children: node => node.children ?? [],
    body: node => node.kind === "KindMethodDeclaration" ? { children: node.children } : undefined,
    kind: node => node.kind ?? "KindIdentifier",
    kindName: node => node.kind ?? "KindIdentifier",
  }, sourceStorage: {
    storageSubjectFor(node, projection) {
      const declaration = projection.length === 1 && projection[0].kind === "method-value"
        ? projection[0].declaration : undefined;
      assert.equal(declaration !== undefined, true, "the selected method read supplies its exact declaration");
      return { kind: "resolved", subject: { node: declaration, kind: "value", projection: [] } };
    },
    bindingsForLexicalOwner: () => ({ kind: "resolved", bindings: {} }),
    storageProducersFor: subject => ({ kind: "complete", producers: [{ subject }] }),
  } }, sourceTypes: { structuralInstantiations: () => [] }, rejectedExpressions: new WeakSet(), resolving: new Set() };
  return { walk, method, files: [root], finalize: () => builder.receiverIndependentMethods.finalize(walk, [root], () => "source") };
}

test("copied-method producer admits only proved implementations and preserves inherited source identity", () => {
  const parent = createRustProgramRecordBuilder();
  const original = copiedFixture(parent);
  assert.equal(original.finalize().size, 1);
  const fact = parent.receiverIndependentMethod.get(original.method);
  assert.equal(rustTargetTypeRefEquals(fact?.carrier, callable), true, "the admitted closure retains its exact native signature, error and lifetime");
  assert.equal(parent.receiverIndependentMethod.get(original.method) === fact, true, "the actual published record has one canonical identity");
  assert.equal(Object.isFrozen(fact), true);
  assert.equal(parent.receiverIndependentMethod.get({}) === undefined, true);
  assert.equal(parent.minimumFoundation(), "core");
  const child = createRustProgramRecordBuilder(undefined, parent.seal(original.walk.context.requiredRecords));
  const selected = copiedFixture(child, { method: original.method, carrier: { ...callable } });
  assert.equal(selected.finalize().size, 1);
  assert.equal(child.receiverIndependentMethod.get(original.method) === fact, true, "equal child admission keeps exact parent evidence");
  const foreign = copiedFixture(child);
  foreign.finalize();
  assert.equal(parent.receiverIndependentMethod.get(foreign.method) === undefined, true, "the child never publishes into its parent");
  const conflict = copiedFixture(child, { method: original.method, carrier: wideCallable });
  assert.throws(conflict.finalize, /Conflicting Rust semantic plan 'tsonic\.rust\.receiverIndependentMethod'/u);
  assert.equal(child.receiverIndependentMethod.get(original.method) === fact, true);
});

test("receiver-dependent methods retain their original precise diagnostic and publish nothing", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = copiedFixture(builder, { receiver: true });
  assert.equal(selected.finalize().size, 0);
  assert.equal(builder.receiverIndependentMethod.get(selected.method) === undefined, true);
  assert.equal(selected.walk.context.diagnostics.length, 1);
  assert.equal(selected.walk.context.diagnostics[0].code, "RUST_COPIED_METHOD_RECEIVER_NOT_PROVEN");
});

test("copied-method publication requires checked read provenance and a complete producer domain", () => {
  for (const missing of ["selected-read", "producer-domain"]) {
    const builder = createRustProgramRecordBuilder();
    const selected = copiedFixture(builder);
    if (missing === "selected-read") {
      selected.walk.context.records = createRustRecordFixture({
        targetOperation: selected.walk.context.records.targetOperation,
        selectedOperation: { get: () => undefined },
      }, builder);
    } else {
      selected.walk.context.sourceStorage.storageProducersFor = () => ({
        kind: "open", boundaries: [{ kind: "external-write" }],
      });
    }
    assert.equal(selected.finalize().size, 0, missing + ": no copied method is admitted");
    assert.equal(builder.receiverIndependentMethod.get(selected.method) === undefined, true,
      missing + ": no record is published");
    assert.equal(selected.walk.context.diagnostics.length, 1, missing + ": one source rejection");
    assert.equal(selected.walk.context.diagnostics[0].code, "RUST_COPIED_METHOD_RECEIVER_NOT_PROVEN", missing);
  }
});

test("copied-method admission preserves publication order before later rejected-method diagnostics", () => {
  const parent = createRustProgramRecordBuilder();
  const original = copiedFixture(parent);
  original.finalize();
  const fact = parent.receiverIndependentMethod.get(original.method);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(original.walk.context.requiredRecords));
  const conflicting = copiedFixture(child, { method: original.method, carrier: wideCallable });
  const rejected = copiedFixture(child, { fieldName: "other", receiver: true });
  const first = conflicting.walk.context.records.targetOperation;
  const second = rejected.walk.context.records.targetOperation;
  const firstSelected = conflicting.walk.context.records.selectedOperation;
  const secondSelected = rejected.walk.context.records.selectedOperation;
  conflicting.walk.context.records = createRustRecordFixture({
    targetOperation: { get: subject => first.get(subject) ?? second.get(subject) },
    selectedOperation: { get: subject => firstSelected.get(subject) ?? secondSelected.get(subject) },
  }, child);
  assert.throws(() => child.receiverIndependentMethods.finalize(conflicting.walk,
    [...conflicting.files, ...rejected.files], () => "source"), /Conflicting Rust semantic plan/u);
  assert.equal(conflicting.walk.context.diagnostics.length, 0, "later diagnostics do not move ahead of an earlier admission failure");
  assert.equal(child.receiverIndependentMethod.get(original.method) === fact, true);
  assert.equal(child.receiverIndependentMethod.get(rejected.method) === undefined, true);
});

test("copied-method batches preflight and admit one exact implementation shared by three demands", () => {
  const method = { kind: "KindMethodDeclaration", children: [] };
  const canonical = { carrier: callable };
  let reads = 0;
  const inherited = createRustRecordFixture({ receiverIndependentMethod: { get: node => {
    assert.equal(node === method, true);
    reads++;
    return canonical;
  } } });
  const builder = createRustProgramRecordBuilder(undefined, inherited);
  const selected = ["first", "second", "third"].map(fieldName => copiedFixture(builder,
    { method, carrier: { ...callable }, fieldName }));
  const walk = selected[0].walk;
  const sources = selected.map(candidate => candidate.walk.context.records.targetOperation);
  const selections = selected.map(candidate => candidate.walk.context.records.selectedOperation);
  walk.context.records = createRustRecordFixture({ targetOperation: { get: subject => sources
    .map(source => source.get(subject)).find(operation => operation !== undefined) },
    selectedOperation: { get: subject => selections.map(source => source.get(subject)).find(operation => operation !== undefined) },
  }, builder);
  const proven = builder.receiverIndependentMethods.finalize(walk, selected.flatMap(candidate => candidate.files), () => "source");
  assert.equal(proven.size, 3, "every proven flow identity is retained");
  assert.equal(reads, 2, "one preflight and one actual admission, not one publication per demand");
  assert.equal(builder.receiverIndependentMethod.get(method) === canonical, true);
});

test("contradictory copied-method candidates reject before publishing any new batch row", () => {
  const builder = createRustProgramRecordBuilder();
  const first = copiedFixture(builder, { fieldName: "first" });
  const second = copiedFixture(builder, { fieldName: "second", method: first.method, carrier: wideCallable });
  const sourceRecords = [first.walk.context.records.targetOperation, second.walk.context.records.targetOperation];
  const selections = [first.walk.context.records.selectedOperation, second.walk.context.records.selectedOperation];
  first.walk.context.records = createRustRecordFixture({ targetOperation: { get: subject => sourceRecords
    .map(source => source.get(subject)).find(operation => operation !== undefined) },
    selectedOperation: { get: subject => selections.map(source => source.get(subject)).find(operation => operation !== undefined) },
  }, builder);
  assert.throws(() => builder.receiverIndependentMethods.finalize(first.walk, [...first.files, ...second.files], () => "source"),
    /Conflicting Rust semantic plan 'tsonic\.rust\.receiverIndependentMethod'/u);
  assert.equal(builder.receiverIndependentMethod.get(first.method) === undefined, true,
    "the earlier candidate is not published before a later contradiction is known");
  assert.equal(first.walk.context.diagnostics.length, 0);
});

const checkedAdapters = createCompilerSessionFromFiles({ currentDirectory: "/project", compilerOptions: {
  strict: true, target: "es2022", module: "esnext",
}, files: { "/project/contract.ts": `
  interface Contract { value(): number; }
  interface Other { value(): number; }
  class Concrete implements Contract { value(): number { return 1; } }
  class Replacement implements Other { value(): number { return 2; } }
` } }).checkSource();
assert.equal(checkedAdapters.diagnostics.length, 0, formatDiagnostics(checkedAdapters.diagnostics));
const adapterSource = createTargetSourceProgram(checkedAdapters);
const [contractOwner, otherOwner, concreteOwner, replacementOwner] = adapterSource.ast.statements(
  checkedAdapters.getSourceFile("/project/contract.ts"));
const contractMethod = adapterSource.ast.members(contractOwner)[0];
const otherMethod = adapterSource.ast.members(otherOwner)[0];
const implementationMethod = adapterSource.ast.members(concreteOwner)[0];
const replacementMethod = adapterSource.ast.members(replacementOwner)[0];

function adapterFixture(builder, { expression = {}, implementation = implementationMethod, contract = contractMethod, slot = "value", returnCarrier = integer } = {}) {
  const declaration = contractOwner;
  const ownerCarrier = rustSourceTypeCarrier("/contract.ts", "Contract", "object", []);
  const owner = { kind: "interface", declaration, carrier: ownerCarrier, typeParameterIdentities: [] };
  const concrete = { kind: "class", declaration: concreteOwner, carrier: ownerCarrier, typeParameterIdentities: [] };
  const operation = { kind: "record-literal", resultCarrier: ownerCarrier,
    contributions: [{ kind: "method", expression: implementation, contractDeclarations: [contract] }] };
  const returns = new Map([[implementation, { returnCarrier }], [contract, { returnCarrier }]]);
  const records = createRustRecordFixture({ targetOperation: { get: node => node === expression ? operation : undefined },
    sourceCallableReturn: { get: node => returns.get(node) } }, builder);
  const variant = { declaration: contract, targetTypeArguments: [], sourceTypeParameterIdentities: [], virtualSlot: slot };
  const input = { requiredRecords: [],
    ast: adapterSource.ast, source: adapterSource,
    sourceLifetimes: { parameterFor: () => undefined }, records,
    projectTypes: { definitions: [concrete], isPolymorphic: () => true, contractsForClass: () => [owner],
      openCarrier: () => ownerCarrier, definitionContainingDeclaration: () => owner,
      relationship: () => ({ kind: "related", targetType: ownerCarrier }),
      memberImplementation: () => ({ kind: "resolved", implementation: { declaration: implementation } }),
    },
    typeDefinitions: undefined,
    projectMethodDispatch: { variantsForMember: () => [variant] },
    expressions: new Set([expression]),
  };
  const walk = { context: { requiredRecords: [], ...input, diagnostics: [] }, rejectedExpressions: new WeakSet(), resolving: new Set() };
  return { expression, implementation, contract, owner, concrete, input, walk,
    literal: () => builder.objectLiteralMethodAdapters.finalize(input),
    project: () => builder.projectCallableAdapterPlans.finalize(walk) };
}

test("object-method producer retains exact implementation, contract and ABI evidence across scopes", () => {
  const parent = createRustProgramRecordBuilder();
  const selected = adapterFixture(parent);
  assert.deepEqual(selected.literal(), []);
  const fact = parent.objectLiteralMethodAdapter.get(selected.expression);
  assert.equal(fact?.implementations.length, 1);
  assert.equal(fact.implementations[0].sourceCallable === selected.implementation, true);
  assert.equal(fact.dispatches[0].contractMethod === selected.contract, true);
  assert.equal(fact.dispatches[0].implementationIndex, 0);
  assert.equal(fact.dispatches[0].resultAdapter.kind, "identity");
  assert.equal(Object.isFrozen(fact), true);
  assert.equal(Object.isFrozen(fact.implementations), true);
  assert.equal(Object.isFrozen(fact.dispatches), true);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(selected.input.requiredRecords));
  const equal = adapterFixture(child, selected);
  assert.deepEqual(equal.literal(), []);
  assert.equal(child.objectLiteralMethodAdapter.get(selected.expression) === fact, true);
  const fresh = adapterFixture(child);
  assert.deepEqual(fresh.literal(), []);
  assert.equal(parent.objectLiteralMethodAdapter.get(fresh.expression) === undefined, true);
  for (const replacement of [{ implementation: replacementMethod }, { contract: otherMethod }, { slot: "foreign" }, { returnCarrier: wide }]) {
    assertRustInheritedRecordConflict("objectLiteralMethodAdapter", selected.expression, fact,
      candidate => adapterFixture(candidate, { ...selected, ...replacement }).literal(),
      /Conflicting Rust semantic plan 'tsonic\.rust\.objectLiteralMethodAdapter'/u);
    assert.equal(child.objectLiteralMethodAdapter.get(selected.expression) === fact, true);
  }
  assert.equal(child.minimumFoundation(), "core");
});

test("object-method producer reports the exact source issue without admitting absent or incomplete operations", () => {
  for (const missing of ["operation", "return", "dispatch"]) {
    const builder = createRustProgramRecordBuilder();
    const selected = adapterFixture(builder);
    if (missing === "operation") selected.input.records = createRustRecordFixture({}, builder);
    if (missing === "return") selected.input.records = createRustRecordFixture({
      targetOperation: selected.input.records.targetOperation,
    }, builder);
    if (missing === "dispatch") selected.input.projectMethodDispatch.variantsForMember = () => [];
    const issues = selected.literal();
    assert.equal(issues.length, 1, missing);
    assert.equal(issues[0].expression === selected.expression, true, missing);
    assert.equal(issues[0].subject === (missing === "return" ? selected.implementation : selected.expression), true, missing);
    assert.equal(Object.isFrozen(issues), true, missing);
    assert.equal(builder.objectLiteralMethodAdapter.get(selected.expression) === undefined, true, missing);
  }
});

test("project-adapter producer owns declaration publication and exact contract/implementation equality", () => {
  const parent = createRustProgramRecordBuilder();
  const selected = adapterFixture(parent);
  selected.project();
  const fact = parent.projectCallableAdapters.get(selected.concrete.declaration);
  assert.equal(fact?.length, 1);
  assert.equal(fact[0].contract === selected.contract, true);
  assert.equal(fact[0].implementation === selected.implementation, true);
  assert.equal(fact[0].slot, "value");
  assert.equal(Object.isFrozen(fact), true);
  assert.equal(Object.isFrozen(fact[0]), true);
  assert.equal(Object.isFrozen(fact[0].parameterAdapters), true);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(selected.input.requiredRecords));
  const equal = adapterFixture(child, selected);
  equal.input.projectTypes.definitions = [selected.concrete];
  equal.project();
  assert.equal(child.projectCallableAdapters.get(selected.concrete.declaration) === fact, true);
  for (const replacement of [{ implementation: replacementMethod }, { contract: otherMethod }, { slot: "foreign" }, { returnCarrier: wide }]) {
    assertRustInheritedRecordConflict("projectCallableAdapters", selected.concrete.declaration, fact, candidate => {
      const changed = adapterFixture(candidate, { ...selected, ...replacement });
      changed.input.projectTypes.definitions = [selected.concrete];
      changed.project();
    }, /Conflicting Rust semantic plan 'tsonic\.rust\.projectCallableAdapters'/u);
    assert.equal(child.projectCallableAdapters.get(selected.concrete.declaration) === fact, true);
  }
  assert.equal(child.projectCallableAdapters.get({}) === undefined, true);
});

test("project-adapter producer distinguishes skipped owners from a present empty dispatch inventory", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = adapterFixture(builder);
  selected.input.projectTypes.isPolymorphic = () => false;
  selected.project();
  assert.equal(builder.projectCallableAdapters.get(selected.concrete.declaration) === undefined, true);
  selected.input.projectTypes.isPolymorphic = () => true;
  selected.input.projectTypes.contractsForClass = () => [];
  selected.project();
  const fact = builder.projectCallableAdapters.get(selected.concrete.declaration);
  assert.equal(fact !== undefined, true);
  assert.equal(fact.length, 0);
  assert.equal(Object.isFrozen(fact), true);
});

const viewFields = [{ sourceName: "value", type: integer, presence: "required", readonly: false }];

function viewFixture(builder, { expression = {}, sourceCarrier = rustStructuralObjectTargetType("/source.ts", viewFields),
  targetCarrier = rustStructuralObjectTargetType("/target.ts", viewFields) } = {}) {
  const sourceType = {};
  const sourceSymbol = {};
  const targetSymbol = {};
  const sourceDeclaration = {};
  const targetDeclaration = {};
  const projection = (symbol, carrier) => (symbol === sourceSymbol && carrier === sourceCarrier ||
    symbol === targetSymbol && carrier === targetCarrier) ? { shape: { storage: "structural-object" },
      field: { storageIndex: 0, resultCarrier: integer, presence: "required", readonly: false } } : undefined;
  const walk = { sourceTypes: {
    structuralObjectForCarrier: () => ({ sourceType: {}, fields: [{}] }),
    structuralFieldProjectionForSymbol: projection,
    structuralFieldProjectionForDeclaration: (declaration, carrier) => projection(
      declaration === sourceDeclaration ? sourceSymbol : declaration === targetDeclaration ? targetSymbol : undefined, carrier),
    registerStructuralFieldImplementation: () => true,
  }, context: { requiredRecords: [],
    projectTypes: { definitionForCarrier: () => undefined },
    semanticsFor: () => ({ types: { expressionType: () => sourceType, structuralMembers: (_sourceType, _targetType, purpose) => {
      assert.equal(purpose, "read", "a published object view requires a readable checked source member");
      return { kind: "available", destination: { calls: [], constructs: [], indexes: [] }, members: [{ kind: "present",
        source: { property: { symbol: sourceSymbol }, declarations: [sourceDeclaration] },
        destination: { property: { symbol: targetSymbol }, declarations: [targetDeclaration] },
      }],
    }; } } }),
  } };
  return { expression, sourceCarrier, targetCarrier, walk,
    select: () => builder.objectReferenceViews.select(walk, expression, sourceCarrier, targetCarrier) };
}

test("object-reference producer preserves exact native carriers, parent identity and incompatible view refusal", () => {
  const parent = createRustProgramRecordBuilder();
  const selected = viewFixture(parent);
  assert.equal(selected.select() !== undefined, true);
  const fact = parent.objectReferenceView.get(selected.expression);
  assert.equal(fact?.kind, "structural");
  assert.equal(fact.sourceCarrier === selected.sourceCarrier, true);
  assert.equal(fact.targetCarrier === selected.targetCarrier, true);
  assert.equal(Object.isFrozen(fact.fields), true);
  const child = createRustProgramRecordBuilder(undefined, parent.seal(selected.walk.context.requiredRecords));
  assert.equal(viewFixture(child, selected).select() === fact, true);
  assert.equal(child.objectReferenceView.get(selected.expression) === fact, true);
  const changed = viewFixture(child, { ...selected, targetCarrier: rustStructuralObjectTargetType("/foreign.ts", viewFields) });
  assert.throws(changed.select, /Conflicting Rust semantic plan 'tsonic\.rust\.objectReferenceView'/u);
  assert.equal(child.objectReferenceView.get(selected.expression) === fact, true);
  const fresh = viewFixture(child);
  assert.equal(fresh.select() !== undefined, true);
  assert.equal(parent.objectReferenceView.get(fresh.expression) === undefined, true);
  assert.equal(child.minimumFoundation(), "core");
});

test("a missing structural-view proof returns undefined without inventing a record", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = viewFixture(builder);
  const target = selected.walk.sourceTypes.structuralObjectForCarrier;
  selected.walk.sourceTypes.structuralObjectForCarrier = () => undefined;
  assert.equal(selected.select() === undefined, true);
  assert.equal(builder.objectReferenceView.get(selected.expression) === undefined, true);
  selected.walk.sourceTypes.structuralObjectForCarrier = target;
  assert.equal(selected.select() !== undefined, true, "missing correspondence stays retryable");
});

test("object view queries retain full canonical evidence and select once in each actual walk", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = viewFixture(builder);
  let implementations = 0;
  selected.walk.sourceTypes.registerStructuralFieldImplementation = () => { implementations += 1; return true; };
  const first = selected.select();
  assert.equal(first === builder.objectReferenceView.get(selected.expression), true);
  assert.equal(selected.select() === first, true);
  assert.equal(implementations, 1, "same walk does not repeat native implementation admission");
  assert.equal(Object.isFrozen(first) && Object.isFrozen(first.fields[0]) &&
    Object.isFrozen(first.fields[0].source) && Object.isFrozen(first.fields[0].source.valueSemantics), true);
  const otherWalk = { ...selected.walk };
  assert.equal(builder.objectReferenceViews.select(otherWalk, selected.expression, selected.sourceCarrier, selected.targetCarrier) === first, true);
  assert.equal(implementations, 2, "new walk closes its own implementation demand");
  assert.equal(selected.select() === first, true);
  assert.equal(implementations, 2, "the first walk remains completed");
  builder.seal(selected.walk.context.requiredRecords);
  assert.throws(() => selected.select(), /after analysis is sealed/u);
});

test("structural view equality retains complete ordered native field evidence", () => {
  const selected = viewFixture(createRustProgramRecordBuilder());
  const fact = selected.select();
  const field = fact.fields[0];
  const admit = inherited => createRustObjectReferenceViewProducer(() => {}, {
    get: node => node === selected.expression ? inherited : undefined,
  }).select(selected.walk, selected.expression, selected.sourceCarrier, selected.targetCarrier);
  const equivalent = { ...fact, fields: [{ ...field, source: { ...field.source } }] };
  assert.equal(admit(equivalent) === equivalent, true);
  for (const source of [
    { ...field.source, receiverCarrier: wide }, { ...field.source, resultCarrier: wide },
    { ...field.source, storageIndex: 1 }, { ...field.source, storage: "project-object" },
    { ...field.source, declaration: {} }, { ...field.source, declaration: undefined },
    { ...field.source, dispatch: undefined }, { ...field.source, valueSemantics: { kind: "receiver-alias" } },
    { ...field.source, dispatch: { read: "get", write: "set", ownerCarrier: integer } },
  ]) assert.throws(() => admit({ ...fact, fields: [{ ...field, source }] }), /Conflicting Rust semantic plan/u, "changed native member proof");
  assert.throws(() => admit({ ...fact, fields: [{ ...field, writable: !field.writable }] }), /Conflicting Rust semantic plan/u);
  assert.throws(() => admit({ ...fact, fields: [{ ...field, destinationIndex: 1 }] }), /Conflicting Rust semantic plan/u);
});

test("class-value reuse is a read of exact inherited evidence, not an invented specialization", () => {
  const subject = {};
  const sourceCarrier = rustSourceTypeCarrier("/model.ts", "Box", "object", []);
  const carrier = rustClassConstructorTargetType(sourceCarrier);
  const fact = { declaration: {}, sourceCarrier, carrier };
  const parent = createRustRecordFixture({ classValue: { get: node => node === subject ? fact : undefined } });
  const builder = createRustProgramRecordBuilder(undefined, parent);
  assert.equal(builder.classValues.resolve({}, subject, integer) === carrier, true);
  assert.equal(builder.classValue.get(subject) === fact, true);
  assert.equal(builder.minimumFoundation(), "core", "a read never manufactures native accounting");
  const fresh = {};
  const walk = { context: { requiredRecords: [], ast: { kindName: () => "KindIdentifier" },
    source: { navigation: { sourceReferenceFor: () => undefined } } } };
  assert.equal(builder.classValues.resolve(walk, fresh, undefined) === undefined, true);
  assert.equal(builder.classValue.get(fresh) === undefined, true);
});
