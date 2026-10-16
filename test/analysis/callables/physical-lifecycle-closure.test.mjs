import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram, Node_Initializer } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { createRustNativeCallableProducerPlan } from "../../../dist/analysis/callables/native-producers.js";
import { createRustGenericCallablePhysicalPlan } from "../../../dist/analysis/callables/generic-physical.js";
import { createRustNativeCapturePlan } from "../../../dist/analysis/callables/native-captures.js";
import { createRustFrameCallablePlan } from "../../../dist/analysis/callables/frame-values.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const joinedSource = `
type Identity = <Value>(value: Value) => Value;
function make(callback: () => number): Identity {
  const original = <Value>(value: Value): Value => { callback(); return value; };
  const alias: Identity = original;
  return alias;
}
export function choose(left: () => number, right: () => number, select: boolean): Identity {
  return select ? make(left) : make(right);
}
`;

const structuralSources = {
  "four Promise body edges": `
async function fail(): Promise<void> { throw new Error("selected rejection"); }
const api = {
  async reject(): Promise<void> { await fail(); },
  async forward(): Promise<void> { await api.reject(); },
  async caught(): Promise<void> { try { await fail(); } catch {} },
  async plain(): Promise<void> {},
};
export async function run(): Promise<void> { await api.forward(); await api.caught(); await api.plain(); }
`,
  "two actual implementations of one canonical slot": `
export function choose(flag: boolean): { value(): Promise<number> } {
  return flag ? { async value(): Promise<number> { return 1; } } : { async value(): Promise<number> { return 2; } };
}
`,
  "copied async receiver slot": `
const original = { async value(): Promise<number> { return 1; } };
const copy = { ...original };
export async function read(): Promise<number> { return await copy.value(); }
`,
  "copied receiver-independent method in a distinct shape": `
const original = { async value(): Promise<number> { return 1; } };
const copy = { label: "copy", ...original };
export async function read(): Promise<number> { return await copy.value(); }
`,
  "receiver-dependent async method": `
const counter = { count: 0, async next(): Promise<number> { this.count++; return this.count; } };
export async function read(): Promise<number> { return await counter.next(); }
`,
  "captured scalar async method": `
export function make(value: number) { return { async read(): Promise<number> { return value; } }; }
export async function read(): Promise<number> { return await make(7).read(); }
`,
  "optional absent method keeps its canonical present ABI": `
export function make(flag: boolean): { value?(): Promise<number> } {
  return flag ? { async value(): Promise<number> { return 1; } } : {};
}
`,
  "generic captured result template": `
export function make<Value>(value: Value): { read(): Promise<Value> } {
  return { async read(): Promise<Value> { return value; } };
}
const integers = make<number>(7);
const strings = make<string>("text");
export async function read(): Promise<number> { await strings.read(); return await integers.read(); }
`,
};

for (const [name, source] of Object.entries(structuralSources)) {
  test(`structural method storage publishes the actual invocation facet: ${name}`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
    const actualShapes = new Set();
    for (const node of sourceNodes(program)) {
      const operation = program.records.targetOperation.get(node);
      const carrier = operation?.kind === "record-literal" && operation.storage === "structural-object"
        ? operation.resultCarrier : operation?.kind === "source-call" && operation.target.form === "structural-method"
          ? operation.target.receiverCarrier : undefined;
      const definition = program.structuralShapes.definitionForCarrier(carrier);
      if (definition !== undefined) actualShapes.add(`${definition.componentId}\0${definition.targetName}`);
    }
    let checked = 0;
    for (const definition of program.structuralShapes.definitions) {
      if (!actualShapes.has(`${definition.componentId}\0${definition.targetName}`)) continue;
      for (const [index, field] of definition.fields.entries()) {
        const storage = field.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier;
        const protocol = rustCallableProtocol(storage);
        if (field.method !== true || field.nativeMethod === true || protocol === undefined) continue;
        assert.equal(protocol.error?.id === "rust.core.Infallible", true, `${name}: exact native invocation error`);
        const logical = rustCallableProtocol(field.presence === "optional" ? rustOptionElementCarrier(field.carrier) : field.carrier);
        assert.equal(logical.error?.id === "rust.program.TsonicError", true, `${name}: source call contract is not overwritten`);
        for (const carrier of definition.sourceCarriers) {
          const selected = program.structuralShapes.field(carrier, index);
          assert.equal(selected === program.structuralShapes.field(carrier, index), true, `${name}: indexed field identity`);
          const physical = rustCallableProtocol(selected.presence === "optional"
            ? rustOptionElementCarrier(selected.methodStorageCarrier) : selected.methodStorageCarrier);
          assert.equal(physical.error?.id === "rust.core.Infallible", true, `${name}: every source instance is completed`);
        }
        checked += 1;
      }
    }
    assert.equal(checked > 0, true, `${name}: actual stored method slots exercised`);
    for (const node of sourceNodes(program)) {
      const operation = program.records.targetOperation.get(node);
      if (operation?.kind !== "source-call" || operation.target.form !== "structural-method") continue;
      const selected = program.callableValues.nativeStorage.invocationCallableFor(node);
      assert.equal(selected.kind !== "unresolved", true, `${name}: final invocation storage is materialized at readiness`);
      const field = program.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex);
      const protocol = rustCallableProtocol(field.presence === "optional" ? rustOptionElementCarrier(field.methodStorageCarrier) : field.methodStorageCarrier);
      assert.equal(rustTargetTypeRefEquals(protocol.result, operation.resultCarrier), true, `${name}: checked result correspondence`);
    }
  });
}

function sourceNodes(program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  return nodes;
}

test("generic structural physical returns and concrete receiver values retain one actual layout application", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": structuralSources["generic captured result template"] } });
  const nodes = sourceNodes(program);
  const declaration = name => nodes.find(node => program.source.ast.is.IsFunctionDeclaration(node) &&
    program.source.ast.text(program.source.ast.name(node)) === name);
  const make = declaration("make");
  const logical = program.records.sourceCallableReturn.get(make)?.returnCarrier;
  const returned = program.callableValues.nativeStorage.returnFor(make);
  assert.equal(returned.kind !== "unresolved", true, "the authored declaration has one physical aggregate layout owner");
  assert.equal(rustTargetTypeRefEquals(returned.carrier, logical), true, "logical structure identity selects the canonical physical layout");
  const shape = program.structuralShapes.definitionForCarrier(returned.carrier);
  for (const selected of [program.callableValues.nativeProducers.outwardReturnFor(make),
    program.callableValues.nativeProducers.invocationResultFor(make)]) {
    assert.equal(rustTargetTypeRefEquals(selected, returned.carrier), true, "both emitted return facets use the same shape identity");
  }
  const results = [];
  for (const node of nodes) {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "source-call" || operation.target.form !== "structural-method") continue;
    const receiver = program.structuralShapes.definitionForCarrier(operation.target.receiverCarrier);
    assert.equal(receiver.targetName === shape.targetName && receiver.componentId === shape.componentId, true,
      "each actual invocation instantiates the selected template, not a historical contract-only shape");
    const field = program.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex);
    assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(field.methodStorageCarrier)?.result, operation.resultCarrier), true,
      "each forward application preserves the complete concrete Promise output");
    results.push(operation.resultCarrier);
  }
  assert.equal(results.length, 2, "both concrete receiver applications are exercised");
  assert.equal(rustTargetTypeRefEquals(results[0], results[1]), false, "Promise string and number outputs are never conflated");
  for (const name of ["integers", "strings"]) {
    const variable = nodes.find(node => program.source.ast.is.IsVariableDeclaration(node) &&
      program.source.ast.text(program.source.ast.name(node)) === name);
    const selected = program.callableValues.nativeStorage.valueFor(variable);
    assert.equal(selected.kind !== "unresolved", true, `${name}: actual value storage is prepared`);
    const receiver = program.structuralShapes.definitionForCarrier(selected.carrier);
    assert.equal(receiver?.targetName === shape.targetName && receiver?.componentId === shape.componentId, true,
      `${name}: actual emitted storage uses the template owner`);
    const field = program.structuralShapes.field(selected.carrier, 0);
    assert.equal(field === program.structuralShapes.field(selected.carrier, 0), true, `${name}: immutable indexed instance`);
  }
});

test("returned borrowed methods retain the actual closure lifetime without a static destination substitution", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export function make<Region extends Life>(value: Ref<int32, Region>): { label: string; read(): Promise<int32> } {
  const original = { async read(): Promise<int32> { return load(value); } };
  const copy = { label: "borrowed", ...original };
  return copy;
}
` } });
  const method = sourceNodes(program).find(node => program.source.ast.is.IsMethodDeclaration(node));
  const closure = program.records.targetOperation.get(method);
  assert.equal(closure?.kind === "closure", true, "the actual admitted method producer");
  const independent = program.records.receiverIndependentMethod.get(method);
  const retained = rustCallableProtocol(closure.resultCarrier)?.lifetime;
  const selected = rustCallableProtocol(independent?.carrier)?.lifetime;
  assert.equal(retained?.kind === "parameter" && retained.name === "Region", true, "the source closure retains the actual borrowed Region");
  assert.equal(selected?.kind === retained.kind && selected.identity === retained.identity, true,
    "receiver-free evidence transports the same retained lifetime from its producer");
  for (const definition of program.structuralShapes.definitions) {
    for (const field of definition.fields) {
      if (field.method !== true) continue;
      const stored = rustCallableProtocol(field.methodStorageCarrier);
      assert.equal(stored?.lifetime?.kind === "parameter", true, "borrowed method layout is lifetime-parametric, never static");
      assert.equal(stored?.error?.id === "rust.core.Infallible", true, "borrowed async invocation remains infallible");
    }
  }
});

test("locally invoked copied borrowed methods preserve their exact producer retention", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export async function inspect<Region extends Life>(value: Ref<int32, Region>): Promise<int32> {
  const original = { async read(): Promise<int32> { return load(value); } };
  const copy = { label: "borrowed", ...original };
  return await copy.read();
}
` } });
  const method = sourceNodes(program).find(node => program.source.ast.is.IsMethodDeclaration(node));
  const closure = program.records.targetOperation.get(method);
  const independent = program.records.receiverIndependentMethod.get(method);
  assert.equal(closure?.kind === "closure", true, "the actual admitted captured method");
  const retained = rustCallableProtocol(closure.resultCarrier)?.lifetime;
  const selected = rustCallableProtocol(independent?.carrier)?.lifetime;
  assert.equal(retained?.kind === "parameter" && retained.name === "Region", true, "the capture retains its authored Region");
  assert.equal(selected?.kind === retained.kind && selected.identity === retained.identity, true,
    "copying retains the producer's identical lifetime, never a placeholder or static guess");
  const calls = sourceNodes(program).filter(node => {
    const operation = program.records.targetOperation.get(node);
    return operation?.kind === "source-call" && operation.target.form === "structural-method";
  });
  assert.equal(calls.length, 1, "the copied receiver is actually invoked");
  assert.equal(program.callableValues.nativeStorage.invocationCallableFor(calls[0]).kind !== "unresolved", true,
    "the final native invocation reads its completed storage");
});

test("native-dispatch method fields keep their existing native ABI instead of receiving closure storage", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Counter { value(): number { return 1; } }
export function make(): { value(): number } { return new Counter(); }
export function read(): number { return make().value(); }
` } });
  let checked = 0;
  for (const definition of program.structuralShapes.definitions) {
    for (const field of definition.fields) {
      if (field.method !== true) continue;
      assert.equal(field.nativeMethod === true, true, "native dispatch retains its own field ABI owner");
      assert.equal(rustCallableProtocol(field.methodStorageCarrier)?.error?.id === "rust.program.TsonicError", true,
        "the declared native dispatch error contract is unchanged");
      checked += 1;
    }
  }
  assert.equal(checked, 1, "the actual native structural view is exercised");
});

test("private native leaf preparation uses the canonical checked subject and preserves complete Future unions", () => {
  const context = analyzeRustErrorEffects(`
export function inspect(input: { count: number; callbacks: (() => number)[]; pair: [number, () => number] },
  pending: Promise<number> | string | undefined): Promise<number> | string | undefined {
  const count = input.count;
  const first = input.callbacks[0];
  const second = input.pair[1];
  return pending;
}
`, { surfaces: [] });
  const owner = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
  const bindings = context.callableValues.native.bindingsFor(owner);
  assert.equal(bindings !== undefined, true, "exact source owner bindings");
  const storage = context.callableValues.nativeStorage;
  let projected = 0;
  for (const node of context.sourceStorage.nodes) {
    if (!context.ast.is.IsVariableDeclaration(node)) continue;
    const initializer = Node_Initializer(context.ast, node);
    const subject = initializer === undefined ? undefined : context.sourceStorage.subjectFor(initializer);
    if (subject?.kind !== "resolved") continue;
    const origin = context.sourceStorage.boundOriginsFor(subject.subject, bindings);
    assert.equal(origin.kind === "resolved", true, "the source storage owner resolves actual projected origins");
    for (const selected of origin.subjects) {
      const carrier = storage.logicalCarrierFor(selected, bindings);
      const expected = context.records.runtimeCarrier.get(initializer)?.carrier;
      assert.equal(rustTargetTypeRefEquals(carrier, expected), true, "the complete projected leaf, not its containing input");
      assert.equal(storage.logicalCarrierFor(selected, bindings) === carrier, true, "one prepared subject and activation");
      assert.equal(Object.isFrozen(carrier), true, "immutable logical leaf metadata");
      projected += 1;
    }
  }
  assert.equal(projected >= 3, true, "member, array and tuple projection controls ran");
  const parameter = context.ast.parameters(owner)[1];
  const subject = context.sourceStorage.subject(parameter, "input");
  assert.equal(subject.kind === "resolved", true, "the exact Future-union parameter");
  const selected = storage.logicalCarrierFor(subject.subject, bindings);
  assert.equal(rustTargetTypeRefEquals(selected, context.records.sourceParameterAbi.get(parameter)?.parameterCarrier), true,
    "Future, string and absence alternatives are not replaced by a selected Future leaf");
  assert.equal(selected === storage.logicalCarrierFor(subject.subject, bindings), true, "complete union metadata is prepared once");
});

test("published callable storage contains only finite read ports and keeps every selected answer stable", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedSource } });
  const storage = program.callableValues.nativeStorage;
  for (const name of ["subjectFor", "boundSubjectFor", "logicalCarrierFor", "genericBindingsFor", "invocationReturnFor", "invocationInputFor",
    "invocationOriginsFor", "implementationOriginsFor"]) assert.equal(name in storage, false, `private construction port ${name}`);
  for (const name of ["bindingsFor", "originsFor", "originsForValue"])
    assert.equal(name in program.callableValues.native, false, `private native input port ${name}`);
  let selected = 0;
  for (const node of sourceNodes(program)) {
    const value = storage.valueFor(node);
    const operand = storage.operandFor(node);
    const returned = storage.returnFor(node);
    assert.equal(storage.valueFor(node) === value, true, "value read identity");
    assert.equal(storage.operandFor(node) === operand, true, "operand read identity");
    assert.equal(storage.returnFor(node) === returned, true, "return read identity");
    if (value.kind === "selected" || operand.kind === "selected" || returned.kind === "selected") selected += 1;
  }
  assert.equal(selected > 0, true, "the witness reads actual selected physical carriers");
});

test("every selected generic flow is one immutable physical application, including both conditional arms", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": joinedSource } });
  const applications = program.callableValues.flowApplications;
  let flows = 0;
  for (const node of sourceNodes(program)) {
    const conversion = program.records.contextualValueConversion.get(node)?.conversion;
    if (conversion?.kind !== "generic-callable-flow") continue;
    const application = applications.forNode(node, conversion, undefined);
    assert.equal(applications.forNode(node, conversion, undefined) === application, true, "one selected flow record");
    assert.equal(Object.isFrozen(application), true, "immutable selected flow record");
    flows += 1;
  }
  assert.equal(flows > 0, true, "the witness contains actual admitted generic value flows");
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign source"); } });
  assert.throws(() => applications.forNode(foreign, foreign, foreign),
    failure => failure.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT", "unknown required source key");
  assert.equal(inspected, 0, "a missing source key never inspects foreign conversion metadata");
});

test("native producer publication reads completed results after source and return selection are revoked", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export function identity(value: number): number { return value; }
export function choose(): typeof identity { return identity; }
` } });
  const ast = Proxy.revocable(program.source.ast, {});
  const records = Proxy.revocable(program.records, {});
  let open = true;
  let selections = 0;
  const construction = createRustNativeCallableProducerPlan({ ast: ast.proxy, nodes: sourceNodes(program), records: records.proxy,
    native: program.callableValues.native, definitions: program.typeDefinitions,
    returnCarrierFor(declaration) {
      assert.equal(open, true, "only private construction selects return storage");
      selections += 1;
      const selected = program.callableValues.nativeStorage.returnFor(declaration);
      return selected.kind === "unresolved" ? undefined : selected.carrier;
    } });
  construction.selectConstructionErrors(new Map());
  const requests = new Map();
  for (const node of sourceNodes(program)) {
    const value = program.records.directCallableReference.get(node);
    if (value !== undefined && rustCallableProtocol(value.carrier) !== undefined)
      requests.set(value.sourceDeclaration, [...requests.get(value.sourceDeclaration) ?? [], value.carrier]);
  }
  const published = construction.seal(requests);
  assert.equal("seal" in published, false, "the producer construction port is private");
  assert.equal("selectConstructionErrors" in published, false, "constructor ABI selection is private");
  const before = selections;
  open = false;
  ast.revoke();
  records.revoke();
  assert.equal(published.producers.length > 0, true, "real native producer domain");
  for (const producer of published.producers) {
    const declaration = producer.declaration;
    const outward = published.outwardReturnFor(declaration);
    const invocation = published.invocationResultFor(declaration);
    const body = published.bodyResultFor(declaration);
    const error = published.errorFor(declaration, "invoke");
    assert.equal(published.outwardReturnFor(declaration) === outward, true, "outward result identity");
    assert.equal(published.invocationResultFor(declaration) === invocation, true, "invocation result identity");
    assert.equal(published.bodyResultFor(declaration) === body, true, "body result identity");
    assert.equal(published.errorFor(declaration, "invoke") === error, true, "producer error identity");
    for (const carrier of requests.get(declaration) ?? []) {
      const physical = published.physicalFor(declaration, carrier);
      assert.equal(physical !== undefined, true, "required physical request selected before publication");
      assert.equal(published.physicalFor(declaration, carrier) === physical, true, "physical producer identity");
    }
  }
  assert.equal(selections, before, "no source or storage selection after publication");
  assert.throws(() => construction.seal(requests), /exactly once/u, "one native producer publication");
});

test("published producer physical lookup rejects a foreign declaration without inspecting its carrier", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": "export function answer(): number { return 42; }" } });
  let inspected = 0;
  const foreign = Object.defineProperty({}, "kind", { get() { inspected += 1; throw new Error("foreign carrier"); } });
  assert.equal(program.callableValues.nativeProducers.physicalFor(foreign, foreign) === undefined, true, "unknown declaration is absent");
  assert.equal(inspected, 0, "foreign declaration/metadata is not source-inspected");
});

test("a physical reader captured during construction becomes the same terminal lookup without family reselection", () => {
  const context = analyzeRustErrorEffects(`export function make(): <Value>(value: Value) => Value {
    return <Value>(value: Value): Value => value;
  }`, { surfaces: [] });
  const generic = context.callableValues.generic;
  let open = true;
  let selections = 0;
  const captures = createRustNativeCapturePlan({ records: context.records, storage: context.sourceStorage,
    nativeStorage: context.callableValues.nativeStorage });
  const construction = createRustGenericCallablePhysicalPlan(generic.definitions, carrier => {
    assert.equal(open, true, "logical family selection is construction-only");
    selections += 1;
    return generic.definitionFor(carrier);
  }, { ast: context.ast, storage: context.sourceStorage, captures, native: context.callableValues.native,
    boundSubjectFor: (subject, carrier, bindings) =>
      context.callableValues.nativeStorage.boundSubjectFor(subject, carrier, bindings) });
  const implementation = generic.definitions[0].implementations[0];
  const subject = context.sourceStorage.subject(implementation.declaration, "value");
  assert.equal(subject.kind, "resolved", "actual source producer");
  const selected = construction.carrierFor(implementation.carrier, implementation.sourceFileName,
    [{ subject: subject.subject, bindings: context.sourceStorage.emptyBindings }]);
  assert.equal(selected !== undefined, true, "actual owned physical source admitted");
  const captured = construction.plan;
  construction.closeAdmission();
  const published = construction.closeKeys();
  construction.publish();
  const count = selections;
  open = false;
  assert.equal(captured.definitionFor(selected.carrier) === published.definitionFor(selected.carrier), true,
    "early reader uses the same completed definition");
  assert.equal(captured.argumentsFor(selected.carrier) === published.argumentsFor(selected.carrier), true,
    "early reader uses the same completed argument object");
  assert.equal(captured.existingSelectionFor(selected.carrier) === published.existingSelectionFor(selected.carrier), true,
    "early optional reader uses the identical completed selection");
  assert.equal(captured.conversionFor(selected.carrier, selected.carrier) === published.conversionFor(selected.carrier, selected.carrier), true,
    "early conversion reader uses the identical completed application");
  assert.equal(selections, count, "captured completion/error inputs never select a family after publication");
});

test("frame reads and same-activation proofs remain data-only after construction inputs are revoked", () => {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: { "index.ts": `
class Value {
  recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
  rebind(): void { this.recurse = (count: number): number => count === 0 ? 2 : this.recurse(count - 1); }
}
export function escaped(): (count: number) => number {
  const value = new Value();
  const before = value.recurse;
  value.rebind();
  return before;
}
` } });
  const source = createTargetSourceProgram(checked);
  const sourceStorage = createSourceStorageQuery(source, program.sourceFiles);
  const guarded = [];
  const guard = value => {
    const selected = Proxy.revocable(value, {});
    guarded.push(selected);
    return selected.proxy;
  };
  const frames = createRustFrameCallablePlan({ ast: guard(program.source.ast), records: guard(program.records),
    ownership: guard(program.callableOwnership), sourceStorage: guard(sourceStorage), usedNames: new Set(),
    navigation: guard(source.navigation), projectTypes: guard(program.projectTypes),
    objectRepresentations: guard(program.objectRepresentations) });
  const nodes = sourceNodes(program);
  const witnesses = frames.definitions.flatMap(definition => definition.entries.flatMap(entry => entry.implementations
    .map(implementation => ({ definition, entry, implementation }))));
  assert.equal(witnesses.length > 0, true, "real class/frame entry alternatives");
  for (const selected of guarded) selected.revoke();
  for (const { definition, entry, implementation } of witnesses) {
    assert.equal(frames.definitionFor(implementation.carrier) === definition, true, "prepared frame owner");
    assert.equal(frames.entryFor(implementation.carrier) === entry, true, "prepared frame signature");
    const before = frames.isSameActivationInput(implementation.declaration, definition);
    assert.equal(before, true, "an owned entry belongs to its own activation");
    assert.equal(frames.isSameActivationInput(implementation.declaration, definition), before, "stable same-activation proof");
  }
  for (const node of nodes) {
    const definition = frames.definitionForOwner(node);
    if (definition !== undefined) assert.equal(frames.definitionForOwner(node) === definition, true, "native activation owner identity");
  }
  assert.equal(frames.isSameActivationInput({}, {}), false, "foreign activation is absent without source inspection");
});
