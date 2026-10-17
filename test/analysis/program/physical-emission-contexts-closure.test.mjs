import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import { prepareRustEmissionContextRequests, rustEmissionIdentityBindings } from "../../../dist/analysis/callables/emission-contexts.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { prepareRustPhysicalEmissionContexts } from "../../../dist/analysis/program/physical-emission-contexts.js";
import { analyzeRustInitializationErrors } from "../../../dist/analysis/errors/initialization.js";

const genericSource = `
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

const constructorSource = `
class Item {
  value: number;
  constructor(value: number, flag: boolean) {
    try { this.value = value; if (flag) return; }
    finally { this.value = value + 1; }
  }
  read(): number { return this.value; }
}
export function value(limit: number): number { return new Item(limit, true).read(); }
`;

const inheritedConstructorSource = `
class Detail<Value> extends Error {
  detail: Value;
  constructor(message: string, detail: Value) { super(message); this.detail = detail; }
}
class Specific extends Detail<number> {
  constructor(value: number) { super("detail", value); }
}
export function detail(value: number): number { return new Specific(value).detail; }
`;

const generatorSource = `
import type { int32 } from "@tsonic/core/types.js";
export function* values(): Generator<int32, int32, void> { yield 1; return 2; }
`;

const nativeHandlerSource = `
import { loadnativeptr, unsafecontext } from "@tsonic/core/lang.js";
import type { NativePointer, int32 } from "@tsonic/core/types.js";
export function readNative(pointer: NativePointer<int32>): int32 {
  return unsafecontext(loadnativeptr(pointer));
}
`;

const frameSource = `
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
`;

function actual(source, surfaces) {
  return analyzeRust({ surfaces, target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": source } }).program;
}

test("higher-ranked emission identity bindings preserve distinct actual binder identities", () => {
  const first = Object.freeze({ kind: "bound", binderIdentity: "first", identity: "region", name: "region" });
  const second = Object.freeze({ kind: "bound", binderIdentity: "second", identity: "region", name: "region" });
  const bindings = rustEmissionIdentityBindings([
    { kind: "lifetime", lifetime: first }, { kind: "lifetime", lifetime: second },
  ]);
  assert.equal(bindings !== undefined, true, "actual higher-ranked parameters are canonical binding inputs");
  assert.equal(bindings.lifetimes.size, 2, "equal spelling cannot merge distinct native binders");
  for (const lifetime of [first, second]) assert.equal(rustLifetimeKey(bindings.lifetimes.get(rustLifetimeKey(lifetime))),
    rustLifetimeKey(lifetime), "each immutable binding preserves its original lifetime identity");
  assert.equal(bindings.lifetimes.has(rustLifetimeKey({ ...first, binderIdentity: "foreign" })), false,
    "a foreign higher-ranked binder is absent");
  assert.equal(Object.isFrozen(bindings), true);
});

function observeCallablePublication(registry, assertions, carriers, observations) {
  let physical;
  let reordered;
  const invariantCode = attempt => {
    try { attempt(); } catch (failure) { return failure.diagnostic?.code; }
    return undefined;
  };
  const descriptors = Object.getOwnPropertyDescriptors(registry);
  return Object.freeze(Object.create(Object.getPrototypeOf(registry), {
    ...descriptors,
    seal: { value(input) {
      observations.seals++;
      assertions.equal(observations.requestSelections, 1, "one actual early physical-use selection precedes the late seal");
      observations.verifyHandlerInputs();
      physical = registry.selected.generic.physical;
      const joined = physical.definitions().find(definition => definition.members.length === 2);
      assertions.equal(joined !== undefined, true, "the real pipeline selects the original two-member family");
      const value = carriers.rustGenericCallableValue(joined.carrier);
      reordered = carriers.rustGenericCallableCarrier({ ...value, physical: {
        ...value.physical, members: [...value.physical.members].reverse(),
      } });
      assertions.equal(invariantCode(() => physical.definitionFor(reordered)), "TSONIC_INTERNAL_ANALYSIS_INVARIANT", "closed, not sealed");
      assertions.equal(observations.components.at(-1)?.kind, "resolved", "the existing component owner completes before publication");
      const published = registry.seal(input);
      assertions.equal(published.kind, "resolved", "the real late-stage tuple seals successfully");
      assertions.equal(published.value !== registry.selected, true, "publication does not expose the analysis construction view");
      assertions.equal(registry.seal(input) === published, true, "repeated seals read the same completed publication");
      assertions.equal(invariantCode(() => physical.definitionFor(reordered)), "TSONIC_INTERNAL_ANALYSIS_INVARIANT", "sealed, not published");
      observations.published = published.value;
      observations.verifyHandlerInputs();
      return published;
    } },
    publish: { value() {
      const result = registry.publish();
      assertions.equal(invariantCode(() => physical.definitionFor(reordered)), "TSONIC_INTERNAL_PLANNER_INVARIANT", "published");
      observations.publications++;
      return result;
    } },
  }));
}

test("the planner phase label starts at publication, after the actual callable seal and reachability (instrumented load observation)", () => {
  const options = { surfaces: [], target: { id: "rust", options: { outputType: "lib" } }, files: { "index.ts": genericSource + nativeHandlerSource } };
  const ordinary = compileRust(options);
  assert.equal(ordinary.result.diagnostics.length, 0, ordinary.result.diagnostics.map(issue => issue.message).join("\n").slice(0, 2048));
  assert.equal(ordinary.result.artifacts.length > 0, true, "uninjected ordinary pipeline reaches emission");
  const registryUrl = new URL("../../../dist/analysis/callables/value-plan.js", import.meta.url).href;
  const componentsUrl = new URL("../../../dist/analysis/program/source-package-components.js", import.meta.url).href;
  const handlerUrl = new URL("../../../dist/analysis/operations/native-handlers.js", import.meta.url).href;
  const collectorUrl = new URL("../../../dist/analysis/callables/emission-requests.js", import.meta.url).href;
  const carriersUrl = new URL("../../../dist/target-model/types/carriers/generic-callables.js", import.meta.url).href;
  const helperUrl = new URL("../../helpers/rust-session.mjs", import.meta.url).href;
  const key = "r14-instrumented-callable-publication-proof";
  const registryObservation = `export function createRustCallableValuePlanRegistry() { return globalThis[Symbol.for(${JSON.stringify(key)})].registry(observedCreateRustCallableValuePlanRegistry()); }`;
  const componentsObservation = `export function analyzeRustSourcePackageComponents(...inputs) { const result = observedAnalyzeRustSourcePackageComponents(...inputs); globalThis[Symbol.for(${JSON.stringify(key)})].components.push(result); return result; }`;
  const handlerObservation = `export function analyzeRustNativeHandlers(...inputs) { const result = observedAnalyzeRustNativeHandlers(...inputs); globalThis[Symbol.for(${JSON.stringify(key)})].handlers(inputs); return result; }`;
  const requestObservation = `export function prepareRustPhysicalCallableEmissionRequests(...inputs) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.beforeRequests(inputs[0]); const result = observedPrepareRustPhysicalCallableEmissionRequests(...inputs); observations.requests = result; observations.requestSelections++; return result; }`;
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { sourceMarkerFactKey } from "@tsonic/tsts";
const observationKey = Symbol.for(${JSON.stringify(key)});
const observations = { seals: 0, publications: 0, components: [], anchors: new Set(), handlerSelections: 0, requestSelections: 0 };
globalThis[observationKey] = observations;
const families = ["targetOperation", "rawLocationPlan", "memoryLayoutObservation", "rawAddressPlan", "memoryBindingPlan", "typedLocationPlan", "nativeHandler"];
observations.handlers = ([nodes, records, safety, sourceFacts, requirements]) => {
  observations.handlerSelections++;
  observations.handlerInputs = { nodes, records, safety, sourceFacts, requirements,
    values: nodes.map(node => ({ node, values: families.map(family => records[family].get(node)),
      safety: safety.get(node), marker: sourceFacts.getFact(node, sourceMarkerFactKey) })) };
};
observations.verifyHandlerInputs = () => {
  const { nodes, records, safety, sourceFacts, requirements, values } = observations.handlerInputs;
  assert.equal(nodes.length === values.length, true, "the original native input domain stays complete");
  let selected = 0;
  for (const row of values) {
    for (const [index, family] of families.entries()) assert.equal(records[family].get(row.node) === row.values[index], true,
      "no later writer changes the original handler input: " + family);
    assert.equal(safety.get(row.node) === row.safety, true, "same completed safety selection");
    assert.equal(sourceFacts.getFact(row.node, sourceMarkerFactKey) === row.marker, true, "same checked source-marker evidence");
    if (records.nativeHandler.get(row.node) !== undefined) {
      selected++;
      assert.equal(requirements.some(requirement => requirement.family === "nativeHandler" && requirement.subject === row.node), true,
        "the actual handler keeps its original required-record obligation");
    }
  }
  assert.equal(selected > 0, true, "real pointer and safety source selects nonempty canonical handlers");
};
observations.beforeRequests = input => {
  assert.equal(observations.handlerSelections, 1, "the single original handler owner finishes before early requests");
  assert.equal(input.nativeNodes === observations.handlerInputs.nodes && input.records === observations.handlerInputs.records, true,
    "the original canonical nativeNodes and records are passed unchanged");
  observations.verifyHandlerInputs();
};
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  const selections = [
    { url: ${JSON.stringify(registryUrl)}, anchor: "export function createRustCallableValuePlanRegistry()",
      replacement: "function observedCreateRustCallableValuePlanRegistry()",
      extension: ${JSON.stringify(registryObservation)} },
    { url: ${JSON.stringify(componentsUrl)}, anchor: "export function analyzeRustSourcePackageComponents(",
      replacement: "function observedAnalyzeRustSourcePackageComponents(",
      extension: ${JSON.stringify(componentsObservation)} },
    { url: ${JSON.stringify(handlerUrl)}, anchor: "export function analyzeRustNativeHandlers(",
      replacement: "function observedAnalyzeRustNativeHandlers(", extension: ${JSON.stringify(handlerObservation)} },
    { url: ${JSON.stringify(collectorUrl)}, anchor: "export function prepareRustPhysicalCallableEmissionRequests(",
      replacement: "function observedPrepareRustPhysicalCallableEmissionRequests(", extension: ${JSON.stringify(requestObservation)} },
  ];
  const selection = selections.find(selection => selection.url === url);
  if (selection === undefined) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  assert.equal(source.split(selection.anchor).length, 2, "one exact instrumented observation anchor: " + selection.url);
  observations.anchors.add(url);
  return { ...loaded, source: source.replace(selection.anchor, selection.replacement) + "\\n" + selection.extension };
} });
const carriers = await import(${JSON.stringify(carriersUrl)});
observations.registry = registry => (${observeCallablePublication.toString()})(registry, assert, carriers, observations);
const { compileRust } = await import(${JSON.stringify(helperUrl)});
const compiled = compileRust(${JSON.stringify(options)});
assert.equal(compiled.result.diagnostics.length, 0, compiled.result.diagnostics.map(issue => issue.message).join("\\n").slice(0, 2048));
assert.equal(compiled.result.program === observations.published, false, "the observed publication is the callable product, not the enclosing program");
assert.equal(compiled.result.program.callableValues === observations.published, true, "the pipeline publishes the exact observed completed product");
assert.equal(observations.anchors.has(${JSON.stringify(registryUrl)}) && observations.anchors.has(${JSON.stringify(componentsUrl)}), true,
  "both original production functions are observed without writing dist");
assert.equal(observations.anchors.size, 4, "each original stage and each required input observer has one exact anchor");
assert.equal(observations.seals, 1, "one actual late callable seal");
assert.equal(observations.publications, 1, "one actual planner publication");
assert.equal(observations.requests.kind, "resolved", "only an admitted complete request inventory is published");
assert.equal(observations.requestSelections, 1, "the source-use owner is never replayed after sealing");
const { IsTypeSyntaxNode } = await import("@tsonic/target-api/source");
const { records } = observations.handlerInputs;
let metadata = 0;
for (const request of observations.requests.value) {
  assert.equal(Object.isFrozen(request) && Object.isFrozen(request.context) && Object.isFrozen(request.bindings), true,
    "the exact early use and binding inputs are immutable");
  if (request.kind === "type" && IsTypeSyntaxNode(compiled.result.program.source.ast, request.subject)) metadata++;
  if (request.kind !== "type") assert.equal(IsTypeSyntaxNode(compiled.result.program.source.ast, request.subject), false,
    "annotation metadata never becomes a callable-storage subject");
  if (request.kind === "return") assert.equal(records.sourceCallableReturn.get(request.subject) !== undefined, true,
    "body returns retain their actual selected declaration contract");
}
assert.equal(metadata > 0, true, "required authored type elaboration stays present independently of runtime storage");
process.stdout.write("R14_INSTRUMENTED_PHASE_PROOF " + JSON.stringify(compiled.result.artifacts));
`;
  const observed = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.equal(observed.status, 0, `instrumented actual-pipeline proof: ${observed.error?.message ?? ""}\n${observed.stderr.slice(-4096)}\n${observed.stdout.slice(-2048)}`);
  const marker = "R14_INSTRUMENTED_PHASE_PROOF ";
  assert.equal(observed.stdout.startsWith(marker), true, "explicit instrumented proof label");
  assert.equal(JSON.stringify(JSON.parse(observed.stdout.slice(marker.length))) === JSON.stringify(ordinary.result.artifacts), true,
    "instrumentation changes no diagnostics, publication identity or generated artifact relative to the uninjected ordinary pipeline");
});

for (const surfaces of [[], ["js"]]) {
  test(`actual helper, body, member and native-input contexts share one immutable binding (${surfaces[0] ?? "native"})`, () => {
    const program = actual(genericSource, surfaces);
    const prepared = program.physicalEmissionContexts;
    assert.equal(prepared === program.callableValues.emissionContexts, true, "one published product, not a parallel context owner");
    assert.equal(Object.isFrozen(prepared) && Object.isFrozen(prepared.contexts) && Object.isFrozen(prepared.operands), true);
    assert.equal(prepared.contexts.some(context => context.use.role === "native-body"), true, "ordinary native body participates");
    assert.equal(prepared.contexts.some(context => context.use.role === "helper"), true, "actual emitted generic helper participates");
    assert.equal(prepared.contexts.some(context => context.use.role === "body"), true, "actual activation body participates");
    assert.equal(prepared.contexts.some(context => context.use.role === "native-input"), true, "actual native callable formal participates");
    let members = 0;
    for (const definition of program.callableValues.generic.physical.definitions()) for (const member of definition.members) {
      const context = prepared.contexts.find(context => context.use.subject === member && context.use.role === "member");
      assert.equal(context !== undefined, true, "every actual physical member has its context");
      assert.equal(context.bindings === member.bindings, true, "early, completion, error and emission readers share the admitted binding");
      assert.equal(Object.isFrozen(member.bindings) && Object.isFrozen(member.bindings.types), true);
      assert.equal(typeof member.bindings.types.set, "undefined", "no mutable binding map escapes");
      const completion = program.callableValues.genericCompletions.forDefinition(definition);
      const result = completion.kind === "direct" ? completion.result : completion.forMember(member).result;
      assert.equal(context.returnDestination.kind, "value");
      assert.equal(context.returnDestination.carrier === result, true, "already-bound completion is not applied a second time");
      assert.equal(prepared.carrierFor(context.use, result) === result, true, "selected physical payload remains the original object");
      const selected = program.genericCallableErrors.forDefinition(definition).forMember(member);
      for (const source of [selected.invocation, selected.awaiting]) if (source !== undefined) {
        assert.equal(context.operands.includes(source.errorType), true, "completed native error endpoint is retained");
        assert.equal(prepared.carrierFor(context.use, source.errorType) === source.errorType, true, "no second error substitution");
      }
      members++;
    }
    assert.equal(members > 0, true, "nonempty actual physical family coverage");
  });

  test(`constructor actions and completion layers are prepared by the source owner (${surfaces[0] ?? "native"})`, () => {
    const program = actual(constructorSource, surfaces);
    const definition = program.projectTypes.definitions.find(definition => definition.sourceName === "Item");
    const plan = program.projectConstructions.forDefinition(definition);
    assert.equal(plan !== undefined && plan.emission.issues.length === 0, true, "real native construction is admitted");
    assert.equal(plan.points.length > 0, true, "the finite actual readiness domain is published");
    const contexts = program.physicalEmissionContexts.contexts;
    assert.equal(contexts.some(context => context.use.subject === plan && context.use.role === "constructor"), true);
    for (const layer of plan.layers) assert.equal(contexts.some(context => context.use.subject === layer && context.use.role === "constructor-layer"), true,
      "each actual emitted constructor layer has its own applied binding context");
    let local = 0;
    let returned = 0;
    for (const point of plan.points) {
      const selected = plan.emission.preparationFor(point.node);
      assert.equal(selected !== undefined && selected.point === point, true, "the owner supplies the exact preselected point");
      assert.equal(selected.layer.definition === point.layer, true, "the source traversal publishes the actual native layer once");
      assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.projections), true);
      assert.equal(plan.emission.preparationFor(point.node) === selected, true);
      for (const projection of selected.projections) {
        if (projection.kind === "local") {
          assert.equal(plan.fields.some(field => field.declaration === projection.declaration), true, "local action has an actual physical slot");
          local++;
        }
      }
      const layer = plan.returnLayerFor(point.node);
      if (layer !== undefined) {
        assert.equal(plan.layerHasEarlyReturn(layer), true, "bare return retains its native layer label requirement through finally");
        returned++;
      }
    }
    assert.equal(local > 0 && returned > 0, true, "both real field and try/finally early-return controls are exercised");
    assert.equal(plan.emission.preparationFor({}) === undefined && plan.returnLayerFor({}) === undefined, true, "foreign source keys remain absent");
  });

  test(`real retained frame contexts expose only complete immutable endpoint data (${surfaces[0] ?? "native"})`, () => {
    const program = actual(frameSource, surfaces);
    const contexts = program.physicalEmissionContexts;
    assert.equal(program.callableValues.frames.definitions.length > 0, true, "the fixture selects real native frame storage");
    for (const frame of program.callableValues.frames.definitions) {
      const selected = contexts.contexts.find(context => context.use.subject === frame && context.use.role === "frame");
      assert.equal(selected !== undefined, true, "actual retained native frame has a prepared emission context");
      assert.equal(selected.operands.length > 0, true, "frame binding and callable endpoints are prepared, not placeholders");
      assert.equal(Object.isFrozen(selected.operands), true);
    }
  });

  test(`external and generic construction layers retain their original source traversal owner (${surfaces[0] ?? "native"})`, () => {
    const program = actual(inheritedConstructorSource, surfaces);
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === "Specific");
    assert.equal(definition !== undefined, true, "the actual derived native definition is selected");
    const plan = program.projectConstructions.forDefinition(definition);
    assert.equal(plan !== undefined && plan.emission.issues.length === 0, true, "the whole inherited native constructor is admitted");
    assert.equal(plan.layers.length > 1 && plan.points.length > 1, true, "real inherited constructor layers and points are nonempty");
    const root = plan.pointFor(definition.declaration);
    assert.equal(root !== undefined && root.layer === definition, true, "the final root point belongs to the constructed definition");
    let inherited = 0;
    for (const point of plan.points) {
      const selected = plan.emission.preparationFor(point.node);
      assert.equal(selected !== undefined && selected.point === point && selected.layer.definition === point.layer, true,
        "each exact source point consumes its original layer, without declaration-owner reconstruction");
      if (point.layer !== definition) inherited++;
    }
    assert.equal(inherited > 0, true, "the actual inherited field or constructor points are covered");
  });

  test(`generator contexts retain their actual body destination and independent protocol endpoints (${surfaces[0] ?? "native"})`, () => {
    const program = actual(generatorSource, surfaces);
    let selected = 0;
    for (const producer of program.callableValues.nativeProducers.producers) {
      const generator = program.records.generator.get(producer.declaration);
      if (generator === undefined) continue;
      const context = program.physicalEmissionContexts.contexts.find(candidate => candidate.use.subject === producer.declaration &&
        candidate.use.role === "native-body");
      assert.equal(context !== undefined && context.returnDestination.kind === "value", true,
        "the actual generator has a completed body context");
      assert.equal(context.returnDestination.carrier === generator.returnType, true,
        "body return does not become the outward generator protocol");
      for (const carrier of [generator.yieldType, generator.returnType, generator.nextType, generator.resultCarrier])
        assert.equal(program.physicalEmissionContexts.carrierFor(context.use, carrier) !== undefined, true,
          "each independently selected protocol endpoint is prepared before publication");
      selected++;
    }
    assert.equal(selected > 0, true, "the retained generator domain is nonempty");
  });
}

test("published context, operand, carrier and source occurrence readers cannot consult or mutate producers", () => {
  const gate = { closed: false, after: 0 };
  const services = new WeakMap();
  const guard = (service, label) => {
    if (service === undefined || service === null) return service;
    const previous = services.get(service);
    if (previous !== undefined) return previous;
    const methods = new Map();
    const facade = new Proxy(Object.create(null), {
      ownKeys: () => Reflect.ownKeys(service),
      has: (_target, property) => Reflect.has(service, property),
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(service, property);
        return descriptor === undefined ? undefined : {
          configurable: true, enumerable: descriptor.enumerable, get: () => facade[property],
        };
      },
      get(_target, property) {
        const value = Reflect.get(service, property, service);
        if (typeof value === "function") {
          if (!methods.has(property)) methods.set(property, (...argumentsList) => {
            if (gate.closed) { gate.after++; throw new Error(`${label}.${String(property)} queried after publication`); }
            const result = Reflect.apply(value, service, argumentsList);
            return property === "forNode" || property === "forFile" ? guard(result, `${label}.${String(property)}`) : result;
          });
          return methods.get(property);
        }
        return value !== null && typeof value === "object" && !Array.isArray(value) &&
          Reflect.ownKeys(value).some(key => typeof value[key] === "function") ? guard(value, `${label}.${String(property)}`) : value;
      },
    });
    services.set(service, facade);
    return facade;
  };
  let program;
  let source;
  const compiled = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": `export function inspect(value: string, word: string): boolean { return value.includes(word); }
export function ordinary(value: number): number { const stored = value; return stored; }` },
    compileTarget(request) {
      source = { ...request.input.source, ast: guard(request.input.source.ast, "AST"),
        semantics: guard(request.input.source.semantics, "semantics"), navigation: guard(request.input.source.navigation, "navigation") };
      const analyzed = analyzeRustTargetProgram({ ...request, input: { ...request.input, source } });
      if (analyzed.kind === "rejected") return analyzed;
      program = analyzed.value;
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
    } });
  assert.equal(compiled.result.diagnostics.length, 0, compiled.result.diagnostics.map(issue => `${issue.code}: ${issue.message}`).join("\n").slice(0, 2048));
  assert.equal(program !== undefined, true, "the actual source owner publishes before guards close");
  const prepared = program.physicalEmissionContexts;
  assert.equal(prepared.operands.length > 0 && prepared.sourceOccurrences.length > 0, true, "positive domains are nonempty");
  gate.closed = true;
  const set = Map.prototype.set;
  Map.prototype.set = () => { throw new Error("map write after publication"); };
  try {
    for (const context of prepared.contexts) {
      assert.equal(prepared.contextFor(context.use) === context, true, "exact canonical context key");
      assert.equal(prepared.contextFor({ ...context.use }) === undefined, true, "copied context key is foreign");
    }
    for (const operand of prepared.operands) {
      assert.equal(prepared.operandFor(operand.use) === operand, true, "exact canonical operand key");
      assert.equal(prepared.operandFor({ ...operand.use }) === undefined, true, "copied operand key is foreign");
      assert.equal(prepared.carrierFor(operand.use, operand.carrier) === operand.carrier, true, "the actual physical operand is prepared");
    }
    for (const occurrence of prepared.sourceOccurrences) {
      assert.equal(prepared.sourceFor(occurrence.node, occurrence.operation) === occurrence, true, "original operation occurrence lookup");
      assert.equal(prepared.sourceFor(occurrence.node, { ...occurrence.operation }) === undefined, true, "copied provider fact is foreign");
      for (const slot of occurrence.slots) assert.equal(prepared.operands.some(operand => operand.origin.kind !== "call-input" &&
        operand.origin.evaluation.kind === "provider-source" && operand.origin.evaluation.slot === slot &&
        operand.node === slot.node && operand.use.subject === slot), true,
      "provider-source uses carry their original slot, never a node-only inference");
      for (const { input, slot } of occurrence.inputs) {
        assert.equal(occurrence.slots.includes(slot), true, "call inputs retain the admitted original source slot");
        assert.equal(prepared.operands.some(operand => operand.origin.kind === "call-input" && operand.origin.input === input &&
          operand.origin.operation === occurrence.operation && operand.origin.operationNode === occurrence.node && operand.node === slot.node), true,
        "actual call-input identity and its caller occurrence are retained together");
      }
    }
    assert.equal(prepared.operands.some(operand => operand.origin.kind !== "call-input" && operand.destination === undefined &&
      operand.origin.evaluation.kind === "ordinary"), true, "absence of a destination does not mean source-only discard");
  } finally { Map.prototype.set = set; }
  assert.equal(gate.after, 0, "all public readers are data-only");
  assert.throws(() => source.ast.kindName(program.sourceFiles[0]), /after publication/u, "the source guard is live");
});

test("a required missing physical operand refuses at the preparation owner before publication", () => {
  const arithmetic = actual("export function value(input: number): number { return input + 1; }", []);
  assert.equal(arithmetic.physicalEmissionContexts.contexts.some(context => context.use.role === "native-body"), true,
    "ordinary arithmetic retains its real body context without artificial callable-storage reads");
  const program = actual("export function contains(input: string): boolean { return input.includes(\"value\"); }", ["js"]);
  const prepared = program.physicalEmissionContexts;
  const operand = prepared.operands.find(operand => operand.origin.kind === "operand");
  assert.equal(operand !== undefined, true, "the negative control starts from an actual checked operand");
  const result = prepareRustEmissionContextRequests({ ast: program.source.ast, records: program.records, sourceOccurrences: [], errorRegions: program.errorRegions,
    nativeStorage: { ...program.callableValues.nativeStorage, valueFor: () => ({ kind: "unresolved", reason: "missing native producer proof" }) } },
  [{ use: targetUseSiteRef(operand.node, "missing-control", "actual-native-owner"), declaration: operand.context.declaration,
    bindings: operand.context.bindings, returnDestination: operand.context.returnDestination, error: operand.context.error,
    demands: [Object.freeze({ kind: "value", subject: operand.node, owner: operand.context.declaration,
      bindings: operand.context.bindings, context: operand.use })], sourceCarriers: [], physicalCarriers: [] }]);
  assert.equal(result.kind, "rejected");
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED" &&
    diagnostic.sourceNode === operand.node && diagnostic.message === "missing native producer proof"), true,
  "the source occurrence and owning refusal survive unchanged; no internal or missing-key fallback");
  assert.equal(Object.hasOwn(result, "value"), false, "no incomplete context product is published");
});

test("the removed native-node context input is rejected instead of becoming an implicit demand inventory", () => {
  const program = actual("export function value(input: number): number { return input + 1; }", []);
  const context = program.physicalEmissionContexts.contexts.find(candidate => candidate.use.role === "native-body");
  assert.equal(context !== undefined, true, "the old-form negative starts from an actual emitted context");
  assert.throws(() => prepareRustEmissionContextRequests({ ast: program.source.ast, records: program.records,
    sourceOccurrences: program.physicalEmissionContexts.sourceOccurrences, errorRegions: program.errorRegions,
    nativeStorage: program.callableValues.nativeStorage }, [{ use: context.use, declaration: context.declaration,
      bindings: context.bindings, returnDestination: context.returnDestination, error: context.error,
      nodes: [context.declaration], sourceCarriers: [], physicalCarriers: context.operands }]),
  /original selected demand rows, not a native-node inventory/u, "no old signature, empty default or second admission path");
});

function verifyActualWorkerContexts(observations) {
  const { program, source: checked } = analyzeRust({ surfaces: [], files: {
    "index.ts": `import { seed } from "./worker.js"; export function value(): number { return seed; }`,
    "worker.ts": `function checked(value: number): number { if (value < 0) throw new Error("seed"); return value; }
export const seed: number = checked(1);`,
  } });
  const source = createTargetSourceProgram(checked);
  const worker = program.sourceFiles.find(file => source.ast.getFileName(file).endsWith("/worker.ts"));
  assert.equal(worker !== undefined, true, "the worker selection uses an actual checked SourceFile");
  const selected = analyzeRustInitializationErrors({ ast: source.ast, sourceFiles: program.sourceFiles,
    navigation: source.navigation, moduleInitialization: program.moduleInitialization,
    sourceModules: { ...program.sourceModuleConstructions, targets: () => [worker] },
    components: program.sourcePackageComponents, facades: program.sourcePackageFacades, regions: program.errorRegions,
    binaryHooks: [], outputType: "lib", projectRoot: "/src", entryPoint: "index.ts" });
  assert.equal(selected.kind, "resolved", "the existing initializer owner supplies the exact worker composition");
  const callable = program.callableValues;
  assert.equal(observations.calls, 1, "the actual selecting owner ran exactly once");
  assert.equal(observations.requests.kind, "resolved", "the actual checked source use inventory was admitted");
  const result = prepareRustPhysicalEmissionContexts({ ast: source.ast, sourceFiles: program.sourceFiles,
    isNativeNode: () => true, records: program.records, sourceLifetimes: program.sourceLifetimes,
    generic: callable.generic, frames: callable.frames, suspended: callable.suspended, native: callable.native,
    nativeStorage: callable.nativeStorage, nativeProducers: callable.nativeProducers,
    genericCompletions: callable.genericCompletions, genericErrors: program.genericCallableErrors,
    declarationGenericRequirements: program.declarationGenericRequirements, errorRegions: program.errorRegions,
    sourceOccurrences: program.physicalEmissionContexts.sourceOccurrences, emissionRequests: observations.requests.value,
    constructions: [], projectTypes: program.projectTypes,
    initialization: selected.value });
  assert.equal(result.kind, "resolved", result.diagnostics.map(issue => issue.message).join("\n").slice(0, 2048));
  const context = result.value.contexts.contexts.find(context => context.use.role === "worker-initializer" && context.declaration === worker);
  assert.equal(context !== undefined && context.error.kind === "initializer", true, "a wrapper is not silently treated as its source module");
  assert.equal(context.error.initializer === selected.value.workerFor(worker), true, "same canonical selected initializer object");
  assert.equal(Object.isFrozen(context.error) && Object.isFrozen(context.error.initializer), true);
  assert.equal(result.value.contexts.contexts.some(context => context.use.role === "module-initializer"), true,
    "actual selected module initializer contexts accompany the worker composition");
}

test("worker contexts retain the existing complete initializer selection, not an invented module error region (instrumented load observation)", () => {
  const collectorUrl = new URL("../../../dist/analysis/callables/emission-requests.js", import.meta.url).href;
  const helperUrl = new URL("../../helpers/rust-session.mjs", import.meta.url).href;
  const initializationUrl = new URL("../../../dist/analysis/errors/initialization.js", import.meta.url).href;
  const preparationUrl = new URL("../../../dist/analysis/program/physical-emission-contexts.js", import.meta.url).href;
  const key = "r14-actual-worker-source-requests";
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
const observations = { calls: 0, anchors: 0 };
globalThis[Symbol.for(${JSON.stringify(key)})] = observations;
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url !== ${JSON.stringify(collectorUrl)}) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  const anchor = "export function prepareRustPhysicalCallableEmissionRequests(";
  assert.equal(source.split(anchor).length, 2, "one exact source-request observation anchor");
  observations.anchors++;
  const extension = 'export function prepareRustPhysicalCallableEmissionRequests(...inputs) { const result = observedPrepareRustPhysicalCallableEmissionRequests(...inputs); const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.calls++; observations.requests = result; return result; }';
  return { ...loaded, source: source.replace(anchor, "function observedPrepareRustPhysicalCallableEmissionRequests(") + "\\n" + extension };
} });
const { analyzeRust } = await import(${JSON.stringify(helperUrl)});
const { analyzeRustInitializationErrors } = await import(${JSON.stringify(initializationUrl)});
const { prepareRustPhysicalEmissionContexts } = await import(${JSON.stringify(preparationUrl)});
(${verifyActualWorkerContexts.toString()})(observations);
assert.equal(observations.anchors, 1, "one observation, no production observer or altered source input");
process.stdout.write("R14_INSTRUMENTED_WORKER_CONTEXT_PROOF");
`;
  const observed = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.equal(observed.status, 0, `instrumented actual worker proof: ${observed.error?.message ?? ""}\n${observed.stderr.slice(-4096)}\n${observed.stdout.slice(-2048)}`);
  assert.equal(observed.stdout, "R14_INSTRUMENTED_WORKER_CONTEXT_PROOF", "explicit instrumented worker proof label");
});
