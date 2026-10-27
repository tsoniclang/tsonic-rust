import assert from "node:assert/strict";
import test from "node:test";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { analyzeRust, boolCarrier, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { createRustPhysicalCallableLifecycle } from "../../../dist/analysis/callables/ownership/physical-lifecycle.js";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native/native-producers.js";
import { createRustGenericCallablePhysicalPlan } from "../../../dist/analysis/callables/generics/generic-physical.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native/native-captures.js";
import { createRustNativeStorageQueries } from "../../../dist/analysis/callables/storage/native-storage.js";
import { finalizeRustNativeParameterStorage } from "../../../dist/analysis/callables/native/native-parameters.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallableInputTargetType, rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustLifetimesEqual } from "../../../dist/target-model/lifetimes/index.js";
import { prepareRustGenericCallableIdentitySources, prepareRustGenericCallableIdentityRequests,
  createRustGenericCallableIdentityPlan } from "../../../dist/analysis/callables/generics/generic-identities.js";
import { createRustEffectsWorkBudget } from "../../../dist/analysis/errors/effects-work-budget.js";
import { rustEmissionIdentityBindings, rustEmissionSourceIdentity } from "../../../dist/analysis/callables/emission/emission-contexts.js";
import { prepareRustProviderSourceOccurrences } from "../../../dist/analysis/operations/provider-source-inputs.js";

let checkedContext;
let checkedProviderContext;
for (const surfaces of [[], ["js"]]) test(`physical source inventory closes binding defaults, exports and native aggregates in ${surfaces[0] ?? "native"}`, () => {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": `
function identity(value: boolean): boolean { return value; }
export const { first, second = first } = { first: true, second: undefined };
export default second;
export function read(values: boolean[]): boolean {
  const [head = false, ...tail] = values;
  const functions = [identity];
  const record = { read(): boolean { return head; } };
  ${surfaces.includes("js") ? "return functions[0](record.read()) && tail.length === 0;" : `if (!functions[0](record.read())) return false;
  for (const _entry of tail) return false;
  return true;`}
}
` } });
  const { ast } = program.source;
  const counts = new Map();
  const check = (node, role) => {
    const selected = program.callableValues.nativeStorage.valueFor(node);
    assert.equal(selected.kind !== "unresolved", true,
      `${role}: ${selected.kind === "unresolved" ? selected.reason : "completed physical storage"}`);
    assert.equal(program.callableValues.nativeStorage.valueFor(node) === selected, true,
      `${role}: publication reads the original completed selection`);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  };
  const visit = node => {
    if (ast.is.IsBindingElement(node)) {
      const initializer = ast.as.AsBindingElement(node)?.Initializer;
      if (initializer !== undefined) check(initializer, "binding default");
    }
    if (ast.is.IsExportAssignment(node)) check(ast.as.AsExportAssignment(node).Expression, "default export");
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "array-literal" && rustCallableProtocol(operation.elementCarrier) !== undefined)
      check(node, "callable aggregate");
    if (operation?.kind === "record-literal" && operation.storage === "structural-object" &&
      operation.contributions.some(contribution => contribution.kind === "structural-method"))
      check(node, "fixed-method literal");
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(counts.get("binding default"), 2, "both scalar and native array defaults have original physical value keys");
  assert.equal(counts.get("default export"), 1, "the module snapshot has its actual checked expression key");
  assert.equal(counts.get("callable aggregate"), 1, "the callable write owner has its actual aggregate key");
  assert.equal(counts.get("fixed-method literal"), 1, "the fixed native method finalizer has its actual literal key");
});

const fixtureSource = `
type Scalar = boolean;
export function owner(value: boolean): boolean { return value; }
export function zero(): boolean { return true; }
export function expose(): typeof owner { return owner; }
export function exposeZero(): typeof zero { return zero; }
export const stored = owner(true);
const quantified = <Value>(value: Value): Value => value;
export const invoked = quantified<boolean>(true);
type Quantified = <Value>(value: Value) => Value;
function quantifiedFactory(): Quantified {
  return <Value>(value: Value): Value => value;
}
const retainedQuantified: Quantified = quantifiedFactory();
export const retainedInvoked = retainedQuantified<boolean>(true);
`;

function checkedSource(text, options = { surfaces: [] }) {
  let input;
  const context = analyzeRustErrorEffects(text, options, current => {
    const original = current.callableValues;
    const callableValues = Object.create(original, {
      initialize: { value(selected) { input = selected; return original.initialize(selected); } },
    });
    return { ...current, callableValues };
  });
  assert.equal(input !== undefined, true, "the real program lifecycle supplies its private construction inputs");
  return { context, input };
}

function physicalConstruction(checked, { unavailableReturns = new Set(), constructionErrorsReady = true } = {}) {
  const { context, input } = checked;
  const { ast, records, sourceStorage } = context;
  const native = context.callableValues.native;
  const generic = context.callableValues.generic;
  let queries;
  let physical;
  const producers = createRustNativeCallableProducerPlan({ source: sourceStorage.source, ast, nodes: input.nativeNodes, records, native,
    definitions: context.typeDefinitions, returnCarrierFor(node) {
      if (unavailableReturns.has(node)) return undefined;
      const selected = queries.prepareReturn(node);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  if (constructionErrorsReady) producers.selectConstructionErrors(new Map());
  queries = createRustNativeStorageQueries({ ast, nativeNodes: input.nativeNodes, storage: sourceStorage, records,
    operationAttempts: input.operationAttempts,
    frames: context.callableValues.frames,
    capturesFor: declaration => captures.forDeclaration(declaration),
    definitions: context.typeDefinitions, native, producers, generic,
    physicalCarrierFor: (carrier, fileName, subject, bindings, selected) =>
      physical.carrierFor(carrier, fileName, subject, bindings, selected),
    lifetimes: input.lifetimes, lexicalFunctions: input.lexicalFunctions, structuralShapes: context.structuralShapes,
    carrierHost: input.carrierHost });
  const captures = createRustNativeCapturePlan({ records, storage: sourceStorage, nativeStorage: queries });
  physical = createRustGenericCallablePhysicalPlan(generic.definitions, generic.definitionFor, {
    ast, lifetimes: input.lifetimes, storage: sourceStorage, captures, native,
    genericBindingsFor: queries.genericBindingsFor, boundSubjectFor: queries.boundSubjectFor,
  });
  if (constructionErrorsReady) for (const producer of producers.producers) queries.prepareReturn(producer.declaration);
  const storage = finalizeRustNativeParameterStorage({ ast, storage: sourceStorage, nativeNodes: input.nativeNodes, records }, queries);
  const occurrences = prepareRustProviderSourceOccurrences({ ast, records, nodes: input.nativeNodes,
    isNativeNode: input.isNativeNode, semantics: sourceStorage.source.semantics });
  assert.equal(occurrences.kind, "resolved", "the canonical source owner selects the entire original occurrence vector");
  return { physical, producers, storage, sourceOccurrences: occurrences.value };
}

function completeLifecycle(input, physical) {
  const lifecycle = createRustPhysicalCallableLifecycle(input);
  physical.closeAdmission();
  return lifecycle.complete(physical);
}

function fixture({ missingResult = false, pendingErrors = false, provider = false } = {}) {
  const checked = provider
    ? (checkedProviderContext ??= checkedSource(`${fixtureSource}
export function inspect(value: string, word: string): boolean { return value.includes(word); }`, { surfaces: ["js"] }))
    : (checkedContext ??= checkedSource(fixtureSource));
  const { context, input: constructionInput } = checked;
  const { ast, records, sourceStorage } = context;
  const declaration = sourceStorage.nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "stored");
  const owner = sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "owner");
  const metadata = sourceStorage.nodes.find(node => ast.is.IsTypeAliasDeclaration(node));
  const invoked = sourceStorage.nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "retainedInvoked");
  const invocation = invoked === undefined ? undefined : ast.as.AsVariableDeclaration(invoked)?.Initializer;
  const operand = invocation === undefined ? undefined : ast.arguments(invocation)[0];
  assert.equal(declaration !== undefined && owner !== undefined && metadata !== undefined &&
    invocation !== undefined && operand !== undefined, true, "all request subjects are actual checked source nodes");
  const operation = records.targetOperation.get(invocation);
  assert.equal(operation?.kind === "source-call" && operation.target.form === "callable" &&
    rustGenericCallableValue(operation.target.carrier) !== undefined, true,
  "the invocation subject has the actual quantified callable storage selected by the canonical request owner");
  assert.equal(context.callableValues.native.callFor(invocation) === undefined, true,
    "the retained invocation subject is not a native input Fn call with a different request contract");
  const direct = sourceStorage.nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "invoked");
  const directInvocation = direct === undefined ? undefined : ast.as.AsVariableDeclaration(direct)?.Initializer;
  const directOperation = directInvocation === undefined ? undefined : records.targetOperation.get(directInvocation);
  assert.equal(directOperation?.kind === "source-call" && directOperation.target.form === "function", true,
    "the original module const quantified arrow selects a direct native function, not retained invocation storage");
  const construction = physicalConstruction(checked, { constructionErrorsReady: !pendingErrors,
    unavailableReturns: missingResult ? new Set([owner]) : new Set() });
  const storage = construction.storage;
  const calls = [];
  const outcomes = new Map();
  let open = true;
  const observe = (role, node, select) => {
    assert.equal(open, true, `${role}: physical storage construction is open`);
    const selection = outcomes.get(role) ?? select(node);
    calls.push({ role, node, selection });
    return selection;
  };
  const nativeStorage = Object.freeze({
    issues: storage.issues,
    logicalCarrierFor: storage.logicalCarrierFor,
    genericBindingsFor: storage.genericBindingsFor,
    futureEnvironmentFor: storage.futureEnvironmentFor,
    parameterFor: storage.parameterFor,
    returnFor: storage.returnFor,
    prepareReturn: node => observe("return", node, storage.prepareReturn),
    valueFor: node => observe("value", node, storage.valueFor),
    operandFor: node => observe("operand", node, storage.operandFor),
    invocationCallableFor: node => observe("invocation", node, storage.invocationCallableFor),
    subjectFor: storage.subjectFor,
    boundSubjectFor: storage.boundSubjectFor,
    invocationReturnFor: storage.invocationReturnFor,
    invocationInputFor: storage.invocationInputFor,
    invocationWitnessFor: storage.invocationWitnessFor,
    invocationArgumentWitnessFor: storage.invocationArgumentWitnessFor,
    invocationOriginsFor: storage.invocationOriginsFor,
    implementationOriginsFor: storage.implementationOriginsFor,
  });
  const producer = construction.producers;
  let sealedRequests;
  const nativeProducers = Object.freeze({
    producers: producer.producers,
    forDeclaration: producer.forDeclaration,
    forIdentity: producer.forIdentity,
    errorFor: producer.errorFor,
    deferredFor: producer.deferredFor,
    deferredErrorFor: producer.deferredErrorFor,
    outwardReturnFor: producer.outwardReturnFor,
    invocationResultFor: producer.invocationResultFor,
    bodyResultFor: producer.bodyResultFor,
    physicalFor: producer.physicalFor,
    selectConstructionErrors: producer.selectConstructionErrors,
    seal(requests) { sealedRequests = requests; return producer.seal(requests); },
  });
  const physical = construction.physical;
  const bindings = Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
  const request = (kind, subject, extra = {}, specialization = "original") => Object.freeze({
    kind, subject, owner: ast.getSourceFile(subject), bindings,
    context: targetUseSiteRef(subject, `physical-${kind}`, rustEmissionSourceIdentity(ast, ast.getSourceFile(subject)), specialization), ...extra,
  });
  const input = requests => ({ ast, records, sourceStorage, requests: Object.freeze(requests),
    sourceOccurrences: construction.sourceOccurrences,
    typeDefinitions: context.typeDefinitions, lexicalFunctions: constructionInput.lexicalFunctions,
    structuralShapes: context.structuralShapes, adapterFlows: Object.freeze([]), nativeStorage, nativeProducers });
  return { ast, records, sourceStorage, declaration, owner, metadata, invocation, operand, calls, outcomes,
    physical, request, input, sealedRequests: () => sealedRequests, close: () => { open = false; } };
}

test("required metadata elaboration does not invent a runtime value or operand request", () => {
  const current = fixture();
  const requests = [current.request("type", current.metadata, { carrier: boolCarrier })];
  const input = current.input(requests);
  const ast = Proxy.revocable(input.ast, {});
  const records = Proxy.revocable(input.records, {});
  const lifecycle = createRustPhysicalCallableLifecycle({ ...input, ast: ast.proxy, records: records.proxy });
  current.physical.closeAdmission();
  ast.revoke();
  records.revoke();
  const result = lifecycle.complete(current.physical);
  assert.equal(result.kind, "resolved", "the real metadata owner has its explicit type elaboration");
  assert.equal(current.calls.length, 0, "metadata never becomes a generic runtime storage query");
  assert.equal(result.value.nativeStorage.valueFor(current.metadata).kind, "unresolved", "unrequested runtime value stays absent");
  assert.equal(result.value.nativeStorage.operandFor(current.metadata).kind, "unresolved", "unrequested runtime operand stays absent");
});

test("all four required runtime roles materialize the exact original checked subjects once", () => {
  const current = fixture();
  const requests = [current.request("value", current.declaration), current.request("operand", current.operand),
    current.request("return", current.owner), current.request("invocation", current.invocation)];
  const lifecycle = createRustPhysicalCallableLifecycle(current.input(requests));
  assert.equal(Object.isFrozen(lifecycle.prepared), true, "the early view contains readonly lookup-only data, not construction methods");
  for (const request of requests) {
    const method = request.kind === "invocation" ? "invocationCallableFor" : `${request.kind}For`;
    const prepared = lifecycle.prepared[method](request.subject);
    if (request.kind === "return") {
      const original = current.input([]).nativeStorage.returnFor(request.subject);
      assert.equal(original.kind !== "unresolved" && prepared === original, true,
        "the actual producer return prerequisite was already completed while its physical family was open");
    } else assert.equal(prepared.kind, request.kind === "invocation" ? "selected" : "unresolved",
      `${request.kind}: only the actual quantified invocation is admitted while family construction is open`);
    assert.equal(lifecycle.prepared[method](current.metadata).kind, "unresolved",
      `${request.kind}: unrelated checked metadata never becomes an attempted runtime selection`);
  }
  assert.equal(current.calls.length, 1, "only the actual quantified invocation is selected during open family admission");
  current.physical.closeAdmission();
  const result = lifecycle.complete(current.physical);
  assert.equal(result.kind, "resolved", "every required runtime role is prepared before publication");
  for (const request of requests) {
    const selected = current.calls.filter(call => call.role === request.kind && call.node === request.subject);
    assert.equal(selected.length, 1, `${request.kind}: one exact construction selection`);
    const method = request.kind === "invocation" ? "invocationCallableFor" : `${request.kind}For`;
    assert.equal(result.value.nativeStorage[method](request.subject).kind !== "unresolved", true,
      `${request.kind}: selected storage remains published under the original subject`);
    assert.equal(result.value.nativeStorage[method](request.subject) === selected[0].selection, true,
      `${request.kind}: the entire canonical native selection is published unchanged`);
    assert.equal(result.value.nativeStorage[method] === lifecycle.prepared[method], true,
      `${request.kind}: final publication reuses the same original materialization lookup`);
    assert.equal(lifecycle.prepared[method](request.subject) === selected[0].selection, true,
      `${request.kind}: early and final views never create a second cache or replay the selector`);
  }
  assert.equal(current.calls.length, requests.length, "all repeated view reads leave exactly the four real required selections");
});

test("distinct actual contexts retain one canonical subject selection without rebinding", () => {
  const current = fixture();
  const first = current.request("value", current.declaration, {}, "first");
  const second = current.request("value", current.declaration, {}, "second");
  const requests = Object.freeze([first, second]);
  const result = completeLifecycle(current.input(requests), current.physical);
  assert.equal(result.kind, "resolved", "both original use contexts are admitted");
  assert.equal(first.context === second.context, false, "the original use-site identities remain distinct");
  assert.equal(first.bindings === second.bindings, true, "the original canonical binding identity is not replaced");
  assert.equal(current.calls.filter(call => call.role === "value" && call.node === current.declaration).length, 1,
    "context transport does not repeat canonical physical selection");
  assert.equal(Object.isFrozen(requests) && requests.every(Object.isFrozen), true, "the selecting-owner inventory stays frozen");
});

function providerFixture() {
  const current = fixture({ provider: true });
  const input = current.input([]);
  const occurrence = input.sourceOccurrences.find(value => value.slots.length === 2);
  const owner = current.sourceStorage.nodes.find(node => current.ast.is.IsFunctionDeclaration(node) &&
    current.ast.text(current.ast.name(node)) === "inspect");
  assert.equal(occurrence !== undefined && owner !== undefined, true, "the real native provider owner has both original source slots");
  const request = (kind, slot = occurrence.slots[0]) => current.request(kind, slot.node, { owner,
    context: targetUseSiteRef(slot, slot.key, rustEmissionSourceIdentity(current.ast, owner)) });
  return { ...current, occurrence, providerOwner: owner, slotRequest: request };
}

test("checked AST source sites and original provider slots retain both valid identity classes", () => {
  const current = providerFixture();
  const astUse = current.request("operand", current.operand, { context: targetUseSiteRef(current.invocation,
    "argument:0", rustEmissionSourceIdentity(current.ast, current.ast.getSourceFile(current.invocation))) });
  const requests = [astUse, ...current.occurrence.slots.flatMap(slot =>
    [current.slotRequest("value", slot), current.slotRequest("operand", slot)])];
  const result = completeLifecycle(current.input(requests), current.physical);
  assert.equal(result.kind, "resolved", "original call-owner AST and original selected slot identities both admit");
  assert.equal(astUse.context.subject === current.invocation && astUse.subject !== current.invocation, true,
    "an AST use site is not incorrectly replaced by its operand node");
  for (const request of requests.slice(1)) {
    assert.equal(current.occurrence.slots.includes(request.context.subject), true, "the context retains the exact original slot object");
    const method = `${request.kind}For`;
    const selected = current.calls.find(call => call.role === request.kind && call.node === request.subject);
    assert.equal(selected !== undefined && result.value.nativeStorage[method](request.subject) === selected.selection, true,
      "the original required slot has its complete canonical physical result");
  }
});

test("foreign, copied, mismatched and rebound context identities reject before any materialization", () => {
  for (const changed of ["copied-slot", "other-slot", "slot-role", "unrelated-AST", "owner", "contract", "bindings",
    "operation-node", "operation", "duplicate-slot"]) {
    const current = providerFixture();
    const original = current.slotRequest("operand");
    const input = current.input([]);
    let requests = [original];
    let sourceOccurrences = input.sourceOccurrences;
    if (["copied-slot", "other-slot", "slot-role", "unrelated-AST"].includes(changed)) {
      const subject = changed === "copied-slot" ? Object.freeze({ ...original.context.subject })
        : changed === "other-slot" ? current.occurrence.slots[1]
        : changed === "unrelated-AST" ? current.metadata : original.context.subject;
      requests = [Object.freeze({ ...original, context: targetUseSiteRef(subject,
        changed === "slot-role" ? "foreign-slot" : original.context.role, original.context.enclosingContract) })];
    } else if (changed === "owner") requests = [Object.freeze({ ...original, owner: current.owner })];
    else if (changed === "contract") requests = [Object.freeze({ ...original,
      context: targetUseSiteRef(original.context.subject, original.context.role, "foreign-contract") })];
    else if (changed === "bindings") requests = [original, Object.freeze({ ...current.slotRequest("value"),
      bindings: Object.freeze({ ...original.bindings }) })];
    else {
      const slot = changed === "duplicate-slot" ? original.context.subject : Object.freeze({ ...original.context.subject,
        ...(changed === "operation-node" ? { operationNode: current.invocation }
          : { operation: current.records.targetOperation.get(current.invocation) }) });
      sourceOccurrences = Object.freeze(input.sourceOccurrences.map(occurrence => occurrence !== current.occurrence ? occurrence
        : Object.freeze({ ...occurrence, slots: Object.freeze(changed === "duplicate-slot" ? [...occurrence.slots, slot]
          : occurrence.slots.map(value => value === original.context.subject ? slot : value)) })));
      requests = [Object.freeze({ ...original, context: targetUseSiteRef(slot, slot.key, original.context.enclosingContract) })];
    }
    const result = completeLifecycle({ ...input, requests: Object.freeze(requests), sourceOccurrences }, current.physical);
    assert.equal(result.kind, "rejected", `${changed}: exact original correlation is mandatory`);
    assert.equal("value" in result, false, `${changed}: no partial physical publication`);
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED"), true,
      `${changed}: the existing admission owner reports the precise missing correspondence`);
    assert.equal(current.calls.length, 0, `${changed}: no runtime physical selection precedes complete context admission`);
    assert.equal(current.sealedRequests() === undefined, true, `${changed}: no producer publication`);
  }
});

test("physical lifecycle requires the original selected source occurrence vector without an old-form default", () => {
  const current = fixture();
  const { sourceOccurrences, ...old } = current.input([]);
  assert.equal(Object.isFrozen(sourceOccurrences), true, "a genuinely empty selected domain remains explicit immutable input");
  assert.throws(() => createRustPhysicalCallableLifecycle(old), /requires its original selected source occurrence vector/u,
    "no optional legacy input or reconstructed slot inventory");
  assert.equal(current.calls.length, 0, "removed-form rejection precedes runtime queries");
});

test("explicit producer requests retain every actual checked source correspondence", () => {
  const current = fixture();
  const requests = current.sourceStorage.nodes.flatMap(node => {
    const reference = current.records.directCallableReference.get(node);
    return reference === undefined ? [] : [current.request("producer", node, {
      declaration: reference.sourceDeclaration, carrier: reference.carrier,
    })];
  });
  assert.equal(requests.length > 0, true, "the actual first-class function reference supplies producer evidence");
  const result = completeLifecycle(current.input(requests), current.physical);
  assert.equal(result.kind, "resolved", "the complete actual producer vector is admitted");
  for (const request of requests) {
    assert.equal(current.sealedRequests().includes(request), true,
      "every original producer row, use-site and binding identity reaches its sole finalizer");
    const physical = result.value.nativeProducers.physicalFor(request.declaration, request.carrier);
    assert.equal(physical !== undefined, true, "every required producer publishes its selected physical implementation");
    const signature = rustCallablePhysicalSignature(physical);
    const logical = rustCallableProtocol(request.carrier);
    assert.equal(signature !== undefined && logical !== undefined, true, "actual complete logical and physical native signatures");
    assert.equal(signature.parameters.length, logical.parameters.length, "exact native source arity");
    for (const [index, parameter] of logical.parameters.entries()) assert.equal(
      rustTargetTypeRefEquals(signature.parameters[index], parameter), true, `${index}: complete native parameter correspondence`);
    assert.equal(rustTargetTypeRefEquals(signature.result,
      result.value.nativeProducers.invocationResultFor(request.declaration)), true, "the actual completed result is retained");
    assert.equal(rustTargetTypeRefEquals(signature.error,
      result.value.nativeProducers.errorFor(request.declaration, "invoke")), true, "the exact native invocation error identity is retained");
    const native = rustNamedTypeCarrierValue(physical);
    assert.equal(native !== undefined, true, "the actual retained producer has its canonical native named carrier");
    assert.equal(native.genericArguments[0]?.kind === "lifetime" &&
      rustLifetimesEqual(native.genericArguments[0].lifetime, logical.lifetime), true,
    "the selected native construction lifetime is retained, never defaulted");
  }
  assert.equal(current.calls.length, 0, "producer correspondence never becomes a synthetic runtime storage request");
});

function requiredOwner(current, specialization) {
  const reference = current.sourceStorage.nodes.map(node => current.records.directCallableReference.get(node))
    .find(value => value?.sourceDeclaration === current.owner);
  assert.equal(reference !== undefined, true, "the actual source use supplies its complete callable carrier");
  return current.request("producer", current.invocation, {
    declaration: current.owner, carrier: reference.carrier,
  }, specialization);
}

test("all missing and wrong required producer correspondences reject before any publication", () => {
  const current = fixture();
  const original = requiredOwner(current, "original");
  const zero = current.sourceStorage.nodes.map(node => current.records.directCallableReference.get(node))
    .find(value => value !== undefined && current.ast.text(current.ast.name(value.sourceDeclaration)) === "zero");
  assert.equal(zero !== undefined, true, "the mismatched arity comes from a real valid zero-argument source callable");
  const protocol = rustCallableProtocol(original.carrier);
  assert.equal(protocol !== undefined, true, "the original required protocol is complete");
  const bare = rustCallableInputTargetType(protocol.parameters, protocol.result);
  const requests = [
    current.request("producer", current.invocation, { declaration: current.owner, carrier: zero.carrier }, "wrong-arity"),
    current.request("producer", current.operand, { declaration: current.declaration, carrier: original.carrier }, "missing-producer"),
    current.request("producer", current.owner, { declaration: current.owner, carrier: bare.referent }, "missing-retained-lifetime"),
  ];
  const result = completeLifecycle(current.input(requests), current.physical);
  assert.equal(result.kind, "rejected", "every incomplete actual required pair stops publication");
  assert.equal("value" in result, false, "no successful or partial callable program is exposed");
  assert.equal(result.diagnostics.length, requests.length, "every original required context is diagnosed");
  for (const request of requests) {
    assert.equal(current.sealedRequests().includes(request), true, `${request.context.specialization}: original immutable request retained`);
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_NATIVE_CALLABLE_PRODUCER_NOT_PROVEN" &&
      diagnostic.sourceNode === request.subject && diagnostic.evidence.includes(`specialization=${request.context.specialization}`)), true,
    `${request.context.specialization}: original source/use context, not a declaration-only or first-context diagnostic`);
  }
});

test("missing actual result and pending actual error selection are rejected as whole required producer stages", () => {
  for (const [label, options, reason] of [
    ["result", { missingResult: true }, "A required native callable producer has no completed exact invocation result."],
    ["errors", { pendingErrors: true }, "Native retained constructors require their completed source-error ABI selection."],
  ]) {
    const current = fixture(options);
    const request = requiredOwner(current, label);
    const result = completeLifecycle(current.input([request]), current.physical);
    assert.equal(result.kind, "rejected", `${label}: the genuinely missing canonical input is not identity or infallible`);
    assert.equal("value" in result, false, `${label}: no partial publication`);
    assert.equal(result.diagnostics.length, 1, `${label}: one exact required source failure`);
    assert.equal(result.diagnostics[0].sourceNode === request.subject && result.diagnostics[0].message === reason, true,
      `${label}: original subject and owning selector's exact missing prerequisite`);
    assert.throws(() => current.input([]).nativeProducers.seal([]), /exactly once/u, `${label}: no retry over cached provisional data`);
  }
});

test("the sole native producer finalizer rejects a foreign declaration before inspecting its carrier", () => {
  const current = fixture();
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign native carrier"); } });
  const request = current.request("producer", current.invocation, { declaration: foreign, carrier: foreign });
  const result = current.input([]).nativeProducers.seal(Object.freeze([request]));
  assert.equal(result.kind, "rejected", "the actual producer owner rejects foreign correspondence itself");
  assert.equal("value" in result, false, "no partial native producer publication");
  assert.equal(result.diagnostics.length === 1 && result.diagnostics[0].sourceNode === request.subject, true,
    "the original use subject is retained");
  assert.equal(inspected, 0, "foreign identity is rejected without any carrier inspection");
});

test("a genuine native input Fn keeps its native closure ABI without a retained lifetime requirement", () => {
  const current = fixture();
  const original = requiredOwner(current, "native-input");
  const logical = rustCallableProtocol(original.carrier);
  const carrier = rustCallableInputTargetType(logical.parameters, logical.result);
  const request = Object.freeze({ ...original, carrier });
  const result = completeLifecycle(current.input([request]), current.physical);
  assert.equal(result.kind, "resolved", "the actual non-retained native Fn protocol remains supported");
  const physical = result.value.nativeProducers.physicalFor(request.declaration, carrier);
  assert.equal(physical?.kind, "closure", "native input representation does not become a retained runtime wrapper");
  const signature = rustCallablePhysicalSignature(physical);
  assert.equal(signature !== undefined && rustTargetTypeRefEquals(signature.result,
    result.value.nativeProducers.invocationResultFor(request.declaration)), true, "the same exact native invocation result");
  assert.equal(rustTargetTypeRefEquals(signature.error,
    result.value.nativeProducers.errorFor(request.declaration, "invoke")), true, "the same exact native invocation error");
});

test("ordinary direct native declarations do not invent a required retained constructor", () => {
  const checked = checkedSource("export function direct(value: boolean): boolean { return value; } export const stored = direct(true);");
  const { context, input } = checked;
  const invocation = context.sourceStorage.nodes.find(node => context.ast.is.IsCallExpression(node));
  const operation = context.records.targetOperation.get(invocation);
  assert.equal(operation?.kind === "source-call" && operation.target.form === "function", true,
    "the actual ordinary direct invocation is not a quantified callable storage request");
  const { storage, producers, physical, sourceOccurrences } = physicalConstruction(checked, { constructionErrorsReady: false });
  const result = completeLifecycle({ ast: context.ast, records: context.records, sourceStorage: context.sourceStorage,
    requests: Object.freeze([]), sourceOccurrences, typeDefinitions: context.typeDefinitions, lexicalFunctions: input.lexicalFunctions,
    structuralShapes: context.structuralShapes, adapterFlows: Object.freeze([]), nativeStorage: storage,
    nativeProducers: producers }, physical);
  assert.equal(result.kind, "resolved", "a declaration alone is not a stored retained callable demand");
  assert.equal(result.value.nativeProducers.producers.length, 1, "the real direct native declaration remains published");
  assert.equal(result.value.nativeStorage.invocationCallableFor(invocation).kind, "unresolved",
    "the original direct call does not invent an unrequested retained invocation selection");
  const direct = compileRust({ surfaces: [], files: { "index.ts": `
const quantified = <Value>(value: Value): Value => value;
export const invoked = quantified<boolean>(true);
` } });
  assert.equal(direct.result.diagnostics.filter(diagnostic => diagnostic.category === "error").length, 0,
    "the original module const-arrow program remains accepted without retained invocation storage");
  assert.match(rustSourceText(direct.result), /\bfn quantified(?:<|\()/u,
    "the original const-arrow is emitted as a direct native function");
});

test("native producer finalization rejects its removed declaration-to-carrier map API", () => {
  const current = fixture();
  assert.throws(() => current.input([]).nativeProducers.seal(new Map()),
    /requires its complete selecting-owner request vector/u, "no old-form producer finalization fallback");
});

test("required unresolved selections reject all roles before publishing a partial physical program", () => {
  const current = fixture();
  const requests = [current.request("value", current.declaration), current.request("operand", current.operand),
    current.request("return", current.owner), current.request("invocation", current.invocation)];
  for (const request of requests) current.outcomes.set(request.kind,
    Object.freeze({ kind: "unresolved", reason: `required ${request.kind} evidence is absent` }));
  const result = completeLifecycle(current.input(requests), current.physical);
  assert.equal(result.kind, "rejected", "missing actual uses are source-stage rejection, never ignored or identity");
  assert.equal("value" in result, false, "no partial physical publication escapes");
  assert.equal(result.diagnostics.length, requests.length, "every required missing role is reported");
  for (const request of requests) assert.equal(result.diagnostics.some(diagnostic => diagnostic.sourceNode === request.subject &&
    diagnostic.message === `required ${request.kind} evidence is absent`), true, `${request.kind}: exact subject and reason preserved`);
  assert.equal(current.sealedRequests() === undefined, true, "native producer publication has not run");
});

test("required unresolved selections preserve the original deciding-owner diagnostics for all runtime roles", () => {
  const current = fixture();
  const requests = [current.request("value", current.declaration), current.request("operand", current.operand),
    current.request("return", current.owner), current.request("invocation", current.invocation)];
  const decided = requests.map(request => Object.freeze({
    code: "RUST_SOURCE_CALLABLE_SPECIALIZATION_NOT_CLOSED", category: "error", source: "tsonic-rust",
    sourceNode: request.subject,
    message: "Native callable storage has distinct physical input alternatives requiring a sealed join.",
    evidence: Object.freeze(["target.capability=rust.source-callable.finite-specialization"]),
  }));
  for (const [index, request] of requests.entries()) current.outcomes.set(request.kind,
    Object.freeze({ kind: "unresolved", reason: decided[index].message, diagnostic: decided[index] }));
  const result = completeLifecycle(current.input(requests), current.physical);
  assert.equal(result.kind, "rejected", "an owner refusal prevents every physical publication");
  assert.equal("value" in result, false, "no partial program escapes its source refusal");
  assert.equal(result.diagnostics.length, decided.length, "every original obligation retains its diagnostic multiplicity");
  for (const [index, diagnostic] of result.diagnostics.entries()) {
    assert.equal(diagnostic === decided[index], true, `${requests[index].kind}: the complete deciding-owner object is preserved`);
    assert.equal(diagnostic.sourceNode === requests[index].subject, true, `${requests[index].kind}: the exact original source span is retained`);
  }
  assert.equal(current.sealedRequests() === undefined, true, "the rejected program never publishes native producers");
});

test("foreign source subjects and owners reject before storage queries or carrier inspection", () => {
  for (const position of ["subject", "owner", "declaration", "context"]) {
    const current = fixture();
    let inspected = 0;
    const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign source"); } });
    const request = position === "declaration"
      ? current.request("producer", current.declaration, { declaration: foreign, carrier: foreign })
      : position === "context" ? current.request("value", current.declaration, {
          context: Object.freeze({ ...current.request("value", current.declaration).context, subject: foreign }),
        })
      : current.request("value", current.declaration, { [position]: foreign });
    const result = completeLifecycle(current.input([request]), current.physical);
    assert.equal(result.kind, "rejected", `${position}: required source ownership is checked`);
    assert.equal("value" in result, false, `${position}: no partial publication`);
    assert.equal(current.calls.length, 0, `${position}: no speculative storage query`);
    assert.equal(inspected, 0, `${position}: foreign source or carrier is not inspected`);
    assert.equal(current.sealedRequests() === undefined, true, `${position}: no producer publication`);
  }
});

test("missing original use contexts, bindings and type carriers cannot publish an incomplete request", () => {
  for (const missing of ["context", "bindings", "carrier"]) {
    const current = fixture();
    const request = current.request("type", current.metadata, { carrier: boolCarrier, [missing]: undefined });
    const result = completeLifecycle(current.input([request]), current.physical);
    assert.equal(result.kind, "rejected", `${missing}: required original input is absent`);
    assert.equal("value" in result, false, `${missing}: no partial publication`);
    assert.equal(current.calls.length, 0, `${missing}: no replacement storage query`);
    assert.equal(current.sealedRequests() === undefined, true, `${missing}: no producer publication`);
  }
});

test("published required storage remains stable after construction readers are revoked", () => {
  const current = fixture();
  const input = current.input([current.request("value", current.declaration), current.request("operand", current.operand),
    current.request("return", current.owner), current.request("invocation", current.invocation)]);
  const ast = Proxy.revocable(input.ast, {});
  const records = Proxy.revocable(input.records, {});
  const lifecycle = createRustPhysicalCallableLifecycle({ ...input, ast: ast.proxy, records: records.proxy });
  current.physical.closeAdmission();
  const result = lifecycle.complete(current.physical);
  assert.equal(result.kind, "resolved", "all required decisions complete before source services close");
  const storage = result.value.nativeStorage;
  const before = [storage.valueFor(current.declaration), storage.operandFor(current.operand),
    storage.returnFor(current.owner), storage.invocationCallableFor(current.invocation)];
  const count = current.calls.length;
  ast.revoke();
  records.revoke();
  current.close();
  for (let index = 0; index < 3; index += 1) {
    assert.equal(storage.valueFor(current.declaration) === before[0], true, "value is a stable final lookup");
    assert.equal(storage.operandFor(current.operand) === before[1], true, "operand is a stable final lookup");
    assert.equal(storage.returnFor(current.owner) === before[2], true, "return is a stable final lookup");
    assert.equal(storage.invocationCallableFor(current.invocation) === before[3], true, "invocation is a stable final lookup");
  }
  assert.equal(current.calls.length, count, "publication never reopens computing storage queries");
  assert.throws(() => lifecycle.complete(current.physical), /exactly once/u, "one physical publication");
});

test("the removed node-inventory API is rejected rather than accepted as a hidden request fallback", () => {
  const current = fixture();
  const { requests, ...withoutRequests } = current.input([]);
  assert.equal(Object.isFrozen(requests), true, "the current explicit empty vector is real input, not a fallback");
  assert.throws(() => createRustPhysicalCallableLifecycle({ ...withoutRequests, nativeNodes: current.sourceStorage.nodes }),
    /requires its complete selecting-owner request vector/u, "the old input is no longer accepted");
  assert.equal(current.calls.length, 0, "removed-form rejection precedes every storage query");
});

test("required stored native Futures retain their original physical producer through aliases and return", () => {
  const checked = checkedSource(`
export async function first(): Promise<boolean> { return true; }
export async function second(): Promise<boolean> { return false; }
export function retainFirst(): Promise<boolean> {
  const created = first();
  const aliased = created;
  return aliased;
}
export function retainSecond(): Promise<boolean> {
  const other = second();
  const selected = other;
  return selected;
}`);
  const { context, input: constructionInput } = checked;
  const { ast, records, sourceStorage } = context;
  const { storage, producers, physical, sourceOccurrences } = physicalConstruction(checked);
  const named = (name, predicate) => sourceStorage.nodes.find(node => predicate(node) &&
    ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
  const declaration = name => named(name, ast.is.IsFunctionDeclaration);
  const variable = name => named(name, ast.is.IsVariableDeclaration);
  const bindings = Object.freeze({ types: new Map(), lifetimes: new Map(), consts: new Map() });
  const requests = Object.freeze([
    ...["created", "aliased", "other", "selected"].map(name => {
      const subject = variable(name);
      assert.equal(subject !== undefined, true, `${name}: actual source storage declaration`);
      return Object.freeze({ kind: "value", subject, owner: ast.getSourceFile(subject), bindings,
        context: targetUseSiteRef(subject, "stored-native-future", rustEmissionSourceIdentity(ast, ast.getSourceFile(subject)), name) });
    }),
    ...["retainFirst", "retainSecond"].map(name => {
      const subject = declaration(name);
      assert.equal(subject !== undefined, true, `${name}: actual source return owner`);
      return Object.freeze({ kind: "return", subject, owner: subject, bindings,
        context: targetUseSiteRef(subject, "returned-native-future", rustEmissionSourceIdentity(ast, subject), name) });
    }),
  ]);
  const result = completeLifecycle({ ast, records, sourceStorage, requests, sourceOccurrences,
    typeDefinitions: context.typeDefinitions, lexicalFunctions: constructionInput.lexicalFunctions,
    structuralShapes: context.structuralShapes, adapterFlows: Object.freeze([]),
    nativeStorage: storage, nativeProducers: producers }, physical);
  assert.equal(result.kind, "resolved", "every genuinely stored Future use has its exact selected source origin");
  const first = result.value.nativeProducers.invocationResultFor(declaration("first"));
  const second = result.value.nativeProducers.invocationResultFor(declaration("second"));
  assert.equal(first?.kind === "impl-trait" && second?.kind === "impl-trait", true,
    "actual native async bodies keep their opaque Future representations");
  assert.equal(first.id === second.id, false, "equal output signatures never collapse distinct physical native producers");
  assert.equal(rustTargetTypeRefEquals(first, second), false, "one producer cannot witness another producer's storage");
  for (const [name, expected] of [["created", first], ["aliased", first], ["other", second], ["selected", second]]) {
    const selected = result.value.nativeStorage.valueFor(variable(name));
    assert.equal(selected.kind, "selected", `${name}: exact native producer storage, never logical identity`);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, expected), true, `${name}: original physical producer survives aliasing`);
    assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.carrier), true, `${name}: final immutable evidence`);
  }
  for (const [name, expected] of [["retainFirst", first], ["retainSecond", second]]) {
    const selected = result.value.nativeStorage.returnFor(declaration(name));
    assert.equal(selected.kind, "selected", `${name}: exact returned physical implementation`);
    assert.equal(rustTargetTypeRefEquals(selected.carrier, expected), true, `${name}: no invented forwarding producer`);
  }
  const foreign = Object.freeze({});
  assert.equal(result.value.nativeProducers.invocationResultFor(foreign) === undefined, true,
    "foreign declarations never acquire an opaque producer by output signature");
  assert.equal(result.value.nativeStorage.valueFor(foreign).kind, "unresolved", "foreign runtime requests remain absent");
  assert.equal(result.value.nativeStorage.valueFor(declaration("first")).kind, "unresolved",
    "native producer metadata never manufactures an unrequested runtime value");
});

test("the sole generic identity source inventory supplies the exact same comparison rows to storage", () => {
  const checked = checkedSource(`
async function first(value: number): Promise<number> { return value; }
async function second(value: number): Promise<number> { return value; }
function selected(): typeof first { return first; }
export function compare(): boolean {
  const alias = selected();
  return alias === first && alias !== second;
}`);
  const { context } = checked;
  const ast = Proxy.revocable(context.ast, {});
  const records = Proxy.revocable(context.records, {});
  const sources = prepareRustGenericCallableIdentitySources({ ast: ast.proxy,
    nodes: context.sourceStorage.nodes, records: records.proxy });
  assert.equal(sources.failure === undefined, true, "the complete actual comparison inventory is within the existing budget");
  assert.equal(sources.comparisons.length, 2, "both actual equality and inequality source uses are retained");
  assert.equal(Object.isFrozen(sources) && Object.isFrozen(sources.comparisons) &&
    sources.comparisons.every(Object.isFrozen), true, "the selecting owner publishes frozen source rows once");
  ast.revoke();
  records.revoke();
  const construction = physicalConstruction(checked);
  const owner = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "compare");
  const bindings = rustEmissionIdentityBindings([]);
  assert.equal(owner !== undefined && bindings !== undefined, true, "the actual nongeneric comparison owner supplies its canonical binding identity");
  const uses = sources.comparisons.flatMap(source => ["left", "right"].flatMap(position => {
    const subject = source[`${position}Node`];
    assert.equal(subject !== undefined, true, `${position}: the actual checked comparison operand is present`);
    const use = targetUseSiteRef(source.node, `callable-identity:${position}`, rustEmissionSourceIdentity(context.ast, owner));
    return ["value", "operand"].map(kind => Object.freeze({ kind, subject, owner, bindings, context: use }));
  }));
  const earlySelections = [];
  const lifecycle = createRustPhysicalCallableLifecycle({ ast: context.ast, records: context.records,
    sourceStorage: context.sourceStorage, requests: Object.freeze(uses), sourceOccurrences: construction.sourceOccurrences,
    typeDefinitions: context.typeDefinitions, lexicalFunctions: checked.input.lexicalFunctions,
    structuralShapes: context.structuralShapes, adapterFlows: Object.freeze([]), nativeProducers: construction.producers,
    nativeStorage: Object.freeze({ ...construction.storage, valueFor(node) {
      earlySelections.push(node);
      return construction.storage.valueFor(node);
    } }) });
  const expectedSubjects = new Set(uses.map(use => use.subject));
  assert.equal(earlySelections.length, expectedSubjects.size, "every required generic value is selected exactly once before family admission closes");
  const earlyRequests = prepareRustGenericCallableIdentityRequests({ sources, nativeStorage: lifecycle.prepared });
  for (const source of sources.comparisons) {
    const selected = earlyRequests.operands.get(source.node);
    assert.equal(selected?.left === lifecycle.prepared.valueFor(source.leftNode) &&
      selected?.right === lifecycle.prepared.valueFor(source.rightNode), true, "identity consumes the original materializations without a raw query");
    assert.equal(selected.left.kind !== "unresolved" && selected.right.kind !== "unresolved", true,
      "real early generic-family preparation is retained, not silently deferred or omitted");
  }
  construction.physical.closeAdmission();
  for (const subject of expectedSubjects) assert.equal(lifecycle.prepared.valueFor(subject).kind !== "unresolved", true,
    "closing family admission cannot turn the view into a late selector");
  assert.equal(earlySelections.length, expectedSubjects.size, "all early consumers read the same canonical map without duplicate selection");
  const queried = [];
  const requests = prepareRustGenericCallableIdentityRequests({ sources, nativeStorage: { valueFor(node) {
    queried.push(node);
    return context.callableValues.nativeStorage.valueFor(node);
  } } });
  assert.equal(requests.operands.size, sources.comparisons.length, "every selected source comparison reaches storage preparation");
  for (const source of sources.comparisons) {
    const selected = requests.operands.get(source.node);
    assert.equal(selected?.source === source, true, "the actual immutable source row is transported, not reselected");
    assert.equal(queried.includes(source.leftNode) && queried.includes(source.rightNode), true,
      "both original operand source identities are requested");
  }
  const plan = createRustGenericCallableIdentityPlan({ requests, physical: context.callableValues.generic.physical });
  assert.equal(plan.issues.length, 0, "the original complete identity proofs remain admitted");
  for (const source of sources.comparisons) {
    const selected = plan.forComparison(source.node);
    assert.equal(selected?.operation === source.operation && selected.leftNode === source.leftNode &&
      selected.rightNode === source.rightNode, true, "final identity selection retains every original source identity");
  }
});

test("a failed generic identity source inventory cannot expose or query a successful prefix", () => {
  const current = fixture();
  const budget = createRustEffectsWorkBudget(1);
  const failure = budget.run(() => budget.step(2));
  assert.equal(failure?.code, "RUST_ERROR_EFFECTS_WORK_LIMIT", "the failure is produced by the actual bounded owner");
  let queried = 0;
  const sources = Object.freeze({ comparisons: Object.freeze([]), budget, failure, subject: current.owner });
  const requests = prepareRustGenericCallableIdentityRequests({ sources, nativeStorage: { valueFor() {
    queried += 1;
    throw new Error("a failed source inventory has no storage requests");
  } } });
  const plan = createRustGenericCallableIdentityPlan({ requests, physical: current.physical.plan });
  assert.equal(queried, 0, "failed source admission performs no runtime selection");
  assert.equal(requests.operands.size, 0, "no partial source-to-storage map is exposed");
  assert.equal(plan.issues.length, 1, "the existing owner reports the finite budget failure once");
  assert.equal(plan.issues[0].subject === current.owner &&
    plan.issues[0].message === `Native callable identity exhausted its finite analysis budget: ${failure.message}`, true,
  "the original subject, failure reason and diagnostic contract are preserved");
});

test("generic identity storage preparation rejects its removed scanning input", () => {
  const current = fixture();
  assert.throws(() => prepareRustGenericCallableIdentityRequests({ ast: current.ast, records: current.records,
    nodes: current.sourceStorage.nodes, nativeStorage: { valueFor() { throw new Error("old-form selection"); } } }),
  /requires its exact selected source comparison inventory/u, "the old duplicated source scanner has no compatibility route");
});
