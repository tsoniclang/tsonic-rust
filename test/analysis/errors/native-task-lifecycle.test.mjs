import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorRegions, completeRustErrorRegionRecords } from "../../../dist/analysis/errors/regions.js";
import { analyzeRustInitializationErrors } from "../../../dist/analysis/errors/initialization.js";
import { rustFutureTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustNativeErrorJoinReference } from "../../../dist/target-model/types/native-error-joins.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

const owner = Object.freeze({ kind: "physical", domain: "runtime" });
const error = rustSourcePrimitiveTargetType("int64");
const output = rustSourcePrimitiveTargetType("int32");

function fixture({ effects, spawnedError } = {}) {
  const body = fakeStatement({ kindName: "KindArrowFunction" });
  const spawn = fakeStatement({ kindName: "KindVoidExpression" });
  const file = fakeSourceFile({ fileName: "/src/index.ts", statements: [body, spawn] });
  const base = fakeAstReader([file]);
  const ast = { ...base, forEachChild: (node, visit) => { if (node === file) file.statements.forEach(visit); } };
  const component = Object.freeze({ componentId: "root", root: true, errorDomain: "runtime" });
  const empty = Object.freeze({ get: () => undefined });
  const task = spawnedError === undefined ? [] : [{ node: spawn, operand: body, owner: file,
    selection: { kind: "leaf", value: { carrier: rustFutureTargetType(output), completion: { kind: "discard" },
      future: { outputCarrier: output, awaiting: "fallible", errorBoundary: "provider-native", errorCarrier: spawnedError,
        awaitedConversion: { kind: "identity", sourceCarrier: output, targetCarrier: output, fallible: false } } } } }];
  const result = analyzeRustErrorRegions({ ast, sourceFiles: [file], isNativeNode: () => true,
    nativeTasks: task, binaryHooks: [], promiseBodies: { objects: new Map() },
    records: { errorEffects: { get: node => node === body ? effects : undefined }, asyncFunction: empty,
      sourceCallableReturn: empty, sourceErrorEffects: empty, awaitSourceErrorEffects: empty,
      contextualValueConversion: empty, projectCallableAdapters: empty, targetOperation: empty },
    names: { nameForDeclaration: () => undefined, functionNameForDeclaration: () => undefined, callableValueNameForDeclaration: () => undefined },
    callables: { native: { inputs: [] }, nativeGenericProducers: { errorAritiesFor: () => [] },
      frames: { definitions: Object.freeze([]) } }, producers: { producers: [] },
    definitions: emptyRustTypeDefinitions,
    components: { rootComponentId: "root", componentForFile: () => component, forComponent: () => component },
  });
  assert.equal(result.kind, "resolved", "the existing region owner admits the exact input effects");
  const root = Object.freeze({ modules: Object.freeze([]), asynchronous: false, error: Object.freeze({ kind: "infallible" }) });
  const initialization = lifecycle => Object.freeze({ entrySourceFile: file, root, workers: Object.freeze([]),
    binary: Object.freeze({ lifecycle, sources: Object.freeze([]) }), moduleFor: () => undefined, workerFor: () => undefined });
  return { regions: result.value, file, body, spawn, root, initialization };
}

test("a runtime intrinsic join publishes its exact injection arm rather than a renderer convention", () => {
  const current = fixture({ effects: { localErrors: true, nativeErrors: [{ identity: "native", errorType: error }] } });
  const selected = current.regions.lifecycleFor([current.root], owner);
  assert.equal(selected.kind, "resolved", "the original no-task lifecycle choice is available");
  const records = completeRustErrorRegionRecords(current.regions, current.initialization(selected.value));
  const declaration = records.declarationsFor(current.file.fileName).find(value => value.arity === 2);
  assert.equal(declaration?.runtimeErrorArm, 0, "the analysis owner proves the actual local-first runtime injection");
  assert.equal(records.lifecycle === undefined, true, "a program with no tasks gets no native task scope or task lifecycle channel");
});

test("a native-only join publishes no runtime injection permission", () => {
  const current = fixture({ effects: { localErrors: false, nativeErrors: [{ identity: "first", errorType: error },
    { identity: "second", errorType: rustSourcePrimitiveTargetType("bool") }] } });
  const selected = current.regions.lifecycleFor([current.root], owner);
  assert.equal(selected.kind, "resolved", "the no-task choice does not create runtime error effects");
  const records = completeRustErrorRegionRecords(current.regions, current.initialization(selected.value));
  const declaration = records.declarationsFor(current.file.fileName).find(value => value.arity === 2);
  assert.equal(declaration !== undefined, true, "the actual native join is still emitted");
  assert.equal(declaration.runtimeErrorArm === undefined, true, "native payloads alone do not authorize From<TsonicError>");
});

test("a provider task retains its exact native error and needs no fabricated source declaration edge", () => {
  const current = fixture({ spawnedError: error });
  const selected = current.regions.lifecycleFor([current.root], owner);
  assert.equal(selected.kind, "resolved", "the provider's actual closed error is admitted");
  assert.equal(rustTargetTypeRefEquals(selected.value.carrier, error), true, "a single native error is neither boxed nor widened to TsonicError");
  assert.equal(selected.value.region.localOwner === undefined, true, "provider errors do not become root-package errors");
  const completion = current.regions.taskCompletionFor(current.spawn);
  assert.equal(completion?.value.future.errorBoundary, "source-native", "the existing exact native transport is selected once");
  assert.equal(rustTargetTypeRefEquals(completion.value.future.errorCarrier, error), true, "the original payload carrier is unchanged");
  assert.equal(completion.value.future.errorSource, selected.value.region.sources[0].identity, "transport and lifecycle use the same selected source identity");
});

test("initializer payloads enter the lifecycle before one final error catalog seal", () => {
  const current = fixture({ spawnedError: rustSourcePrimitiveTargetType("bool") });
  const module = Object.freeze({ sourceFile: current.file, identity: current.file.fileName, asynchronous: false,
    region: Object.freeze({ kind: "native", fileName: current.file.fileName, localOwner: undefined,
      sources: Object.freeze([{ identity: "main", variant: "Error0", errorType: error }]) }) });
  const root = Object.freeze({ modules: Object.freeze([module]), asynchronous: false,
    error: Object.freeze({ kind: "native", owner, sources: Object.freeze([
      { kind: "module", identity: module.identity, variant: "Module0", sourceFile: current.file }]) }) });
  const selected = current.regions.lifecycleFor([root], owner);
  assert.equal(selected.kind, "resolved", "main and spawned failures have one selected lifecycle E");
  assert.equal(rustTargetTypeRefEquals(selected.value.region.sources[0].errorType, error), true, "main keeps its actual initializer payload");
  assert.equal(selected.value.region.sources[0].identity, module.identity, "the initializer's real module identity is the transport key");
  assert.equal(rustNativeErrorJoinReference(selected.value.carrier)?.errors.length, 2, "the complete lifecycle includes both main and spawned errors");
  const records = completeRustErrorRegionRecords(current.regions, { ...current.initialization(selected.value), root });
  assert.equal(records.declarationsFor(current.file.fileName).some(value => value.arity === 2), true,
    "the late lifecycle join's arity is emitted from the same catalog, not a second owner");
  assert.throws(() => completeRustErrorRegionRecords(current.regions, current.initialization(selected.value)), /seals once/u,
    "publication cannot reopen or finalize the catalog twice");
});

test("a task cannot consume lifecycle transport before its selecting owner runs", () => {
  const current = fixture({ spawnedError: error });
  const original = current.regions.taskCompletionFor;
  assert.throws(() => original(current.spawn), /after their lifecycle transport/u,
    "a task cannot consume an unselected lifecycle transport before its owner runs");
});

test("distinct worker initializers and spawned payloads enter the one lifecycle without becoming root errors", () => {
  const spawnedError = rustSourcePrimitiveTargetType("bool");
  const workerError = rustSourcePrimitiveTargetType("float32");
  const current = fixture({ spawnedError });
  const worker = fakeSourceFile({ fileName: "/src/worker.ts" });
  const files = [current.file, worker];
  const ast = fakeAstReader(files);
  const component = Object.freeze({ componentId: "root", root: true, errorDomain: "runtime",
    sourceFileNames: Object.freeze(files.map(file => file.fileName)) });
  const moduleRegions = new Map(files.map((file, index) => [file, Object.freeze({ kind: "native", fileName: file.fileName,
    localOwner: undefined, sources: Object.freeze([{ identity: `native-${index}`, variant: "Error0", errorType: index === 0 ? error : workerError }]) })]));
  const selected = analyzeRustInitializationErrors({ ast, sourceFiles: files,
    navigation: { moduleDependencies: () => [], moduleHasTopLevelAwait: () => false },
    moduleInitialization: { requirementFor: () => ({ kind: "required" }), moduleCycles: Object.freeze([]) },
    sourceModules: { targets: () => [worker] },
    components: { rootComponentId: "root", componentForFile: () => component, forComponent: () => component },
    facades: { rootExports: [] }, regions: { get: file => moduleRegions.get(file) },
    lifecycleFor: current.regions.lifecycleFor, nativeTasks: true, binaryHooks: [], outputType: "bin",
    projectRoot: "/src", entryPoint: "index.ts" });
  assert.equal(selected.kind, "resolved", "the real initializer selector closes root and worker sources together");
  const initialization = selected.value;
  assert.equal(initialization.root.modules.length, 1, "a worker is not silently pulled into the root module graph");
  assert.equal(initialization.workers.length, 1, "the exact worker initializer remains separately selected");
  assert.equal(initialization.workers[0].initializer.modules[0].sourceFile === worker, true, "the original worker identity survives");
  const lifecycle = initialization.binary.lifecycle;
  assert.equal(lifecycle.region.localOwner === undefined, true, "native payloads create no root-runtime error arm");
  assert.equal(lifecycle.region.sources.length, 3, "root, worker and spawn retain their three independent channels");
  assert.equal(rustTargetTypeRefEquals(lifecycle.region.sources.find(source => source.identity === current.file.fileName)?.errorType, error), true,
    "root initialization retains its exact carrier and module identity");
  assert.equal(rustTargetTypeRefEquals(lifecycle.region.sources.find(source => source.identity === worker.fileName)?.errorType, workerError), true,
    "worker initialization retains its different exact carrier and module identity");
  const completion = current.regions.taskCompletionFor(current.spawn);
  assert.equal(rustTargetTypeRefEquals(lifecycle.region.sources.find(source => source.identity === completion.value.future.errorSource)?.errorType, spawnedError), true,
    "the spawn transport and lifecycle share the original selected source identity");
  assert.equal(rustNativeErrorJoinReference(lifecycle.carrier)?.errors.length, 3, "one native join contains the complete startup and task errors");
  assert.equal(initialization.binary.sources.length, 1, "startup does not wrap the already-joined worker or root error a second time");
  assert.equal(initialization.binary.sources[0].kind, "lifecycle", "the executable consumes that single existing lifecycle owner");
  const records = completeRustErrorRegionRecords(current.regions, initialization);
  assert.equal(records.declarationsFor(current.file.fileName).some(declaration => declaration.arity === 3 && declaration.runtimeErrorArm === undefined), true,
    "the final catalog emits the exact native arity without inventing a runtime conversion");
});

test("invalid native error payload evidence is refused rather than forced through the root", () => {
  const current = fixture({ spawnedError: false });
  const selected = current.regions.lifecycleFor([current.root], owner);
  assert.equal(selected.kind, "rejected", "corrupt native payload data cannot select a fallback carrier");
  assert.equal(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_ERROR_REGION_UNRESOLVED"), true,
    "the existing error owner reports the actual missing closed payload evidence");
});
