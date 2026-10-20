import { resolve } from "node:path";
import type { AstReader, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustBinaryHookPlan } from "../project/index.js";
import type { RustModuleInitializationPlan } from "../../target-model/records/module-initialization.js";
import type { RustSourceModuleConstructionIndex } from "../../target-model/records/source-modules.js";
import type { RustSourcePackageFacadeClassifications } from "../../target-model/records/source-package-semantics.js";
import type { RustSourcePackageComponentClassifications } from "../../target-model/records/source-package-semantics.js";
import { stronglyConnectedSourceFiles } from "../program/module-graph.js";
import { selectRustPhysicalProgramErrorOwner } from "./error-types.js";
import type { RustAnalyzedErrorRegions } from "./regions.js";
import type { RustBinaryErrorSelection, RustInitializationErrorRecords, RustInitializerErrorSelection,
  RustInitializerSelection, RustModuleErrorInitializer, RustPhysicalErrorOwner } from "../../target-model/records/error-regions.js";

export function analyzeRustInitializationErrors(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly navigation: Pick<SourceProgramNavigation, "moduleDependencies" | "moduleHasTopLevelAwait">;
  readonly moduleInitialization: RustModuleInitializationPlan;
  readonly sourceModules: RustSourceModuleConstructionIndex;
  readonly components: RustSourcePackageComponentClassifications;
  readonly facades: RustSourcePackageFacadeClassifications;
  readonly regions: RustAnalyzedErrorRegions;
  readonly binaryHooks: readonly RustBinaryHookPlan[];
  readonly outputType: "bin" | "lib";
  readonly projectRoot: string;
  readonly entryPoint: string;
}): TargetStageResult<RustInitializationErrorRecords> {
  const diagnostics: TargetDiagnostic[] = [];
  const reject = (code: string, message: string, sourceNode?: SourceFile): void => {
    diagnostics.push({ code, category: "error", source: "tsonic-rust", message,
      ...(sourceNode === undefined ? {} : { sourceNode }),
      evidence: ["target.capability=rust.analysis.initialization-errors"] });
  };
  const byFileName = new Map(input.sourceFiles.map(file => [normalizePath(input.ast.getFileName(file)), file] as const));
  const modules = new Map<SourceFile, RustModuleErrorInitializer>();
  for (const file of input.sourceFiles) {
    const requirement = input.moduleInitialization.requirementFor(file);
    if (requirement.kind === "unresolved") {
      reject("RUST_SOURCE_PACKAGE_INITIALIZER_FACT_MISSING", requirement.reason, file);
      continue;
    }
    if (requirement.kind === "not-required") continue;
    const region = input.regions.get(file);
    if (region === undefined) {
      reject("RUST_SOURCE_PACKAGE_INITIALIZER_FACT_MISSING", "A required module initializer has no completed exact error region.", file);
      continue;
    }
    modules.set(file, Object.freeze({ sourceFile: file, identity: input.ast.getFileName(file), region,
      asynchronous: input.navigation.moduleHasTopLevelAwait(file) }));
  }
  let entrySourceFile: SourceFile | undefined;
  const entry = (): SourceFile | undefined => {
    const path = normalizePath(resolve(input.projectRoot, input.entryPoint));
    const file = byFileName.get(path);
    entrySourceFile = file;
    if (file === undefined) reject("RUST_PROJECT_ENTRY_SOURCE_MISSING", `Entry source module '${path}' is absent from the checked program.`);
    return file;
  };
  const componentOwner = (componentId: string): RustPhysicalErrorOwner | undefined => {
    const component = input.components.forComponent(componentId);
    const fileName = component?.sourceFileNames[0];
    const file = fileName === undefined ? undefined : byFileName.get(normalizePath(fileName));
    const selected = file === undefined ? undefined : selectRustPhysicalProgramErrorOwner(file, input);
    if (selected === undefined) reject("RUST_SOURCE_PACKAGE_INITIALIZER_ERROR_BOUNDARY_MISSING",
      `Initializer component '${componentId}' has no exact physical error owner.`, file);
    return selected;
  };
  const compose = (roots: readonly SourceFile[], owner: RustPhysicalErrorOwner): RustInitializerSelection => {
    const visited = new Set<SourceFile>();
    const active = new Set<SourceFile>();
    const ordered: RustModuleErrorInitializer[] = [];
    const visit = (file: SourceFile): void => {
      if (visited.has(file) || active.has(file)) return;
      active.add(file);
      for (const dependency of input.navigation.moduleDependencies(file)) visit(dependency.sourceFile);
      active.delete(file);
      visited.add(file);
      const selected = modules.get(file);
      if (selected !== undefined) ordered.push(selected);
    };
    roots.forEach(visit);
    const components = stronglyConnectedSourceFiles(input.navigation, visited);
    if (components.kind === "unresolved") reject("RUST_SOURCE_MODULE_GRAPH_NOT_PROVEN", components.reason);
    for (const component of components.kind === "resolved" ? components.components : []) {
      const first = component[0];
      const cyclic = component.length > 1 || first !== undefined && input.navigation.moduleDependencies(first)
        .some(dependency => dependency.sourceFile === first);
      const initialized = component.filter(file => modules.has(file));
      if (!cyclic || initialized.length === 0 || component.every(file => input.moduleInitialization.hasStateIndependentCycle(file))) continue;
      const names = component.map(file => input.ast.getFileName(file)).sort(compareNames);
      reject("RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE",
        `Runtime ES module dependency component '${names.join(" -> ")}' contains ${initialized.length} module initializer${initialized.length === 1 ? "" : "s"} and cannot be executed without finalized cyclic call, live-binding, and temporal-dead-zone evidence.`, first);
    }
    const local = ordered.some(module => module.region.kind === "package");
    const native = ordered.filter(module => module.region.kind === "native");
    const error: RustInitializerErrorSelection = native.length > 0
      ? Object.freeze({ kind: "native", owner, sources: Object.freeze([
        ...(local ? [Object.freeze({ kind: "package" as const, identity: "local", variant: "Local" })] : []),
        ...native.map((module, index) => Object.freeze({ kind: "module" as const, identity: module.identity,
          variant: `Module${index}`, sourceFile: module.sourceFile })),
      ]) })
      : local ? Object.freeze({ kind: "package", owner }) : Object.freeze({ kind: "infallible" });
    return Object.freeze({ modules: Object.freeze(ordered), asynchronous: ordered.some(module => module.asynchronous), error });
  };
  const rootOwner = componentOwner(input.components.rootComponentId);
  if (rootOwner === undefined || diagnostics.length > 0) return rejectedTargetStage(diagnostics);
  const roots = new Map<string, SourceFile>();
  if (input.outputType === "bin") {
    const file = entry();
    if (file !== undefined) roots.set(input.ast.getFileName(file), file);
  } else {
    for (const exported of input.facades.rootExports) {
      const name = normalizePath(exported.sourceModuleFileName);
      const file = byFileName.get(name);
      if (file === undefined) reject("RUST_SOURCE_PACKAGE_INITIALIZATION_ROOT_MISSING",
        `Public source-package module '${exported.sourceModuleFileName}' has no checked initialization root.`);
      else roots.set(name, file);
    }
    if (roots.size === 0 && [...modules.values()].some(module => input.components.componentForFile(module.identity)?.root)) {
      const file = entry();
      if (file !== undefined) roots.set(input.ast.getFileName(file), file);
    }
  }
  const root = compose([...roots].sort(([left], [right]) => compareNames(left, right)).map(([, file]) => file), rootOwner);
  const workers: { readonly sourceFile: SourceFile; readonly initializer: RustInitializerSelection }[] = [];
  const workerByFile = new Map<SourceFile, RustInitializerSelection>();
  for (const sourceFile of [...input.sourceModules.targets()].sort((left, right) =>
    compareNames(input.ast.getFileName(left), input.ast.getFileName(right)))) {
    const component = input.components.componentForFile(input.ast.getFileName(sourceFile));
    const owner = component === undefined ? undefined : componentOwner(component.componentId);
    if (owner === undefined) {
      reject("RUST_WORKER_ENTRY_ERROR_DOMAIN_MISSING", "A worker initializer has no exact source-package error owner.", sourceFile);
      continue;
    }
    const initializer = compose([sourceFile], owner);
    workerByFile.set(sourceFile, initializer);
    workers.push(Object.freeze({ sourceFile, initializer }));
  }
  const sources: RustBinaryErrorSelection["sources"][number][] = [];
  if (root.error.kind !== "native" || input.binaryHooks.some(hook => hook.isFallible === true) || workers.length > 0)
    sources.push(Object.freeze({ kind: "lifecycle", identity: "lifecycle", variant: "Lifecycle" }));
  if (root.error.kind === "native") sources.push(Object.freeze({ kind: "initialization", identity: "initialization", variant: "Initialization" }));
  const nativeWorkers = workers.filter(worker => worker.initializer.error.kind === "native");
  for (const [index, worker] of nativeWorkers.entries()) sources.push(Object.freeze({ kind: "worker",
    identity: input.ast.getFileName(worker.sourceFile), variant: `Worker${index}`, sourceFile: worker.sourceFile }));
  return diagnostics.length > 0 ? rejectedTargetStage(diagnostics) : resolvedTargetStage(Object.freeze({ root, entrySourceFile,
    workers: Object.freeze(workers), binary: Object.freeze({ sources: Object.freeze(sources) }),
    moduleFor: (sourceFile: SourceFile) => modules.get(sourceFile),
    workerFor: (sourceFile: SourceFile) => workerByFile.get(sourceFile),
  }));
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, "en");
}
