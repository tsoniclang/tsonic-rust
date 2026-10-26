import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustInitializationErrors } from "../../../dist/analysis/errors/initialization.js";
import { resolvedTargetStage } from "@tsonic/target-api/artifacts";
import { rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";

const owner = Object.freeze({ kind: "physical", domain: "runtime" });
const failure = Object.freeze({ kind: "source-primitive", name: "int64" });

function fixture() {
  const root = Object.freeze({ fileName: "/src/index.ts" });
  const dependency = Object.freeze({ fileName: "/src/dependency.ts" });
  const worker = Object.freeze({ fileName: "/src/worker.ts" });
  const files = [root, dependency, worker];
  const effects = new Map(files.map(file => [file, Object.freeze({ kind: "infallible",
    fileName: file.fileName, localOwner: undefined, sources: Object.freeze([]) })]));
  const dependencies = new Map([[root, [dependency]], [dependency, []], [worker, [dependency]]]);
  const component = Object.freeze({ componentId: "root", root: true, errorDomain: "runtime",
    sourceFileNames: files.map(file => file.fileName) });
  const required = new Set(files);
  const input = {
    ast: { getFileName: file => file.fileName, getSourceFile: file => file },
    sourceFiles: files,
    navigation: { moduleDependencies: file => (dependencies.get(file) ?? []).map(sourceFile => ({ sourceFile })),
      moduleHasTopLevelAwait: file => file === dependency },
    moduleInitialization: { requirementFor: file => ({ kind: required.has(file) ? "required" : "not-required" }),
      moduleCycles: Object.freeze([]) },
    sourceModules: { targets: () => [worker] },
    components: { rootComponentId: "root", components: [component], forComponent: () => component,
      componentForFile: () => component },
    facades: { rootExports: [] },
    regions: { get: file => effects.get(file) },
    nativeTasks: false,
    lifecycleFor: (_root, selectedOwner) => resolvedTargetStage(Object.freeze({ carrier: rustProgramErrorTargetType(selectedOwner),
      region: Object.freeze({ kind: "package", fileName: root.fileName, localOwner: selectedOwner, sources: Object.freeze([]) }) })),
    binaryHooks: [], outputType: "bin", projectRoot: "/src", entryPoint: "index.ts",
  };
  const native = file => effects.set(file, Object.freeze({ kind: "native", fileName: file.fileName,
    localOwner: undefined, sources: Object.freeze([{ identity: file.fileName, variant: "Error0", errorType: failure }]) }));
  const local = file => effects.set(file, Object.freeze({ kind: "package", fileName: file.fileName,
    localOwner: owner, sources: Object.freeze([]) }));
  return { input, root, dependency, worker, effects, dependencies, required, native, local };
}

test("initializer analysis seals dependency order, asynchronous execution and exact source identity", () => {
  const current = fixture();
  const result = analyzeRustInitializationErrors(current.input);
  assert.equal(result.kind, "resolved");
  const records = result.value;
  assert.equal(records.entrySourceFile === current.root, true, "the authored entry module is sealed once by exact source identity");
  assert.deepEqual(records.root.modules.map(module => module.identity), [current.dependency.fileName, current.root.fileName]);
  assert.equal(records.root.modules[1].sourceFile === records.entrySourceFile, true, "startup retains the selected entry object");
  assert.equal(records.root.asynchronous, true);
  assert.equal(records.root.error.kind, "infallible");
  assert.equal(records.workerFor(current.worker) === records.workers[0].initializer, true);
  assert.equal(records.workerFor({ ...current.worker }) === undefined, true, "an equal-looking AST is not the source owner");
  assert.equal(records.moduleFor(current.root).region === current.effects.get(current.root), true);
  assert.equal(Object.isFrozen(records) && Object.isFrozen(records.root) &&
    Object.isFrozen(records.root.modules) && Object.isFrozen(records.binary.sources), true);
  assert.deepEqual(records.binary.sources.map(source => source.kind), ["lifecycle"]);
});

test("native initializer composition retains independent local, module and worker payload channels", () => {
  const current = fixture();
  current.local(current.root);
  current.native(current.dependency);
  current.native(current.worker);
  const result = analyzeRustInitializationErrors(current.input);
  assert.equal(result.kind, "resolved");
  assert.equal(result.value.root.error.kind, "native");
  assert.deepEqual(result.value.root.error.sources.map(source => source.kind), ["package", "module"]);
  assert.equal(result.value.root.error.sources[1].sourceFile === current.dependency, true);
  assert.equal(result.value.root.modules[0].region.sources[0].errorType === failure, true, "native int64 payload is not erased or converted");
  assert.deepEqual(result.value.binary.sources.map(source => source.kind), ["lifecycle", "initialization", "worker"]);
  assert.equal(result.value.binary.sources[2].sourceFile === current.worker, true);
  assert.equal(result.value.binary.sources[2].identity, current.worker.fileName);
});

test("an initialization-only native executable excludes an unused lifecycle channel before rendering", () => {
  const current = fixture();
  current.native(current.root);
  current.input.sourceModules.targets = () => [];
  const result = analyzeRustInitializationErrors(current.input);
  assert.equal(result.kind, "resolved");
  assert.deepEqual(result.value.binary.sources.map(source => source.kind), ["initialization"]);
  current.input.binaryHooks = [{ isFallible: true }];
  const withHook = analyzeRustInitializationErrors(current.input);
  assert.equal(withHook.kind, "resolved");
  assert.deepEqual(withHook.value.binary.sources.map(source => source.kind), ["lifecycle", "initialization"]);
});

test("module cycles and missing finalized regions reject during analysis rather than native planning", () => {
  const current = fixture();
  current.dependencies.set(current.dependency, [current.root]);
  const issue = Object.freeze({ code: "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE",
    category: "error", source: "tsonic-rust", sourceNode: current.root,
    message: "The original source module component has state-dependent runtime initialization.", evidence: Object.freeze([]) });
  current.input.moduleInitialization.moduleCycles = Object.freeze([Object.freeze({
    sourceFiles: Object.freeze([current.root, current.dependency]), issue })]);
  const cyclic = analyzeRustInitializationErrors(current.input);
  assert.equal(cyclic.kind, "rejected");
  assert.equal(cyclic.diagnostics.some(diagnostic => diagnostic.code === "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE"), true);
  assert.equal(cyclic.diagnostics[0] === issue, true, "physical composition consumes the exact early cycle outcome");
  current.input.moduleInitialization.moduleCycles = Object.freeze([]);
  assert.equal(analyzeRustInitializationErrors(current.input).kind, "resolved");
  current.effects.delete(current.root);
  const missing = analyzeRustInitializationErrors(current.input);
  assert.equal(missing.kind, "rejected");
  assert.equal(missing.diagnostics[0].code, "RUST_SOURCE_PACKAGE_INITIALIZER_FACT_MISSING");
});

test("library initialization roots follow checked public exports, with entry fallback only for required root initialization", () => {
  const current = fixture();
  current.input.outputType = "lib";
  current.input.facades.rootExports = [{ sourceModuleFileName: current.dependency.fileName }];
  const exported = analyzeRustInitializationErrors(current.input);
  assert.equal(exported.kind, "resolved");
  assert.deepEqual(exported.value.root.modules.map(module => module.identity), [current.dependency.fileName]);
  current.input.facades.rootExports = [];
  const fallback = analyzeRustInitializationErrors(current.input);
  assert.equal(fallback.kind, "resolved");
  assert.deepEqual(fallback.value.root.modules.map(module => module.identity), [current.dependency.fileName, current.root.fileName]);
  current.required.clear();
  const empty = analyzeRustInitializationErrors(current.input);
  assert.equal(empty.kind, "resolved");
  assert.equal(empty.value.root.modules.length, 0);
});

test("cycle admission follows actual executable, facade and worker roots and exact runtime presence", () => {
  const current = fixture();
  const left = Object.freeze({ fileName: "/src/unused-left.ts" });
  const right = Object.freeze({ fileName: "/src/unused-right.ts" });
  current.input.sourceFiles.push(left, right);
  current.dependencies.set(left, [right]);
  current.dependencies.set(right, [left]);
  for (const file of [left, right]) {
    current.required.add(file);
    current.effects.set(file, Object.freeze({ kind: "infallible", fileName: file.fileName,
      localOwner: undefined, sources: Object.freeze([]) }));
  }
  const issue = Object.freeze({ code: "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE", category: "error", source: "tsonic-rust",
    sourceNode: left, message: "The exact source component has state-dependent initialization.", evidence: Object.freeze([]) });
  current.input.moduleInitialization.moduleCycles = Object.freeze([Object.freeze({ sourceFiles: Object.freeze([left, right]), issue })]);
  assert.equal(analyzeRustInitializationErrors(current.input).kind, "resolved",
    "unreachable source components do not broaden executable rejection");
  current.input.outputType = "lib";
  current.input.facades.rootExports = [{ sourceModuleFileName: left.fileName }];
  const facade = analyzeRustInitializationErrors(current.input);
  assert.equal(facade.kind, "rejected", "an actual public facade initializes its exact dependency component");
  assert.equal(facade.diagnostics[0] === issue, true, "facade composition reads the source owner's exact decision");
  current.input.facades.rootExports = [{ sourceModuleFileName: current.dependency.fileName }];
  assert.equal(analyzeRustInitializationErrors(current.input).kind, "resolved", "an unrelated facade does not initialize the unused cycle");
  current.input.outputType = "bin";
  current.input.sourceModules.targets = () => [left];
  const worker = analyzeRustInitializationErrors(current.input);
  assert.equal(worker.kind, "rejected", "an admitted worker retains its original initialization scope");
  assert.equal(worker.diagnostics[0] === issue, true, "worker composition consumes the same source decision");
  current.required.delete(left);
  current.required.delete(right);
  assert.equal(analyzeRustInitializationErrors(current.input).kind, "resolved",
    "erased, ambient, type-only or native-item-only components have no physical runtime initializer to reject");
});
