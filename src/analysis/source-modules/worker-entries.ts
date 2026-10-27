import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageEmissionProducer } from "../program/records/program/source-packages.js";
import type { RustWorkerEntryEmission } from "../../target-model/records/program/source-packages.js";
import type { SourceFile } from "@tsonic/tsts";

export function analyzeRustWorkerEntries(program: Omit<RustAnalysisProgram, "reachability">,
  producer: RustSourcePackageEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (code: string, message: string, sourceNode: SourceFile): void => {
    issues.push(Object.freeze({ code, message, sourceNode, category: "error", source: "tsonic-rust",
      evidence: Object.freeze(["target.capability=rust.backend.source-module-construction"]) }));
  };
  const components = program.records.sourcePackageComponents.get();
  const errors = program.records.sourcePackageErrors.get();
  if (components === undefined || errors === undefined) failTargetAnalysisInvariant("tsonic-rust", "Worker admission requires its source-package and error-domain inventories.");
  const byComponent = new Map(components.map(component => [component.componentId, component]));
  const root = components.find(component => component.root);
  if (root === undefined) failTargetAnalysisInvariant("tsonic-rust", "Worker admission requires its root component.");
  const sourceByName = new Map(program.sourceFiles.map(file => [program.source.ast.getFileName(file), file]));
  const selected: RustWorkerEntryEmission[] = [];
  const targets = [...program.sourceModuleConstructions.targets()].map(sourceFile => ({ sourceFile, fileName: program.source.ast.getFileName(sourceFile) }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));
  for (const target of targets) {
    const identity = program.sourceOutputIdentities.get(target.fileName);
    const component = identity === undefined ? undefined : byComponent.get(identity.componentId);
    if (identity === undefined || component === undefined || sourceByName.get(target.fileName) !== target.sourceFile) {
      refuse("RUST_WORKER_ENTRY_OUTPUT_IDENTITY_MISSING", `Worker source module '${target.fileName}' has no exact generated crate/module identity.`, target.sourceFile);
      continue;
    }
    if (!errors.domainsByComponentId.has(component.componentId)) {
      refuse("RUST_WORKER_ENTRY_ERROR_DOMAIN_MISSING", `Worker source module '${target.fileName}' has no exact source-package error domain.`, target.sourceFile);
      continue;
    }
    const initializer = program.errorRegions.initialization.workerFor(target.sourceFile);
    if (initializer === undefined) failTargetAnalysisInvariant("tsonic-rust", "A worker initializer requires its exact completed error composition.", target.sourceFile);
    if (initializer.error.kind === "package" && program.records.sourcePackageErrorBoundary.get(root.componentId, component.componentId) === undefined) {
      refuse("RUST_WORKER_ENTRY_ERROR_BOUNDARY_MISSING", `Worker source module '${target.fileName}' has no exact error conversion into the root executable.`, target.sourceFile);
      continue;
    }
    selected.push(Object.freeze({ sourceIdentity: identity, sourceFile: target.sourceFile, fileName: target.fileName, componentId: component.componentId,
      identity: `${identity.componentId.length}:${identity.componentId}:${identity.moduleName}`, initializer }));
  }
  if (issues.length === 0) producer.workers(selected);
  return Object.freeze(issues);
}
