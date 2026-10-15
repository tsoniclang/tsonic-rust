import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { recordRustComputedCallEvaluation } from "../../../../dist/analysis/operations/computed-members.js";
import { finalizeRustProviderOperationAbi } from "../../../../dist/analysis/operations/finalized-operation/finalize.js";
import { rustFutureTargetType, rustJsPromiseTargetTypeWithLifetime, rustUnitTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const owned = { kind: "static" };
const region = { kind: "parameter", identity: "scope::borrow", name: "borrow" };
const promise = (output = integer, lifetime = owned) => rustJsPromiseTargetTypeWithLifetime(output, lifetime);
const storage = (parameters = [], lifetime = { kind: "static" }, ownedReceiver) => ({
  capturedParameters: parameters, storage: lifetime,
  ...(ownedReceiver === undefined ? {} : { ownedReceiver }),
});
const protocol = (overrides = {}) => ({ kind: "sync", resultCarrier: integer,
  yieldType: integer, nextType: wide, returnType: integer, capturedParameters: [], storage: { kind: "static" },
  ...overrides,
});
const ast = { kindName: node => node.kind };

function indexAbi(value = integer) {
  const abi = finalizeRustProviderOperationAbi({ operationKind: "index-set", form: { form: "index",
    indexConversion: { kind: "semantic-conversion", id: "checked-i32-to-usize" } },
    sourceReceiverCarrier: { kind: "array", element: value }, sourceArgumentCarriers: [integer, value],
    declaredSourceArgumentCarriers: [integer, value], resultCarrier: rustUnitTargetType(),
    isAsync: false, isFallible: false });
  assert.equal(abi !== undefined, true, "a real finalized native index-set ABI");
  return abi;
}

test("the four async and member families publish the same immutable getter ports without general writers", () => {
  const builder = createRustProgramRecordBuilder();
  const records = builder.seal([]);
  assert.equal(Object.keys(records).length, 66);
  for (const [family, producer] of [["asyncFunction", "asyncFunctions"], ["yield", "yields"],
    ["computedMember", "computedMembers"], ["compoundWrite", "compoundWrites"]]) {
    assert.equal(builder[family] === builder[producer].records && records[family] === builder[family], true, family);
    assert.equal(Object.isFrozen(builder[producer]) && Object.isFrozen(records[family]), true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(records[family].get(undefined) === undefined && records[family].get({}) === undefined, true, family);
    for (const removed of ["set", "admit", "reuse", "seal"]) {
      assert.equal(records[family][removed] === undefined, true, `${family}: ${removed}`);
    }
    assert.equal(records[producer] === undefined, true, "producer access is analysis-only");
  }
});

test("native async publication constructs the exact future and preserves native output identity", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  builder.asyncFunctions.native(declaration, integer);
  const fact = builder.asyncFunction.get(declaration);
  assert.equal(fact.kind, "native-future");
  assert.equal(fact.isAsync, true);
  assert.equal(fact.outputCarrier === integer, true);
  assert.equal(rustTargetTypeRefEquals(fact.futureCarrier, rustFutureTargetType(integer)), true);
  assert.equal(Object.hasOwn(fact, "storage") || Object.hasOwn(fact, "capturedParameters"), false);
  builder.asyncFunctions.native(declaration, { ...integer });
  assert.equal(builder.asyncFunction.get(declaration) === fact, true, "the first native record remains canonical");
  assert.throws(() => builder.asyncFunctions.native(declaration, wide), /Conflicting Rust semantic plan/u);
  assert.equal(builder.asyncFunction.get(declaration) === fact, true);
  assert.equal(builder.minimumFoundation(), "core");
});

for (const [name, lifetime, capture] of [
  ["static", { kind: "static" }, undefined],
  ["receiver", { kind: "receiver" }, undefined],
  ["explicit region", { kind: "lifetime", lifetime: region }, undefined],
  ["owned receiver", { kind: "static" }, { carrier: integer, occurrences: [{}, {}] }],
]) test(`promise publication preserves ${name} storage and exact retained identities`, () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const parameters = [{}, {}];
  const selected = storage(parameters, lifetime, capture);
  const future = promise(integer, lifetime.kind === "lifetime" ? region : owned);
  builder.asyncFunctions.promise(declaration, future, integer, selected);
  const fact = builder.asyncFunction.get(declaration);
  assert.equal(fact.kind, "js-promise");
  assert.equal(fact.isAsync, true);
  assert.equal(fact.futureCarrier === future && fact.outputCarrier === integer, true);
  assert.equal(fact.capturedParameters === parameters && fact.storage === lifetime, true);
  assert.equal(fact.ownedReceiver === capture, true);
  assert.equal(Object.hasOwn(fact, "ownedReceiver"), capture !== undefined);
  builder.asyncFunctions.promise(declaration, { ...future }, { ...integer }, {
    ...selected, capturedParameters: [...parameters], storage: { ...lifetime },
    ...(capture === undefined ? {} : { ownedReceiver: { ...capture, occurrences: [...capture.occurrences] } }),
  });
  assert.equal(builder.asyncFunction.get(declaration) === fact, true, "structural equality keeps original evidence");
  assert.equal(builder.asyncFunction.get({}) === undefined, true);
  assert.equal(builder.minimumFoundation(), "core", "suspension records do not add unrelated foundation demand");
});

test("promise equality detects output, parameter identity/order, storage region and receiver changes", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const parameters = [{}, {}];
  const receiver = { carrier: integer, occurrences: [{}, {}] };
  const selected = storage(parameters, { kind: "lifetime", lifetime: region }, receiver);
  const future = promise(integer, region);
  builder.asyncFunctions.promise(declaration, future, integer, selected);
  const original = builder.asyncFunction.get(declaration);
  const changes = [
    [promise(wide, region), integer, selected],
    [future, wide, selected],
    [future, integer, { ...selected, capturedParameters: [parameters[1], parameters[0]] }],
    [future, integer, { ...selected, capturedParameters: [{}, parameters[1]] }],
    [future, integer, { ...selected, storage: { kind: "receiver" } }],
    [future, integer, { ...selected, storage: { kind: "lifetime", lifetime: { ...region, identity: "other::borrow" } } }],
    [future, integer, { ...selected, ownedReceiver: undefined }],
    [future, integer, { ...selected, ownedReceiver: { ...receiver, carrier: wide } }],
    [future, integer, { ...selected, ownedReceiver: { ...receiver, occurrences: [...receiver.occurrences].reverse() } }],
    [future, integer, { ...selected, ownedReceiver: { ...receiver, occurrences: [{}] } }],
  ];
  for (const [index, [carrier, output, changed]] of changes.entries()) {
    assert.throws(() => builder.asyncFunctions.promise(declaration, carrier, output, changed),
      /Conflicting Rust semantic plan 'tsonic.rust.asyncFunction'/u, `change ${index}`);
    assert.equal(builder.asyncFunction.get(declaration) === original, true, `change ${index}`);
  }
  assert.throws(() => builder.asyncFunctions.native(declaration, integer), /Conflicting Rust semantic plan/u);
});

test("yield publication preserves active generator, next result and delegated return identities", () => {
  const builder = createRustProgramRecordBuilder();
  const generator = {};
  const value = {};
  const delegate = {};
  const selected = protocol();
  const delegatedCarrier = { kind: "target-named", id: "native.generator" };
  const delegatedReturn = { ...integer };
  builder.yields.value(value, generator, selected);
  builder.yields.delegate(delegate, generator, selected, delegatedCarrier, delegatedReturn);
  const yielded = builder.yield.get(value);
  const delegated = builder.yield.get(delegate);
  assert.equal(yielded.generatorDeclaration === generator && delegated.generatorDeclaration === generator, true);
  assert.equal(yielded.kind, "value");
  assert.equal(yielded.yieldType === integer && yielded.resultType === wide, true);
  assert.equal(Object.hasOwn(yielded, "delegatedCarrier"), false);
  assert.equal(delegated.kind, "delegate");
  assert.equal(delegated.yieldType === integer && delegated.resultType === delegatedReturn, true);
  assert.equal(delegated.delegatedCarrier === delegatedCarrier, true);
  builder.yields.value(value, generator, protocol({ yieldType: { ...integer }, nextType: { ...wide } }));
  builder.yields.delegate(delegate, generator, selected, { ...delegatedCarrier }, { ...integer });
  assert.equal(builder.yield.get(value) === yielded && builder.yield.get(delegate) === delegated, true);
  assert.equal(builder.minimumFoundation(), "core");
});

test("yield conflicts preserve the canonical record and reject foreign declarations or protocols", () => {
  const builder = createRustProgramRecordBuilder();
  const expression = {};
  const generator = {};
  const selected = protocol();
  builder.yields.value(expression, generator, selected);
  const original = builder.yield.get(expression);
  for (const [owner, changed] of [[{}, selected], [generator, protocol({ nextType: integer })],
    [generator, protocol({ yieldType: wide })]]) {
    assert.throws(() => builder.yields.value(expression, owner, changed),
      /Conflicting Rust semantic plan 'tsonic.rust.yield'/u);
    assert.equal(builder.yield.get(expression) === original, true);
  }
  assert.throws(() => builder.yields.delegate(expression, generator, selected, integer, wide), /Conflicting Rust semantic plan/u);
});

for (const [kind, evaluateKey] of [["KindStringLiteral", false], ["KindNumericLiteral", false],
  ["KindNoSubstitutionTemplateLiteral", false], ["KindCallExpression", true], ["KindIdentifier", true],
  ["KindTemplateExpression", true]]) test(`computed ${kind} preserves exact independent evaluation decisions`, () => {
  for (const accessMode of ["read", "write", "read-write", "delete"]) {
    const builder = createRustProgramRecordBuilder();
    const expression = {};
    const receiver = {};
    const key = { kind };
    builder.computedMembers.evaluate(ast, expression, receiver, key, accessMode);
    const fact = builder.computedMember.get(expression);
    assert.equal(Object.isFrozen(fact), true);
    assert.equal(fact.receiver === receiver && fact.key === key, true);
    assert.equal(fact.accessMode, accessMode);
    assert.equal(fact.evaluateKey, evaluateKey);
    assert.equal(fact.evaluateReceiver, true);
    builder.computedMembers.evaluate(ast, expression, receiver, key, accessMode, true);
    assert.equal(builder.computedMember.get(expression) === fact, true);
    assert.throws(() => builder.computedMembers.evaluate(ast, expression, receiver, key, accessMode, false),
      /Conflicting Rust semantic plan/u);
    const staticExpression = {};
    builder.computedMembers.evaluate(ast, staticExpression, receiver, key, accessMode, false);
    assert.equal(builder.computedMember.get(staticExpression).evaluateReceiver, false);
    assert.equal(builder.computedMember.get(staticExpression).evaluateKey, evaluateKey);
    assert.equal(builder.minimumFoundation(), "core");
  }
});

test("computed call selection admits only the exact checker-selected element callee", () => {
  const builder = createRustProgramRecordBuilder();
  const expression = {};
  const receiver = {};
  const key = { kind: "KindCallExpression" };
  const source = { sourceCalleeAccess: { kind: "element", expression,
    receiver: { expression: receiver }, argument: { expression: key } } };
  for (const selected of [undefined, {}, { sourceCalleeAccess: { ...source.sourceCalleeAccess, kind: "property" } }]) {
    assert.equal(recordRustComputedCallEvaluation(ast, builder, [], selected, expression, true) === undefined, true);
  }
  assert.equal(recordRustComputedCallEvaluation(ast, builder, [], source, {}, true) === undefined, true);
  assert.equal(builder.computedMember.get(expression) === undefined, true);
  assert.equal(recordRustComputedCallEvaluation(ast, builder, [], source, expression, false) === key, true);
  const fact = builder.computedMember.get(expression);
  assert.equal(fact.receiver === receiver && fact.key === key, true);
  assert.equal(fact.evaluateReceiver, false);
  assert.equal(fact.evaluateKey, true);
});

test("computed equality rejects key, receiver, mode and literal-evaluation changes", () => {
  const builder = createRustProgramRecordBuilder();
  const expression = {};
  const receiver = {};
  const key = { kind: "KindCallExpression" };
  builder.computedMembers.evaluate(ast, expression, receiver, key, "read");
  const original = builder.computedMember.get(expression);
  for (const [changedReceiver, changedKey, mode] of [[{}, key, "read"], [receiver, { ...key }, "read"],
    [receiver, key, "write"]]) {
    assert.throws(() => builder.computedMembers.evaluate(ast, expression, changedReceiver, changedKey, mode),
      /Conflicting Rust semantic plan/u);
  }
  assert.throws(() => builder.computedMembers.evaluate({ kindName: () => "KindStringLiteral" },
    expression, receiver, key, "read"), /Conflicting Rust semantic plan/u);
  assert.equal(builder.computedMember.get(expression) === original, true);
});

test("compound index publication preserves the finalized ABI object and full structural conflicts", () => {
  const builder = createRustProgramRecordBuilder();
  const expression = {};
  const abi = indexAbi();
  builder.compoundWrites.index(expression, "native.index-set", abi);
  const original = builder.compoundWrite.get(expression);
  assert.equal(original.kind, "runtime-set");
  assert.equal(original.operationId, "native.index-set");
  assert.equal(original.abi === abi, true);
  builder.compoundWrites.index(expression, "native.index-set", indexAbi());
  assert.equal(builder.compoundWrite.get(expression) === original, true);
  for (const [operation, changed] of [["other.index-set", abi], ["native.index-set", indexAbi(wide)]]) {
    assert.throws(() => builder.compoundWrites.index(expression, operation, changed),
      /Conflicting Rust semantic plan 'tsonic.rust.compoundWrite'/u);
    assert.equal(builder.compoundWrite.get(expression) === original, true);
  }
  assert.equal(builder.minimumFoundation(), "core", "this family preserves its original non-accounting admission");
});

test("all four families retain inherited evidence, live parent additions and isolated specialization", () => {
  const parent = createRustProgramRecordBuilder();
  const child = createRustProgramRecordBuilder(undefined, parent);
  const receiver = {};
  const key = { kind: "KindStringLiteral" };
  const selected = protocol();
  const abi = indexAbi();
  const publish = [
    ["asyncFunction", (builder, node) => builder.asyncFunctions.native(node, integer)],
    ["yield", (builder, node) => builder.yields.value(node, receiver, selected)],
    ["computedMember", (builder, node) => builder.computedMembers.evaluate(ast, node, receiver, key, "read")],
    ["compoundWrite", (builder, node) => builder.compoundWrites.index(node, "native.index-set", abi)],
  ];
  for (const [family, admit] of publish) {
    const inherited = {};
    const specialized = {};
    admit(parent, inherited);
    const original = parent[family].get(inherited);
    assert.equal(child[family].get(inherited) === original, true, family);
    admit(child, inherited);
    assert.equal(child[family].get(inherited) === original, true, family);
    admit(child, specialized);
    assert.equal(parent[family].get(specialized) === undefined, true, family);
    assert.equal(child[family].get(specialized) !== undefined, true, family);
  }
  parent.seal([]);
  child.seal([]);
});

test("every producer operation rejects after sealing before examining caller-owned metadata", () => {
  const builder = createRustProgramRecordBuilder();
  builder.seal([]);
  let reads = 0;
  const unreadable = new Proxy({}, { get() { reads += 1; throw new Error("metadata was read"); } });
  const calls = [
    () => builder.asyncFunctions.native({}, integer),
    () => builder.asyncFunctions.promise({}, integer, integer, unreadable),
    () => builder.yields.value({}, {}, unreadable),
    () => builder.yields.delegate({}, {}, unreadable, integer, integer),
    () => builder.computedMembers.evaluate(unreadable, {}, {}, {}, "read"),
    () => builder.compoundWrites.index({}, "native.index-set", unreadable),
  ];
  for (const call of calls) assert.throws(call, /after analysis is sealed/u);
  assert.equal(reads, 0, "a closed producer never reads caller metadata");
});
