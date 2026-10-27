import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageEmissionProducer } from "../program/records/program/source-packages.js";
import { allocateRustComponentSupportModuleName } from "../../policy/identities/support-modules.js";
import { selectRustStandaloneTypeIdentity } from "../../policy/types/resolution/standalone-emission.js";

export function analyzeRustProgramEmission(program: Omit<RustAnalysisProgram, "reachability">,
  producer: RustSourcePackageEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const components = program.records.sourcePackageComponents.get();
  const initializers = program.records.sourcePackageInitializers.get();
  const workers = program.records.workerEntries.get();
  const root = components?.find(component => component.root);
  if (root === undefined || initializers === undefined || workers === undefined)
    failTargetAnalysisInvariant("tsonic-rust", "An admitted program requires its complete component, initializer and worker contracts.");
  const initializerModule = initializers.facadeModuleNameByComponent.get(root.componentId);
  if (initializerModule === undefined) {
    issues.push(Object.freeze({ code: "RUST_SOURCE_PACKAGE_INITIALIZER_COMPONENT_MISSING", category: "error", source: "tsonic-rust",
      message: "The root source-package component has no exact initializer facade identity.",
      evidence: Object.freeze(["target.capability=rust.backend.source-package-initialization"]) }));
    return Object.freeze(issues);
  }
  for (const hook of program.binaryHooks) if (hook.errorBoundary === "provider-native" &&
    selectRustStandaloneTypeIdentity(hook.errorCarrier, { programError: false }) === undefined)
    issues.push(Object.freeze({ code: "RUST_PROVIDER_EPILOGUE_ERROR_TYPE_MISSING", category: "error", source: "tsonic-rust",
      message: `Binary epilogue '${hook.path}' has no exact renderable provider error type.`,
      evidence: Object.freeze(["target.capability=rust.error.provider-conversion"]) }));
  const byBootstrap = new Map<string, Set<SourceFile>>();
  const targets = new Set(workers.map(worker => worker.sourceFile));
  for (const construction of program.sourceModuleConstructions.entries()) {
    if (!targets.has(construction.targetSourceFile)) {
      issues.push(Object.freeze({ code: "RUST_WORKER_ENTRY_DISPATCH_IDENTITY_MISSING", category: "error", source: "tsonic-rust",
        message: "A selected source-module construction has no exact worker dispatch entry.", sourceNode: construction.expression,
        evidence: Object.freeze(["target.capability=rust.backend.source-module-construction"]) }));
      continue;
    }
    const files = byBootstrap.get(construction.bootstrap.id) ?? new Set<SourceFile>();
    files.add(construction.targetSourceFile);
    byBootstrap.set(construction.bootstrap.id, files);
  }
  const dispatch = [...program.sourceModuleConstructions.bootstraps()].sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap(bootstrap => {
      const selected = byBootstrap.get(bootstrap.id);
      if (selected === undefined || selected.size === 0) return [];
      if (bootstrap.errorBoundary === "provider-native" && (bootstrap.errorCarrier === undefined ||
        selectRustStandaloneTypeIdentity(bootstrap.errorCarrier, { programError: false }) === undefined))
        issues.push(Object.freeze({ code: "RUST_WORKER_BOOTSTRAP_ERROR_TYPE_MISSING", category: "error", source: "tsonic-rust",
          message: `Source-module bootstrap '${bootstrap.id}' has no exact renderable provider error type.`,
          evidence: Object.freeze(["target.capability=rust.backend.source-module-construction"]) }));
      return [Object.freeze({ bootstrap, targets: Object.freeze([...selected]) })];
    });
  if (issues.length === 0) producer.program({ configuration: program.configuration, identities: program.sourceOutputIdentities,
    sourceFiles: program.sourceFiles, runtimeReferences: program.runtimeReferences,
    initialization: Object.freeze({ entrySourceFile: program.errorRegions.initialization.entrySourceFile,
      root: program.errorRegions.initialization.root, binary: program.errorRegions.initialization.binary }),
    hooks: program.binaryHooks, execution: program.binaryExecution,
    linkedComponentIds: program.configuration.outputType === "bin" ? program.binaryDispatchDemand.linkedComponentIds : Object.freeze([]),
    initializerFunctionBase: allocateRustComponentSupportModuleName(program.sourceOutputIdentities, root.componentId,
      "initialize", [root.structuralShapesModuleName, root.programModuleName, initializerModule]),
    workerDispatch: Object.freeze(dispatch) });
  return Object.freeze(issues);
}
