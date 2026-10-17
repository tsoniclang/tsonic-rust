import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram, sourceClassFieldHasStorage } from "@tsonic/target-api/source";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import { prepareRustEmissionContextRequests, rustEmissionIdentityBindings } from "../../../dist/analysis/callables/emission-contexts.js";
import { rustEmissionDeclarationBindings } from "../../../dist/analysis/callables/emission-requests.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";
import { prepareRustPhysicalEmissionContexts } from "../../../dist/analysis/program/physical-emission-contexts.js";
import { analyzeRustInitializationErrors } from "../../../dist/analysis/errors/initialization.js";
import { requireRustEmissionContext, rustContextForEmission } from "../../../dist/backend/planner/program/plan-context.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

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

const finiteEmissionSource = `
import type { int32 } from "@tsonic/core/types.js";
class Base {
  text: string = "ready";
  constructor(value: string = "ready") { this.text = value; }
  identity<Value>(value: Value): Value { return value; }
  get present(): boolean { return this.text.includes("ready"); }
  set present(value: boolean) { this.text = value ? "ready" : "empty"; }
}
class Derived extends Base {
  constructor(value: string = "ready") { super(value); }
  identity<Other>(value: Other): Other { return value; }
}
function openCall<Value>(receiver: Base, value: Value): Value { return receiver.identity<Value>(value); }
function relay<Other>(receiver: Base, value: Other): Other { return openCall<Other>(receiver, value); }
function apply<Value>(value: Value, callback: (value: Value) => Value): Value { return callback(value); }
export function nativeInput(value: number): number { return apply(value, current => current); }
export function numberCall(receiver: Base, value: int32): int32 { return relay<int32>(receiver, value); }
export function stringCall(receiver: Base, value: string): string { return relay<string>(receiver, value); }
export function create(): boolean {
  const value = new Derived();
  value.present = true;
  return value.present;
}
`;

const earlyStorageConsumerSource = `
async function first(value: number): Promise<number> { return value; }
async function second(value: number): Promise<number> { return value; }
function selected(): typeof first { return first; }
export function compare(): boolean {
  const alias = selected();
  return alias === first && alias !== second;
}
export async function invoke(value: number): Promise<number> {
  const alias = selected();
  return await alias(value);
}
`;

const scalarReturnSource = `
export function owner(value: boolean): boolean { return value; }
`;

const lexicalIndexSource = `
export function accumulatedIndex(): boolean {
  const values = [3n];
  let indexReads = 0;
  const index = (): number => { indexReads += 1; return 0; };
  const accumulated = values[index()] += values[0];
  return accumulated === 6n && values[0] === 6n && indexReads === 1;
}
`;

const ownedCaptureSource = `
export async function keep(value: number, pending: Promise<void>): Promise<number> {
  const read = () => value;
  await pending;
  return read();
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

test("declaration bindings keep full formals and only free captured generic identities", () => {
  const value = Object.freeze({ kind: "type-parameter", identity: "declared:value", name: "Value" });
  const outer = Object.freeze({ kind: "type-parameter", identity: "captured:value", name: "Value" });
  const unused = Object.freeze({ kind: "type-parameter", identity: "declared:unused", name: "Unused" });
  const region = Object.freeze({ kind: "bound", binderIdentity: "declared", identity: "region", name: "region" });
  const outerRegion = Object.freeze({ kind: "bound", binderIdentity: "captured", identity: "region", name: "region" });
  const length = Object.freeze({ kind: "parameter", identity: "declared:length", name: "Length" });
  const outerLength = Object.freeze({ kind: "parameter", identity: "captured:length", name: "Length" });
  const parameters = Object.freeze([
    { kind: "type", type: value }, { kind: "type", type: unused },
    { kind: "lifetime", lifetime: region }, { kind: "const", value: length },
  ]);
  const environment = Object.freeze([
    { kind: "type", type: { ...value } }, { kind: "type", type: outer },
    { kind: "lifetime", lifetime: { ...region } }, { kind: "lifetime", lifetime: outerRegion },
    { kind: "const", value: { ...length } }, { kind: "const", value: outerLength },
  ]);
  const bindings = rustEmissionDeclarationBindings(parameters, environment);
  assert.equal(bindings !== undefined, true, "the same declared reference in the producer environment is not a second formal");
  assert.equal(bindings.types.size, 3, "all declared, unused and same-spelling outer type binders remain present");
  for (const parameter of [value, outer, unused]) assert.equal(bindings.types.get(parameter.identity)?.identity,
    parameter.identity, parameter.identity + ": exact original type identity");
  assert.equal(bindings.lifetimes.size, 2, "equal lifetime spelling never merges different actual binders");
  for (const lifetime of [region, outerRegion]) assert.equal(rustLifetimeKey(bindings.lifetimes.get(rustLifetimeKey(lifetime))),
    rustLifetimeKey(lifetime), lifetime.binderIdentity + ": exact native lifetime binder");
  assert.equal(bindings.consts.size, 2, "declared and free captured const binders remain separate");
  for (const parameter of [length, outerLength]) assert.equal(bindings.consts.get(parameter.identity)?.identity,
    parameter.identity, parameter.identity + ": exact const identity");
  assert.equal(bindings.types.has("foreign:value"), false, "no unselected source type identity is invented");
  assert.equal(Object.isFrozen(bindings) && typeof bindings.types.set === "undefined" &&
    typeof bindings.lifetimes.set === "undefined" && typeof bindings.consts.set === "undefined", true,
  "the selecting owner publishes one immutable binding value");
  const freeOnly = rustEmissionDeclarationBindings([], environment);
  assert.equal(freeOnly !== undefined && freeOnly.types.size === 2 && freeOnly.lifetimes.size === 2 && freeOnly.consts.size === 2,
    true, "an enclosing free environment is retained even when this declaration has no formals");
});

test("inline callback bodies retain the original finite enclosing use and concrete bindings", () => {
  const source = `
    import type { int32 } from "@tsonic/core/types.js";
    class Base { identity<Value>(value: Value): Value { return value; } }
    class Derived extends Base { override identity<Value>(value: Value): Value { return value; } }
    function pass<Value>(value: Value): Value { return value; }
    function relay<Value>(receiver: Base, value: Value): Value {
      const mapped = [value].map(current => pass<Value>(current));
      return receiver.identity<Value>(mapped[0]!);
    }
    export function numberValue(value: int32): int32 { return relay<int32>(new Derived(), value); }
    export function stringValue(value: string): string { return relay<string>(new Derived(), value); }
  `;
  const compiled = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": source } }).result;
  assert.equal(compiled.diagnostics.length, 0,
    compiled.diagnostics.map(issue => issue.code + ": " + issue.message).join("\n").slice(0, 2048));
  const program = compiled.program;
  const { ast } = program.source;
  const callback = program.callableValues.nativeProducers.producers.find(producer => ast.is.IsArrowFunction(producer.declaration));
  assert.equal(callback !== undefined, true, "the actual mapped callback has its original selected native producer");
  const prepared = program.physicalEmissionContexts;
  const parents = prepared.contexts.filter(context => context.role === "specialized-body" &&
    ast.text(ast.name(context.declaration)) === "relay");
  assert.equal(parents.length, 2, "the same callback is created in both actual finite source variants");
  const children = parents.map(parent => {
    const body = prepared.bodyContextFor(parent.use, callback.declaration);
    assert.equal(body !== undefined && body.declaration === callback.declaration, true,
      "the exact enclosing use selects its original callback body before publication");
    assert.equal(body.use !== parent.use && body.use.subject.enclosingUse === parent.use, true,
      "a nested body retains the original selected creation use, not a reconstructed owner key");
    const freeTypes = callback.environment.filter(argument => argument.kind === "type");
    assert.equal(freeTypes.length > 0, true, "the real callback captures its enclosing source type identity");
    for (const argument of freeTypes) {
      assert.equal(argument.type.kind, "type-parameter", "the actual captured type has its canonical source binder");
      const expected = parent.bindings.types.get(argument.type.identity);
      assert.equal(expected !== undefined && expected.kind !== "type-parameter", true,
        "the actual finite enclosing body supplies its concrete replacement");
      assert.equal(rustTargetTypeRefEquals(body.bindings.types.get(argument.type.identity), expected), true,
        "the inner body retains exactly that replacement for the same source binder");
    }
    assert.equal(prepared.bodyContextFor({ ...parent.use }, callback.declaration) === undefined, true,
      "a copied enclosing use never recovers the original selected callback body");
    assert.equal(prepared.bodyContextFor(parent.use, { ...callback.declaration }) === undefined, true,
      "a copied callable declaration cannot select a body by shape");
    assert.equal(prepared.bodyContextFor(parent.use, parent.declaration) === undefined, true,
      "the enclosing declaration is not a substitute for the actual inline creation");
    assert.equal(prepared.contextFor(body.use) === body, true, "one canonical context index owns the selected body");
    assert.equal(typeof body.bindings.types.set === "undefined", true, "the selected nested environment is immutable");
    return body;
  });
  assert.equal(children[0] !== children[1] && children[0].use !== children[1].use, true,
    "distinct actual finite enclosing uses never collapse into one declaration-only callback context");
});

for (const [name, surfaces, field] of [
  ["native", [], "apply(1, value => value + 1)"],
  ["js-source", ["js"], "apply(1, value => value + 1)"],
  ["js-provider", ["js"], "[1, 2].map(value => value + 1)[0]!"],
]) {
  test(`field callbacks retain the exact selected explicit constructor layer (${name})`, () => {
    const source = `
      function apply(value: number, callback: (value: number) => number): number { return callback(value); }
      class Box<Value> {
        values: Value[] = [];
        value = ${field};
        constructor() {}
      }
      export function run(): number { return new Box<string>().value; }
    `;
    const compiled = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib" } },
      files: { "index.ts": source } }).result;
    assert.equal(compiled.diagnostics.length, 0,
      compiled.diagnostics.map(issue => issue.code + ": " + issue.message).join("\n").slice(0, 2048));
    const program = compiled.program;
    const { ast } = program.source;
    const callback = program.callableValues.nativeProducers.producers.find(producer => ast.is.IsArrowFunction(producer.declaration));
    assert.equal(callback !== undefined, true, "the real field callback has its exact selected native producer");
    const prepared = program.physicalEmissionContexts;
    const layers = prepared.contexts.filter(context => context.role === "constructor-layer" && ast.is.IsConstructorDeclaration(context.declaration));
    assert.equal(layers.length > 0, true, "an actual explicit constructor owns the selected class initialization layer");
    let selectedBodies = 0;
    for (const layer of layers) {
      const body = prepared.bodyContextFor(layer.use, callback.declaration);
      if (body === undefined) continue;
      selectedBodies += 1;
      assert.equal(layer.bindings.types.size > 0, true, "the class-selected binding vector includes its original declared type binder");
      assert.equal(body.declaration === callback.declaration && body.use.subject.enclosingUse === layer.use, true,
        "the field callback takes the actual inline route in its original selected constructor layer");
      assert.equal(prepared.contextFor(body.use) === body, true, "the selected layer and body use the same canonical A context index");
      for (const argument of callback.environment) if (argument.kind === "type" && argument.type.kind === "type-parameter") {
        assert.equal(layer.bindings.types.has(argument.type.identity), true, "a free class type retains its exact original selected binder");
        assert.equal(rustTargetTypeRefEquals(body.bindings.types.get(argument.type.identity),
          layer.bindings.types.get(argument.type.identity)), true, "the inline field body uses its exact class-selected binding");
      }
      for (const identity of layer.bindings.types.keys()) if (!callback.environment.some(argument =>
        argument.kind === "type" && argument.type.kind === "type-parameter" && argument.type.identity === identity))
        assert.equal(body.bindings.types.has(identity), false, "unused enclosing binders are not copied into an unrelated inline environment");
      assert.equal(prepared.bodyContextFor({ ...layer.use }, callback.declaration) === undefined, true,
        "a copied selected constructor use cannot recover a field callback");
      assert.equal(prepared.bodyContextFor(layer.use, { ...callback.declaration }) === undefined, true,
        "a copied declaration cannot recover the actual field callback");
      assert.equal(prepared.bodyContextFor(layer.use, layer.declaration) === undefined, true,
        "the constructor itself is not a replacement for its actual field callback");
    }
    assert.equal(selectedBodies > 0, true, "the control exercises an actual inline field body, never only a frame/generic/helper early return");
  });
}

test("declaration environment admission still rejects duplicate and incompatible binding inputs", () => {
  const parameter = Object.freeze({ kind: "type", type: { kind: "type-parameter", identity: "value", name: "Value" } });
  const lifetime = Object.freeze({ kind: "lifetime", lifetime: { kind: "parameter", identity: "region", name: "region" } });
  const constant = Object.freeze({ kind: "const", value: { kind: "parameter", identity: "length", name: "Length" } });
  for (const [name, argument] of [["type", parameter], ["lifetime", lifetime], ["const", constant]]) {
    assert.equal(rustEmissionDeclarationBindings([argument, argument], []) === undefined, true,
      name + ": a duplicate declaration is not repaired by the selection owner");
    assert.equal(rustEmissionDeclarationBindings([], [argument, argument]) === undefined, true,
      name + ": a malformed duplicate free environment is not silently deduplicated");
    assert.equal(rustEmissionIdentityBindings([argument, argument]) === undefined, true,
      name + ": the existing strict generic binding matcher remains unchanged");
  }
  for (const [name, owned, incompatible] of [
    ["type", parameter, { ...parameter, type: { ...parameter.type, name: "Contradictory" } }],
    ["lifetime", lifetime, { ...lifetime, lifetime: { ...lifetime.lifetime, name: "contradictory" } }],
    ["const", constant, { ...constant, value: { ...constant.value, name: "Contradictory" } }],
  ]) assert.equal(rustEmissionDeclarationBindings([owned], [incompatible]) === undefined, true,
    name + ": a contradictory reference to the identical declared binder is rejected");
  for (const [name, argument] of [
    ["concrete type", { kind: "type", type: { kind: "source-primitive", name: "int32" } }],
    ["static lifetime", { kind: "lifetime", lifetime: { kind: "static" } }],
    ["literal const", { kind: "const", value: { kind: "integer", value: "2" } }],
  ]) {
    assert.equal(rustEmissionDeclarationBindings([argument], []) === undefined, true, name + ": not a declared parameter");
    assert.equal(rustEmissionDeclarationBindings([], [argument]) === undefined, true, name + ": not a free generic reference");
  }
});

test("real generic declarations retain owned, unused and captured binders without duplicate self bindings", () => {
  const source = `
export function identity<Value, Unused>(value: Value): Value { return value; }
export function make<Outer>(captured: Outer): <Value>(value: Value) => Outer {
  return <Value>(value: Value): Outer => captured;
}
`;
  for (const surfaces of [[], ["js"]]) {
    const result = compileRust({ surfaces, files: { "index.ts": source } }).result;
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("\n").slice(0, 2048));
    assert.equal(result.artifacts.some(artifact => artifact.path.endsWith(".rs")), true,
      "actual checked native generic declarations and captured outer binders emit Rust");
  }
});

test("module and non-callable metadata owners never enter callable TypeParameterList extraction", () => {
  const result = compileRust({surfaces: [], files: {"index.ts": `
export const seed: number = 1;
export enum State { First = 1, Second = 2 }
class Item { static value: number = 2; field: number = 3; }
export function read(): number { return seed + Item.value + new Item().field; }
export function state(): State { return State.First; }
`}}).result;
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.message).join("\n").slice(0, 2048));
  assert.equal(result.artifacts.some(artifact => artifact.path.endsWith(".rs")), true,
    "the actual module, enum, class and static/instance metadata requests emit without a non-callable AST panic");
});

test("annotated native parameter and return carriers stay selected at their declaration owners", () => {
  for (const surfaces of [[], ["js"]]) {
    const result = compileRust({surfaces, files: {"index.ts": `
import type {float32, int64} from "@tsonic/core/types.js";
export function narrow(value: float32): float32 { return value; }
export function wide(value: int64): int64 { return value; }
`}}).result;
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.message).join("\n").slice(0, 2048));
    const output = rustSourceText(result);
    assert.equal(/\bf32\b/u.test(output), true, "the actual native f32 carrier is required and retained");
    assert.equal(/\bi64\b/u.test(output), true, "the actual native i64 carrier is required and retained");
  }
});

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
    finalizeSelected: { value() {
      try { return registry.finalizeSelected(); }
      finally { observations.earlyStoragePhase = "consumers"; }
    } },
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
      observations.earlyStoragePhase = "materializing";
      const published = registry.seal(input);
      observations.earlyStoragePhase = "consumers";
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

function observeNativeStorage(queries, observations) {
  observations.storageFactories++;
  observations.storagePlan = queries;
  const methods = Object.fromEntries(["valueFor", "operandFor", "invocationCallableFor"].map(method => {
    const reads = new Map();
    observations.rawSelections.set(method, reads);
    return [method, node => {
      const before = observations.storageMaterializations;
      const beforeReturns = observations.returnMaterializations;
      const selected = queries[method](node);
      const stored = reads.get(node);
      assert.equal(stored === undefined ? selected.kind === "unresolved" : stored.selected === selected, true,
        method + ": a pure read retains the canonical record or honest unprepared state");
      assert.equal(observations.storageMaterializations, before, method + ": pure reads never select missing storage");
      assert.equal(observations.returnMaterializations, beforeReturns, method + ": pure reads never select a return indirectly");
      observations.storageLookups++;
      return selected;
    }];
  }));
  observations.rawSelections.set("returnFor", observations.returnSelections);
  return Object.freeze({ ...queries, ...methods,
    prepareReturn(node) {
      const selected = queries.prepareReturn(node);
      observations.returnPreparations++;
      if (observations.producerSealing) observations.terminalReturnReads.add(node);
      if (selected.kind !== "unresolved") assert.equal(observations.returnSelections.get(node)?.selected === selected, true,
        "each actual producer preparation reads the sole canonical return record");
      return selected;
    },
    returnFor(node) {
      const before = observations.returnMaterializations;
      const beforeStorage = observations.storageMaterializations;
      const selected = queries.returnFor(node);
      observations.returnLookups++;
      const stored = observations.returnSelections.get(node);
      assert.equal(stored === undefined ? selected.kind === "unresolved" : stored.selected === selected, true,
        "a return lookup reads the original canonical record or honest unprepared state");
      assert.equal(observations.returnMaterializations, before, "pure return lookup never prepares a missing record");
      assert.equal(observations.storageMaterializations, beforeStorage, "pure return lookup never prepares other physical storage");
      return selected;
    },
  });
}

function observeNativeProducerSeal(producers, observations) {
  return Object.freeze({ ...producers,
    seal(...inputs) {
      observations.producerSeals++;
      observations.producerSealing = true;
      const before = observations.returnPreparations;
      try {
        const result = producers.seal(...inputs);
        assert.equal(result.kind, "resolved", "actual native producer sealing completes on the unchanged source");
        assert.equal(observations.returnPreparations > before, true,
          "actual outward, invocation and body sealing reads canonical physical returns");
        return result;
      } finally { observations.producerSealing = false; }
    },
  });
}

test("the planner phase label starts at publication, after the actual callable seal and reachability (instrumented load observation)", () => {
  const options = { surfaces: [], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": genericSource + nativeHandlerSource + earlyStorageConsumerSource + scalarReturnSource + ownedCaptureSource + lexicalIndexSource,
      "frames.ts": frameSource } };
  const ordinary = compileRust(options);
  assert.equal(ordinary.result.diagnostics.length, 0, ordinary.result.diagnostics.map(issue => issue.message).join("\n").slice(0, 2048));
  assert.equal(ordinary.result.artifacts.length > 0, true, "uninjected ordinary pipeline reaches emission");
  const registryUrl = new URL("../../../dist/analysis/callables/value-plan.js", import.meta.url).href;
  const componentsUrl = new URL("../../../dist/analysis/program/source-package-components.js", import.meta.url).href;
  const handlerUrl = new URL("../../../dist/analysis/operations/native-handlers.js", import.meta.url).href;
  const collectorUrl = new URL("../../../dist/analysis/callables/emission-requests.js", import.meta.url).href;
  const storageUrl = new URL("../../../dist/analysis/callables/native-storage.js", import.meta.url).href;
  const producersUrl = new URL("../../../dist/analysis/callables/native-producers.js", import.meta.url).href;
  const lifecycleUrl = new URL("../../../dist/analysis/callables/physical-lifecycle.js", import.meta.url).href;
  const identityUrl = new URL("../../../dist/analysis/callables/generic-identities.js", import.meta.url).href;
  const dispatchUrl = new URL("../../../dist/analysis/callables/generic-dispatch.js", import.meta.url).href;
  const carriersUrl = new URL("../../../dist/target-model/types/carriers/generic-callables.js", import.meta.url).href;
  const frameCarriersUrl = new URL("../../../dist/target-model/types/carriers/frame-callables.js", import.meta.url).href;
  const helperUrl = new URL("../../helpers/rust-session.mjs", import.meta.url).href;
  const key = "r14-instrumented-callable-publication-proof";
  const registryObservation = `export function createRustCallableValuePlanRegistry() { return globalThis[Symbol.for(${JSON.stringify(key)})].registry(observedCreateRustCallableValuePlanRegistry()); }`;
  const componentsObservation = `export function analyzeRustSourcePackageComponents(...inputs) { const result = observedAnalyzeRustSourcePackageComponents(...inputs); globalThis[Symbol.for(${JSON.stringify(key)})].components.push(result); return result; }`;
  const handlerObservation = `export function analyzeRustNativeHandlers(...inputs) { const result = observedAnalyzeRustNativeHandlers(...inputs); globalThis[Symbol.for(${JSON.stringify(key)})].handlers(inputs); return result; }`;
  const requestObservation = `export function prepareRustPhysicalCallableEmissionRequests(...inputs) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.beforeRequests(inputs[0]); const result = observedPrepareRustPhysicalCallableEmissionRequests(...inputs); observations.requests = result; observations.requestSelections++; return result; }`;
  const storageObservation = `export function createRustNativeStorageQueries(...inputs) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; return observations.storage(observedCreateRustNativeStorageQueries(...inputs)); }`;
  const producerObservation = `export function createRustNativeCallableProducerPlan(...inputs) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; return observations.producers(observedCreateRustNativeCallableProducerPlan(...inputs)); }`;
  const lifecycleObservation = `export function createRustPhysicalCallableLifecycle(...inputs) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.earlyStoragePhase = "materializing"; const result = observedCreateRustPhysicalCallableLifecycle(...inputs); observations.lifecycle = result; observations.earlyStoragePhase = "consumers"; return result; }`;
  const identityObservation = `export function prepareRustGenericCallableIdentityRequests(...inputs) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.assertPrepared(inputs[0]); observations.identityComparisons = inputs[0].sources.comparisons.length; return observedPrepareRustGenericCallableIdentityRequests(...inputs); }`;
  const dispatchObservation = `export function prepareRustGenericCallableDispatchRequests(...inputs) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.assertPrepared(inputs[0]); const result = observedPrepareRustGenericCallableDispatchRequests(...inputs); observations.dispatched = result.length; return result; }`;
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { sourceMarkerFactKey } from "@tsonic/tsts";
const observationKey = Symbol.for(${JSON.stringify(key)});
const observations = { seals: 0, publications: 0, components: [], anchors: new Set(), handlerSelections: 0,
  requestSelections: 0, rawSelections: new Map(), earlyStoragePhase: "idle", preparedConsumers: 0, storageFactories: 0,
  storageMaterializations: 0, storageLookups: 0, earlyStorageSelections: 0, storageWriteAnchors: new Set(),
  returnSelections: new Map(), returnMaterializations: 0, returnPreparations: 0, returnLookups: 0, earlyReturnSelections: 0,
  returnWriteAnchors: 0, producerSeals: 0, producerSealing: false, terminalReturnReads: new Set() };
globalThis[observationKey] = observations;
observations.storage = queries => (${observeNativeStorage.toString()})(queries, observations);
observations.producers = producers => (${observeNativeProducerSeal.toString()})(producers, observations);
observations.storageSelected = (method, node, selected) => {
  assert.equal(selected.kind !== "unresolved" && Object.isFrozen(selected), true,
    method + ": only a completed immutable physical selection enters the canonical map");
  assert.equal(observations.earlyStoragePhase !== "closed" && observations.earlyStoragePhase !== "verifying", true,
    method + ": no selection writer runs after publication");
  const reads = observations.rawSelections.get(method);
  const previous = reads.get(node);
  reads.set(node, { count: (previous?.count ?? 0) + 1, selected });
  observations.storageMaterializations++;
  if (observations.lifecycle === undefined) observations.earlyStorageSelections++;
};
observations.returnSelected = (node, selected) => {
  assert.equal(selected.kind !== "unresolved" && Object.isFrozen(selected), true,
    "only an actually completed immutable physical return is materialized");
  const previous = observations.returnSelections.get(node);
  observations.returnSelections.set(node, { count: (previous?.count ?? 0) + 1, selected });
  observations.returnMaterializations++;
  if (observations.lifecycle === undefined) observations.earlyReturnSelections++;
};
observations.assertPrepared = input => {
  assert.equal(input.nativeStorage === observations.lifecycle.prepared, true, "the real caller supplies the SAME canonical prepared view");
  observations.preparedConsumers++;
};
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
  observations.requestInput = input;
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
    { url: ${JSON.stringify(storageUrl)}, anchor: "export function createRustNativeStorageQueries(",
      replacement: "function observedCreateRustNativeStorageQueries(", extension: ${JSON.stringify(storageObservation)} },
    { url: ${JSON.stringify(producersUrl)}, anchor: "export function createRustNativeCallableProducerPlan(",
      replacement: "function observedCreateRustNativeCallableProducerPlan(", extension: ${JSON.stringify(producerObservation)} },
    { url: ${JSON.stringify(lifecycleUrl)}, anchor: "export function createRustPhysicalCallableLifecycle(",
      replacement: "function observedCreateRustPhysicalCallableLifecycle(", extension: ${JSON.stringify(lifecycleObservation)} },
    { url: ${JSON.stringify(identityUrl)}, anchor: "export function prepareRustGenericCallableIdentityRequests(",
      replacement: "function observedPrepareRustGenericCallableIdentityRequests(", extension: ${JSON.stringify(identityObservation)} },
    { url: ${JSON.stringify(dispatchUrl)}, anchor: "export function prepareRustGenericCallableDispatchRequests(",
      replacement: "function observedPrepareRustGenericCallableDispatchRequests(", extension: ${JSON.stringify(dispatchObservation)} },
  ];
  const selection = selections.find(selection => selection.url === url);
  if (selection === undefined) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  assert.equal(source.split(selection.anchor).length, 2, "one exact instrumented observation anchor: " + selection.url);
  observations.anchors.add(url);
  let observed = source.replace(selection.anchor, selection.replacement);
  if (url === ${JSON.stringify(storageUrl)}) {
    const anchor = "returns.set(declaration, selection);";
    assert.equal(observed.split(anchor).length, 2, "one exact actual return-materialization write anchor");
    observations.returnWriteAnchors++;
    observed = observed.replace(anchor, "{ " + anchor + " globalThis[Symbol.for(" +
      ${JSON.stringify(JSON.stringify(key))} + ")].returnSelected(declaration, selection); }");
    for (const [method, storage] of [["valueFor", "values"], ["operandFor", "operands"], ["invocationCallableFor", "invocations"]]) {
      const write = storage + ".set(node, selection);";
      assert.equal(observed.split(write).length, 2, method + ": one exact canonical successful-selection write anchor");
      observations.storageWriteAnchors.add(method);
      observed = observed.replace(write, "{ " + write + " globalThis[Symbol.for(" +
        ${JSON.stringify(JSON.stringify(key))} + ")].storageSelected(" + JSON.stringify(method) + ", node, selection); }");
    }
  }
  return { ...loaded, source: observed + "\\n" + selection.extension };
} });
const carriers = await import(${JSON.stringify(carriersUrl)});
const frameCarriers = await import(${JSON.stringify(frameCarriersUrl)});
observations.registry = registry => (${observeCallablePublication.toString()})(registry, assert, carriers, observations);
const { compileRust } = await import(${JSON.stringify(helperUrl)});
const compiled = compileRust(${JSON.stringify(options)});
assert.equal(compiled.result.diagnostics.length, 0, compiled.result.diagnostics.map(issue => issue.message).join("\\n").slice(0, 2048));
assert.equal(compiled.result.program === observations.published, false, "the observed publication is the callable product, not the enclosing program");
assert.equal(compiled.result.program.callableValues === observations.published, true, "the pipeline publishes the exact observed completed product");
assert.equal(observations.anchors.has(${JSON.stringify(registryUrl)}) && observations.anchors.has(${JSON.stringify(componentsUrl)}), true,
  "both original production functions are observed without writing dist");
assert.equal(observations.anchors.size, 9, "each original stage, required input and actual producer-seal observer has one exact anchor");
assert.equal(observations.returnWriteAnchors, 1, "one exact write anchor belongs to the existing canonical return owner");
assert.equal(observations.storageWriteAnchors.size, 3, "all other physical selections use their actual single canonical writer");
assert.equal(observations.seals, 1, "one actual late callable seal");
assert.equal(observations.producerSeals, 1, "one actual terminal native producer seal remains inside the measured window");
assert.equal(observations.publications, 1, "one actual planner publication");
assert.equal(observations.requests.kind, "resolved", "only an admitted complete request inventory is published");
const actualFrames = observations.requestInput.nativeProducers.producers.filter(producer => {
  const operation = observations.requestInput.records.targetOperation.get(producer.declaration);
  return operation?.kind === "closure" && frameCarriers.rustFrameCallableValue(operation.resultCarrier) !== undefined;
});
assert.equal(actualFrames.length > 0 && compiled.result.program.callableValues.frames.definitions.length > 0, true,
  "the unchanged native frame source has its actual selected frame bodies and owning activation");
assert.equal(observations.requests.value.some(request => request.kind === "producer" &&
  frameCarriers.rustFrameCallableValue(request.carrier) !== undefined), false,
  "an actual frame is not an ordinary native Callable producer just because it has a callable protocol");
assert.equal(actualFrames.every(producer => observations.requests.value.some(request => request.kind === "return" &&
  request.subject === producer.declaration)), true, "actual frame body return selection stays in the same canonical request vector");
assert.equal(observations.requestSelections, 1, "the source-use owner is never replayed after sealing");
assert.equal(observations.storageFactories, 1, "the single actual program constructs one canonical physical storage owner");
assert.equal(observations.preparedConsumers, 2, "both actual early consumer owners use the canonical prepared view");
assert.equal(observations.identityComparisons > 0 && observations.dispatched > 0, true,
  "real native identity comparisons and generic dispatch exercise both consumer paths");
assert.equal(observations.earlyReturnSelections > 0, true,
  "the actual source preserves legitimate return materialization before lifecycle creation");
assert.equal(observations.returnLookups > 0 && observations.terminalReturnReads.size > 0, true,
  "both pure readers and actual terminal producer projections consume canonical return records");
assert.equal(observations.storageLookups > 0 && observations.earlyStorageSelections > 0, true,
  "legitimate early metadata preparation and later pure consumers share the same canonical storage");
assert.equal("prepareReturn" in observations.published.nativeStorage, false,
  "published storage never exposes its return construction writer");
for (const writer of ["prepareValue", "prepareOperand", "prepareInvocation"])
  assert.equal(writer in observations.published.nativeStorage, false, writer + ": no construction service is published");
const sourceAst = compiled.result.program.source.ast;
const lexicalProducer = observations.requestInput.nativeProducers.producers.find(producer => {
  const declaration = producer.declaration;
  const body = sourceAst.body(declaration);
  return sourceAst.is.IsArrowFunction(declaration) && body !== undefined && sourceAst.text(body).trim() === "value";
});
assert.equal(lexicalProducer !== undefined, true, "the actual used captured arrow has its original selected native producer");
const lexicalDeclaration = lexicalProducer.declaration;
assert.equal(observations.requestInput.records.targetOperation.get(lexicalDeclaration)?.kind !== "closure", true,
  "native lexical body demand does not depend on a target closure operation");
const lexicalReturn = observations.requests.value.filter(request => request.kind === "return" && request.subject === lexicalDeclaration);
assert.equal(lexicalReturn.length, 1, "the existing construct owner selects each used native body return exactly once");
assert.equal(lexicalReturn[0].owner === lexicalDeclaration, true, "the native body retains its exact declaration owner");
const lexical = observations.requestInput.lexicalFunctions.forDeclaration(lexicalDeclaration);
assert.equal(lexical?.kind === "resolved" && lexical.captures.length > 0, true, "the unchanged source selects real captured inputs");
for (const capture of lexical.captures) assert.equal(observations.requests.value.filter(request =>
  request.kind === "value" && request.subject === capture.reference && request.owner === lexicalDeclaration).length, 1,
  "each original captured reference retains one actual body-owned value request");
const lexicalContext = compiled.result.program.physicalEmissionContexts.contexts.find(context =>
  context.use.subject === lexicalDeclaration && context.use.role === "native-body");
assert.equal(lexicalContext !== undefined && lexicalContext.bindings === lexicalReturn[0].bindings, true,
  "the complete published body consumes the original immutable selecting-owner binding object");
const indexProducer = observations.requestInput.nativeProducers.producers.find(producer => {
  const parent = sourceAst.parent(producer.declaration);
  const name = parent === undefined ? undefined : sourceAst.name(parent);
  return sourceAst.is.IsArrowFunction(producer.declaration) && name !== undefined && sourceAst.text(name) === "index";
});
assert.equal(indexProducer !== undefined, true, "the original compound index arrow has its selected native body producer");
const indexDeclaration = indexProducer.declaration;
const indexEnvironment = observations.requestInput.lexicalFunctions.forDeclaration(indexDeclaration);
assert.equal(indexEnvironment?.kind === "resolved" && indexEnvironment.valueObserved === false, true,
  "an actual call-only lexical body is not an observed stored callable value");
const indexReturns = observations.requests.value.filter(request => request.kind === "return" && request.subject === indexDeclaration);
assert.equal(indexReturns.length, 1, "the exact call-only index body has one canonical return preparation request");
assert.equal(indexReturns[0].owner === indexDeclaration, true, "the index return remains owned by its original arrow body");
assert.equal(observations.requests.value.some(request => request.kind === "value" && request.subject === indexDeclaration), false,
  "preparing a lexical body never manufactures a stored callable value demand");
for (const capture of indexEnvironment.captures) assert.equal(observations.requests.value.some(request =>
  request.kind === "value" && request.subject === capture.reference && request.owner === indexDeclaration), true,
  "the actual index mutation capture keeps its original native body-owned source request");
const scalar = observations.published.nativeProducers.producers.find(producer => {
  const name = sourceAst.name(producer.declaration);
  return name !== undefined && sourceAst.text(name) === "owner";
});
assert.equal(scalar !== undefined, true, "the exact native-valid boolean identity owner participates");
const scalarSelection = observations.returnSelections.get(scalar.declaration);
assert.equal(scalarSelection !== undefined && scalarSelection.count === 1, true,
  "the scalar physical return is selected once through all actual producer modes");
assert.equal(observations.terminalReturnReads.has(scalar.declaration), true,
  "the actual terminal producer seal exercises the scalar regression control");
assert.equal(observations.published.nativeProducers.outwardReturnFor(scalar.declaration) === scalarSelection.selected.carrier, true,
  "scalar outward ABI consumes the same selected physical return");
assert.equal(observations.published.nativeProducers.invocationResultFor(scalar.declaration) === scalarSelection.selected.carrier, true,
  "scalar invocation ABI consumes the same selected physical return");
assert.equal(observations.published.nativeProducers.bodyResultFor(scalar.declaration) === undefined, true,
  "the synchronous scalar owner does not invent an asynchronous body ABI");
let primed = 0;
observations.earlyStoragePhase = "verifying";
for (const [method, reads] of observations.rawSelections) {
  assert.equal(reads.size > 0, true, method + ": the actual retained source exercises this generic materialization role");
  assert.equal(observations.published.nativeStorage[method] === observations.lifecycle.prepared[method], true,
    method + ": early and final readers are the same lookup function");
  for (const [node, row] of reads) {
    assert.equal(observations.storagePlan[method](node) === row.selected, true,
      method + ": original materialization identity survives all real caller stages");
    const kind = method === "valueFor" ? "value" : method === "operandFor" ? "operand"
      : method === "returnFor" ? "return" : "invocation";
    const required = observations.requests.value.some(request => request.kind === kind && request.subject === node);
    const selected = observations.lifecycle.prepared[method](node);
    assert.equal(required ? selected === row.selected : selected.kind === "unresolved", true,
      method + ": the exact requested-role domain is retained; metadata-only selections are not runtime demand");
    assert.equal(reads.get(node).count, 1, method + ": no raw reselection from first materialization through terminal publication");
    primed++;
  }
  const before = reads.size;
  assert.equal(observations.lifecycle.prepared[method](Object.freeze({})).kind, "unresolved",
    method + ": a foreign unrequested key remains honestly unprepared");
  assert.equal(reads.size, before, method + ": a foreign pure lookup never materializes storage");
}
observations.earlyStoragePhase = "closed";
assert.equal(primed > 0, true, "the actual generic materialization domain is nonempty");
const { IsTypeSyntaxNode } = await import("@tsonic/target-api/source");
const { records } = observations.handlerInputs;
let metadata = 0;
const roles = new Set(observations.requests.value.map(request => request.kind));
for (const role of ["value", "operand", "return", "invocation", "type", "producer"])
  assert.equal(roles.has(role), true, role + ": the unchanged source exercises every original required request role");
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
  test(`selected native module callables prepare bodies without inventing binding storage (${surfaces[0] ?? "native"})`, () => {
    const program = actual(`
const concise = (value: boolean): boolean => value;
const expression = function(value: boolean): boolean { return value; };
const observed = (value: boolean): boolean => value;
export function retain(): typeof observed { return observed; }
export function read(flag: boolean): boolean {
  const ordinary = flag;
  return concise(ordinary) && expression(ordinary);
}
`, surfaces);
    const ast = program.source.ast;
    const declarations = new Map();
    const visit = node => {
      if (ast.is.IsVariableDeclaration(node)) {
        const name = ast.name(node);
        if (name !== undefined && ast.is.IsIdentifier(name)) declarations.set(ast.text(name), node);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    for (const name of ["concise", "expression", "observed"]) {
      const declaration = declarations.get(name);
      const binding = program.records.moduleBinding.get(declaration);
      assert.equal(binding?.storage === "native-callable", true, name + ": the original source owner selects native item storage");
      const body = program.physicalEmissionContexts.contextForOwner(binding.callableDeclaration, "native-body");
      assert.equal(body !== undefined && body.declaration === binding.callableDeclaration, true,
        name + ": the original selected callable owns its required emitted body");
      assert.equal(body.use.subject === binding.callableDeclaration, true, name + ": no equal-looking binding subject replaces the body owner");
    }
    const observed = declarations.get("observed");
    assert.equal(program.records.moduleBinding.get(observed)?.value !== undefined, true,
      "an actual first-class module value retains its separately selected binding payload");
    assert.equal(program.callableValues.nativeStorage.valueFor(observed).kind !== "unresolved", true,
      "a selected first-class module value still requires its canonical binding storage");
    const ordinary = declarations.get("ordinary");
    assert.equal(ordinary !== undefined, true, "the ordinary value binding remains part of the same source control");
    const storage = program.callableValues.nativeStorage.valueFor(ordinary);
    assert.equal(storage.kind !== "unresolved" && storage.carrier.kind === "source-primitive" && storage.carrier.name === "bool", true,
      "an ordinary value binding still requires its canonical physical storage");
  });
  test(`finite specialized and concrete body contexts preserve original selecting identities (${surfaces[0] ?? "native"})`, () => {
    const source = surfaces.length === 0
      ? finiteEmissionSource.replace('this.text.includes("ready")', 'this.text === "ready"')
      : finiteEmissionSource;
    const compiled = compileRust({ surfaces, target: { id: "rust", options: { outputType: "lib" } },
      files: { "index.ts": source } }).result;
    assert.equal(compiled.diagnostics.length, 0, compiled.diagnostics.map(issue => issue.code + ": " + issue.message).join("\n").slice(0, 2048));
    const program = compiled.program;
    const prepared = program.physicalEmissionContexts;
    const counts = new Map();
    for (const context of prepared.contexts) {
      counts.set(context.role, (counts.get(context.role) ?? 0) + 1);
      assert.equal(context.role === context.use.role, true, "finite role retains the original shared use role");
      assert.equal(prepared.contextForOwner(context.use.subject, context.role) === context, true,
        "the original selecting owner reads the same context and use");
      assert.equal(prepared.contextForOwner({ ...context.use.subject }, context.role) === undefined, true,
        "a copied owner never recovers a selected native context");
      assert.equal(prepared.contextForOwner({}, context.role) === undefined, true, "foreign owners stay absent");
      const metadata = { input: { program }, emissionContext: undefined };
      const original = requireRustEmissionContext(metadata, context.use.subject, context.role, context.declaration);
      const rendering = rustContextForEmission(metadata, original);
      assert.equal(rendering.emissionContext === context && rendering.emissionContext.use === context.use, true,
        "renderer transport preserves the exact original use");
      assert.equal(rendering.typeParameterSubstitutions === context.bindings.types &&
        rendering.lifetimeSubstitutions === context.bindings.lifetimes, true,
      "renderer transport forwards the same immutable maps, not another binder");
      assert.equal(typeof context.bindings.types.set === "undefined" && typeof context.bindings.lifetimes.set === "undefined" &&
        typeof context.bindings.consts.set === "undefined", true, "no mutable binding builder is exposed");
    }
    for (const role of ["native-body", "specialized-body", "project-body", "constructor", "constructor-layer"])
      assert.equal((counts.get(role) ?? 0) > 0, true, role + ": actual emitted route is nonempty");
    for (const body of program.projectMethodDispatch.bodies) {
      const context = prepared.contextForOwner(body, "project-body");
      assert.equal(context !== undefined && context.declaration === body.declaration, true,
        "every selected concrete native body has complete pre-seal coverage");
      assert.equal(program.projectMethodDispatch.bodyFor(body.concrete, body.declaration, body.contractVariant) === body, true,
        "concrete body reader retains the original selected row");
      assert.equal(program.projectMethodDispatch.bodyFor({ ...body.concrete }, body.declaration, body.contractVariant) === undefined, true,
        "a copied concrete definition never selects a body");
      if (body.contractVariant !== undefined) assert.equal(
        program.projectMethodDispatch.bodyFor(body.concrete, body.declaration, { ...body.contractVariant }) === undefined, true,
      "a copied contract variant never selects by equal arguments");
      for (const [identity, value] of body.bindings.types)
        assert.equal(rustTargetTypeRefEquals(context.bindings.types.get(identity), value), true,
          identity + ": selected concrete binding survives unchanged");
    }
    let specialized = 0;
    for (const producer of program.callableValues.nativeProducers.producers)
      for (const variant of program.sourceCallableSpecializations.variantsForCallable(producer.declaration)) {
        const context = prepared.contextForOwner(variant, "specialized-body");
        assert.equal(context !== undefined && context.use.subject === variant, true, "the actual finite source variant owns its body context");
        for (const [index, identity] of variant.sourceTypeParameterIdentities.entries())
          assert.equal(rustTargetTypeRefEquals(context.bindings.types.get(identity), variant.targetTypeArguments[index]), true,
            identity + ": actual finite replacement, not an identity binding or another variant");
        specialized++;
      }
    assert.equal(specialized > 1, true, "both real native finite replacements are exercised");
    assert.equal(compiled.artifacts.some(artifact => artifact.path.endsWith(".rs")), true, "ordinary uninstrumented planning emits source");
  });
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
      assert.equal(prepared.contextForOwner(context.use.subject, context.role) === context, true, "same original selecting owner and finite role");
      assert.equal(prepared.contextForOwner({ ...context.use.subject }, context.role) === undefined, true, "copied original owner is foreign");
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

function verifyRequiredMissingOperand(program, observations) {
  const prepared = program.physicalEmissionContexts;
  const operand = prepared.operands.find(operand => operand.origin.kind === "operand");
  assert.equal(operand !== undefined, true, "the negative control starts from an actual checked operand");
  const original = observations.preparations.find(preparation => preparation.requests.some(request => request.use === operand.context.use));
  assert.equal(original !== undefined, true, "the operand retains its actual complete preparation input");
  const owner = original.requests.find(request => request.use === operand.context.use);
  const duplicate = prepareRustEmissionContextRequests(original.input, [owner, { ...owner,
    use: targetUseSiteRef(owner.use.subject, owner.role, owner.use.enclosingContract + ":duplicate") }]);
  assert.equal(duplicate.kind, "rejected", "duplicate original owner/role coverage is rejected before sealing");
  assert.equal(duplicate.diagnostics.some(issue => issue.message ===
    "One original emitted owner and role requires exactly one selected physical context."), true,
  "equal-looking native context keys do not hide duplicate selecting ownership");
  const missing = prepareRustPhysicalEmissionContexts({ ...original.input,
    nativeProducers: { ...original.input.nativeProducers,
      producers: original.input.nativeProducers.producers.filter(producer => producer.declaration !== owner.declaration) } });
  assert.equal(missing.kind, "rejected", "missing required source body coverage is rejected before publication");
  assert.equal(missing.diagnostics.some(issue => issue.code === "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED" &&
    issue.message === "An emitted callable demand requires its original selected body context before publication."), true,
  "a required actual body never falls back to metadata or an enclosing context");
  const result = prepareRustEmissionContextRequests({ ...original.input, sourceOccurrences: [],
    nativeStorage: { ...original.input.nativeStorage, valueFor: () => ({ kind: "unresolved", reason: "missing native producer proof" }) } },
  [{ use: targetUseSiteRef(operand.node, "native-body", "actual-native-owner"), role: "native-body", specialization: owner.specialization,
    declaration: operand.context.declaration,
    bindings: operand.context.bindings, returnDestination: operand.context.returnDestination, error: operand.context.error,
    source: owner.source,
    demands: [Object.freeze({ kind: "value", subject: operand.node, owner: operand.context.declaration,
      bindings: operand.context.bindings, context: operand.use })], sourceCarriers: [], physicalCarriers: [] }]);
  assert.equal(result.kind, "rejected");
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED" &&
    diagnostic.sourceNode === operand.node && diagnostic.message === "missing native producer proof"), true,
  "the source occurrence and owning refusal survive unchanged; no internal or missing-key fallback");
  assert.equal(Object.hasOwn(result, "value"), false, "no incomplete context product is published");
}

function verifyInlineSelectingOwners(observations) {
  const inline = demand => demand.kind === "type" && demand.context.role === "inline-body";
  const original = observations.preparations.find(preparation => preparation.requests.filter(request =>
    request.role === "constructor-layer" && request.demands.some(inline)).length >= 2);
  assert.equal(original !== undefined, true, "the actual pipeline supplies two distinct class-field selecting owners");
  const layers = original.requests.filter(request => request.role === "constructor-layer" && request.demands.some(inline));
  const owner = layers[0];
  const demand = owner.demands.find(inline);
  assert.equal(demand.owner === owner.source.layer.definition.declaration && demand.owner !== owner.declaration, true,
    "the actual field initializer retains class ownership within its explicit constructor layer");
  const copied = { ...demand };
  const copiedResult = prepareRustEmissionContextRequests(original.input, original.requests.map(request => request !== owner ? request
    : { ...owner, demands: owner.demands.map(current => current === demand ? copied : current) }));
  assert.equal(copiedResult.kind, "rejected", "a copied selecting row is not an admitted original occurrence");
  assert.equal(copiedResult.diagnostics.some(issue => issue.sourceNode === demand.subject && issue.message ===
    "An inline body requires its exact original selecting creation owner and occurrence."), true,
  "the exact original source occurrence owns a copied-row rejection");
  const foreign = layers[1].demands.find(inline);
  assert.equal(original.input.emissionRequests.includes(foreign), true, "the other class field row is itself genuinely admitted");
  const foreignResult = prepareRustEmissionContextRequests(original.input, original.requests.map(request => request !== owner ? request
    : { ...owner, demands: [...owner.demands, foreign] }));
  assert.equal(foreignResult.kind, "rejected", "one valid class field cannot be reassigned to a different selected constructor layer");
  assert.equal(foreignResult.diagnostics.some(issue => issue.sourceNode === foreign.subject && issue.message ===
    "An inline body requires its exact original selecting creation owner and occurrence."), true,
  "equal native callback carriers never substitute for original layer ownership");
}

test("a required missing physical operand refuses at the preparation owner before publication", () => {
  const arithmetic = actual("export function value(input: number): number { return input + 1; }", []);
  assert.equal(arithmetic.physicalEmissionContexts.contexts.some(context => context.use.role === "native-body"), true,
    "ordinary arithmetic retains its real body context without artificial callable-storage reads");
  const preparationUrl = new URL("../../../dist/analysis/callables/emission-contexts.js", import.meta.url).href;
  const programPreparationUrl = new URL("../../../dist/analysis/program/physical-emission-contexts.js", import.meta.url).href;
  const helperUrl = new URL("../../helpers/rust-session.mjs", import.meta.url).href;
  const key = "r14-actual-missing-operand-preparation";
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
const observations = { preparations: [], anchors: 0 };
globalThis[Symbol.for(${JSON.stringify(key)})] = observations;
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url !== ${JSON.stringify(preparationUrl)}) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  const anchor = "export function prepareRustEmissionContextRequests(";
  assert.equal(source.split(anchor).length, 2, "one actual request preparation observation anchor");
  observations.anchors++;
  const extension = 'export function prepareRustEmissionContextRequests(input, requests) { const result = observedPrepareRustEmissionContextRequests(input, requests); globalThis[Symbol.for(${JSON.stringify(key)})].preparations.push({input, requests}); return result; }';
  return { ...loaded, source: source.replace(anchor, "function observedPrepareRustEmissionContextRequests(") + "\\n" + extension };
} });
const { analyzeRust } = await import(${JSON.stringify(helperUrl)});
const { prepareRustEmissionContextRequests } = await import(${JSON.stringify(preparationUrl)});
const { prepareRustPhysicalEmissionContexts } = await import(${JSON.stringify(programPreparationUrl)});
const { program } = analyzeRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } }, files: {
  "index.ts": 'export function contains(input: string): boolean { return input.includes("value"); }' +
    'class FieldOwner { values = [1, 2].map(value => value + 1); constructor() {} }' +
    'class OtherFieldOwner { values = [2, 3].map(value => value + 1); constructor() {} }' +
    'export function readFields(): number { return new FieldOwner().values[0]! + new OtherFieldOwner().values[0]!; }',
} });
(${verifyRequiredMissingOperand.toString()})(program, observations);
(${verifyInlineSelectingOwners.toString()})(observations);
assert.equal(observations.anchors, 1, "one real observation without a production observer or invented late inputs");
process.stdout.write("R14_INSTRUMENTED_MISSING_OPERAND_PROOF");
`;
  const observed = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.equal(observed.status, 0, `instrumented missing operand proof: ${observed.error?.message ?? ""}\n${observed.stderr.slice(-4096)}\n${observed.stdout.slice(-2048)}`);
  assert.equal(observed.stdout, "R14_INSTRUMENTED_MISSING_OPERAND_PROOF", "explicit instrumented missing operand proof label");
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
  assert.equal(observations.calls, 1, "the actual selecting owner ran exactly once");
  assert.equal(observations.requests.kind, "resolved", "the actual checked source use inventory was admitted");
  assert.equal(observations.preparationInput !== undefined, true, "the full original late preparation inputs were observed");
  assert.equal(observations.preparationInput.emissionRequests === observations.requests.value, true,
    "the existing complete selecting-owner request vector remains identical");
  const result = prepareRustPhysicalEmissionContexts({ ...observations.preparationInput, initialization: selected.value });
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
  if (url === ${JSON.stringify(preparationUrl)}) {
    const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    const anchor = "export function prepareRustPhysicalEmissionContexts(";
    assert.equal(source.split(anchor).length, 2, "one original late preparation input observation anchor");
    observations.preparationAnchors = (observations.preparationAnchors ?? 0) + 1;
    const extension = 'export function prepareRustPhysicalEmissionContexts(input) { globalThis[Symbol.for(${JSON.stringify(key)})].preparationInput = input; return observedPrepareRustPhysicalEmissionContexts(input); }';
    return { ...loaded, source: source.replace(anchor, "function observedPrepareRustPhysicalEmissionContexts(") + "\\n" + extension };
  }
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
assert.equal(observations.preparationAnchors, 1, "one original preparation input observation without a fake source-storage port");
process.stdout.write("R14_INSTRUMENTED_WORKER_CONTEXT_PROOF");
`;
  const observed = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.equal(observed.status, 0, `instrumented actual worker proof: ${observed.error?.message ?? ""}\n${observed.stderr.slice(-4096)}\n${observed.stdout.slice(-2048)}`);
  assert.equal(observed.stdout, "R14_INSTRUMENTED_WORKER_CONTEXT_PROOF", "explicit instrumented worker proof label");
});

function verifyEmissionSourceFileBoundaries(input, prepare, genuine, observations) {
  assert.equal(genuine.kind, "resolved", "the genuine checked source request vector is admitted");
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  input.sourceFiles.forEach(visit);
  const call = nodes.find(node => input.records.targetOperation.get(node)?.kind === "source-call");
  const declaration = nodes.find(node => input.projectTypes.definitionForDeclaration(node) !== undefined);
  assert.equal(call !== undefined && declaration !== undefined, true, "actual source has both boundary consumers");
  const fields = input.ast.members(declaration).filter(member => member !== undefined && sourceClassFieldHasStorage(input.ast, member));
  const staticField = fields.find(member => input.ast.hasModifierKind(member, "static"));
  const instanceField = fields.find(member => !input.ast.hasModifierKind(member, "static"));
  assert.equal(staticField !== undefined && instanceField !== undefined, true, "both actual field ownership modes participate");
  const file = input.ast.getSourceFile(call);
  const foreign = input.sourceFiles.find(sourceFile => sourceFile !== file);
  assert.equal(file !== undefined && foreign !== undefined, true, "two genuine checked source files provide distinct identity controls");
  assert.equal(genuine.value.some(request => request.subject === staticField && request.owner === file && request.kind === "type"), true,
    "a static field retains its original checked module owner");
  assert.equal(genuine.value.some(request => request.subject === instanceField && request.owner === declaration && request.kind === "type"), true,
    "an instance field retains its original class owner");
  const sourceFiles = input.sourceFiles.filter(sourceFile => sourceFile !== foreign);
  const domain = new Set(sourceFiles);
  for (const [name, subject] of [["call", call], ["static-field", staticField]]) {
    for (const mode of ["missing", "foreign"]) {
      const ast = Object.freeze(Object.create(Object.getPrototypeOf(input.ast), {
        ...Object.getOwnPropertyDescriptors(input.ast),
        getSourceFile: { value(node) {
          return node === subject ? mode === "missing" ? undefined : foreign : input.ast.getSourceFile(node);
        } },
      }));
      const carrierHost = Object.freeze({ ...input.carrierHost, semantics(sourceFile) {
        assert.equal(sourceFile !== undefined && domain.has(sourceFile), true,
          name + "/" + mode + ": invalid files never reach source semantics");
        return input.carrierHost.semantics(sourceFile);
      } });
      const result = prepare({ ...input, ast, sourceFiles, carrierHost });
      assert.equal(result.kind, "rejected", name + "/" + mode + ": missing ownership evidence rejects the whole stage");
      assert.equal(result.diagnostics.length, 1, name + "/" + mode + ": one precise owning boundary failure");
      assert.equal(result.diagnostics.some(issue => issue.code === "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED" &&
        issue.sourceNode === subject && issue.message ===
          "An emitted source occurrence requires its exact checked owning SourceFile in the current source-file domain."), true,
      name + "/" + mode + ": original source identity and required diagnostic survive unchanged");
      assert.equal(Object.hasOwn(result, "value"), false, name + "/" + mode + ": no empty or partial success fallback");
      observations.cases++;
    }
  }
}

test("source call and static field requests require genuine owning files without losing instance ownership (instrumented boundary controls)", () => {
  const options = { surfaces: [], target: { id: "rust", options: { outputType: "lib" } }, files: {
    "index.ts": `import { seed } from "./worker.js";
class Item { static current: number = 1; instance: number = 2; }
export function value(input: number): number { return seed(input) + Item.current; }`,
    "worker.ts": `export function seed(value: number): number { return value; }`,
  } };
  const ordinary = compileRust(options);
  assert.equal(ordinary.result.diagnostics.length, 0, ordinary.result.diagnostics.map(issue => issue.message).join("\n").slice(0, 2048));
  assert.equal(ordinary.result.artifacts.length > 0, true, "uninjected genuine boundary source emits normally");
  const collectorUrl = new URL("../../../dist/analysis/callables/emission-requests.js", import.meta.url).href;
  const helperUrl = new URL("../../helpers/rust-session.mjs", import.meta.url).href;
  const key = "r14-checked-source-file-boundary-proof";
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { sourceClassFieldHasStorage } from "@tsonic/target-api/source";
const observations = { calls: 0, anchors: 0, cases: 0 };
globalThis[Symbol.for(${JSON.stringify(key)})] = observations;
observations.verify = (input, prepare, genuine) => (${verifyEmissionSourceFileBoundaries.toString()})(input, prepare, genuine, observations);
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url !== ${JSON.stringify(collectorUrl)}) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  const anchor = "export function prepareRustPhysicalCallableEmissionRequests(";
  assert.equal(source.split(anchor).length, 2, "one exact source-request boundary observation anchor");
  observations.anchors++;
  const extension = 'export function prepareRustPhysicalCallableEmissionRequests(...inputs) { const result = observedPrepareRustPhysicalCallableEmissionRequests(...inputs); const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.calls++; observations.verify(inputs[0], observedPrepareRustPhysicalCallableEmissionRequests, result); return result; }';
  return { ...loaded, source: source.replace(anchor, "function observedPrepareRustPhysicalCallableEmissionRequests(") + "\\n" + extension };
} });
const { compileRust } = await import(${JSON.stringify(helperUrl)});
const compiled = compileRust(${JSON.stringify(options)});
assert.equal(compiled.result.diagnostics.length, 0, compiled.result.diagnostics.map(issue => issue.message).join("\\n").slice(0, 2048));
assert.equal(observations.anchors, 1, "one real pipeline owner observed without dist writes");
assert.equal(observations.calls, 1, "one genuine pipeline publication, separate from the four counterfactual boundary cases");
assert.equal(observations.cases, 4, "both consumers reject both missing and genuine foreign-domain files");
process.stdout.write("R14_INSTRUMENTED_SOURCE_BOUNDARY_PROOF " + JSON.stringify(compiled.result.artifacts));
`;
  const observed = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.equal(observed.status, 0, `instrumented actual boundary proof: ${observed.error?.message ?? ""}\n${observed.stderr.slice(-4096)}\n${observed.stdout.slice(-2048)}`);
  const marker = "R14_INSTRUMENTED_SOURCE_BOUNDARY_PROOF ";
  assert.equal(observed.stdout.startsWith(marker), true, "explicit boundary proof label");
  assert.equal(JSON.stringify(JSON.parse(observed.stdout.slice(marker.length))) === JSON.stringify(ordinary.result.artifacts), true,
    "boundary controls leave the genuine original pipeline and generated artifacts unchanged");
});
