import assert from "node:assert/strict";
import test from "node:test";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { boolCarrier } from "../../helpers/rust-session.mjs";
import { createRustPhysicalCallableLifecycle } from "../../../dist/analysis/callables/physical-lifecycle.js";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustGenericCallablePhysicalPlan } from "../../../dist/analysis/callables/generic-physical.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native-captures.js";
import { createRustNativeStorageQueries } from "../../../dist/analysis/callables/native-storage.js";
import { finalizeRustNativeParameterStorage } from "../../../dist/analysis/callables/native-parameters.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { prepareRustGenericCallableIdentitySources, prepareRustGenericCallableIdentityRequests,
  createRustGenericCallableIdentityPlan } from "../../../dist/analysis/callables/generic-identities.js";
import { createRustEffectsWorkBudget } from "../../../dist/analysis/resources/effects-work-budget.js";

let checkedContext;

function checkedSource(text) {
  let input;
  const context = analyzeRustErrorEffects(text, { surfaces: [] }, current => {
    const original = current.callableValues;
    const callableValues = Object.create(original, {
      initialize: { value(selected) { input = selected; return original.initialize(selected); } },
    });
    return { ...current, callableValues };
  });
  assert.equal(input !== undefined, true, "the real program lifecycle supplies its private construction inputs");
  return { context, input };
}

function physicalConstruction(checked) {
  const { context, input } = checked;
  const { ast, records, sourceStorage } = context;
  const native = context.callableValues.native;
  const generic = context.callableValues.generic;
  let queries;
  let physical;
  const producers = createRustNativeCallableProducerPlan({ ast, nodes: input.nativeNodes, records, native,
    definitions: context.typeDefinitions, returnCarrierFor(node) {
      const selected = queries.returnFor(node);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  producers.selectConstructionErrors(new Map());
  queries = createRustNativeStorageQueries({ ast, nativeNodes: input.nativeNodes, storage: sourceStorage, records,
    definitions: context.typeDefinitions, native, producers, generic,
    physicalCarrierFor: (carrier, fileName, selected) => physical.carrierFor(carrier, fileName, selected),
    lifetimes: input.lifetimes, lexicalFunctions: input.lexicalFunctions, structuralShapes: context.structuralShapes,
    carrierHost: input.carrierHost });
  const captures = createRustNativeCapturePlan({ records, storage: sourceStorage, nativeStorage: queries });
  physical = createRustGenericCallablePhysicalPlan(generic.definitions, generic.definitionFor, {
    ast, storage: sourceStorage, captures, native, boundSubjectFor: queries.boundSubjectFor,
  });
  const storage = finalizeRustNativeParameterStorage({ ast, storage: sourceStorage, nativeNodes: input.nativeNodes, records }, queries);
  return { physical, producers, storage };
}

function completeLifecycle(input, physical) {
  const lifecycle = createRustPhysicalCallableLifecycle(input);
  physical.closeAdmission();
  return lifecycle.complete(physical);
}

function fixture() {
  checkedContext ??= checkedSource(`
type Scalar = boolean;
export function owner(value: boolean): boolean { return value; }
export function expose(): typeof owner { return owner; }
export const stored = owner(true);
`);
  const { context, input: constructionInput } = checkedContext;
  const construction = physicalConstruction(checkedContext);
  const { ast, records, sourceStorage } = context;
  const declaration = sourceStorage.nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "stored");
  const owner = sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "owner");
  const metadata = sourceStorage.nodes.find(node => ast.is.IsTypeAliasDeclaration(node));
  const invocation = declaration === undefined ? undefined : ast.as.AsVariableDeclaration(declaration)?.Initializer;
  const operand = invocation === undefined ? undefined : ast.arguments(invocation)[0];
  assert.equal(declaration !== undefined && owner !== undefined && metadata !== undefined &&
    invocation !== undefined && operand !== undefined, true, "all request subjects are actual checked source nodes");
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
    returnFor: node => observe("return", node, storage.returnFor),
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
    context: targetUseSiteRef(subject, `physical-${kind}`, "physical-request-fixture", specialization), ...extra,
  });
  const input = requests => ({ ast, records, sourceStorage, requests: Object.freeze(requests),
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
  ast.revoke();
  records.revoke();
  const result = completeLifecycle({ ...input, ast: ast.proxy, records: records.proxy }, current.physical);
  assert.equal(result.kind, "resolved", "the real metadata owner has its explicit type elaboration");
  assert.equal(current.calls.length, 0, "metadata never becomes a generic runtime storage query");
  assert.equal(result.value.nativeStorage.valueFor(current.metadata).kind, "unresolved", "unrequested runtime value stays absent");
  assert.equal(result.value.nativeStorage.operandFor(current.metadata).kind, "unresolved", "unrequested runtime operand stays absent");
});

test("all four required runtime roles materialize the exact original checked subjects once", () => {
  const current = fixture();
  const requests = [current.request("value", current.declaration), current.request("operand", current.operand),
    current.request("return", current.owner), current.request("invocation", current.invocation)];
  const result = completeLifecycle(current.input(requests), current.physical);
  assert.equal(result.kind, "resolved", "every required runtime role is prepared before publication");
  for (const request of requests) {
    const selected = current.calls.filter(call => call.role === request.kind && call.node === request.subject);
    assert.equal(selected.length, 1, `${request.kind}: one exact construction selection`);
    const method = request.kind === "invocation" ? "invocationCallableFor" : `${request.kind}For`;
    assert.equal(result.value.nativeStorage[method](request.subject).kind !== "unresolved", true,
      `${request.kind}: selected storage remains published under the original subject`);
    assert.equal(result.value.nativeStorage[method](request.subject) === selected[0].selection, true,
      `${request.kind}: the entire canonical native selection is published unchanged`);
  }
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
  for (const request of requests) assert.equal(current.sealedRequests().get(request.declaration)?.some(carrier =>
    rustTargetTypeRefEquals(carrier, request.carrier)), true, "every original producer and full carrier reaches its sole finalizer");
  assert.equal(current.calls.length, 0, "producer correspondence never becomes a synthetic runtime storage request");
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
  const { storage, producers, physical } = physicalConstruction(checked);
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
        context: targetUseSiteRef(subject, "stored-native-future", "physical-request-fixture", name) });
    }),
    ...["retainFirst", "retainSecond"].map(name => {
      const subject = declaration(name);
      assert.equal(subject !== undefined, true, `${name}: actual source return owner`);
      return Object.freeze({ kind: "return", subject, owner: subject, bindings,
        context: targetUseSiteRef(subject, "returned-native-future", "physical-request-fixture", name) });
    }),
  ]);
  const result = completeLifecycle({ ast, records, sourceStorage, requests,
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
  const context = analyzeRustErrorEffects(`
async function first(value: number): Promise<number> { return value; }
async function second(value: number): Promise<number> { return value; }
function selected(): typeof first { return first; }
export function compare(): boolean {
  const alias = selected();
  return alias === first && alias !== second;
}`, { surfaces: [] });
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
