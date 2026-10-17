import type { SourceFile } from "@tsonic/tsts";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustInitializationErrorRecords, RustInitializerSelection, RustModuleErrorInitializer } from "../../target-model/records/error-regions.js";
import { prepareRustCallableEmissionRequests, prepareRustEmissionContextRequests, rustEmissionIdentityBindings,
  type RustCallableEmissionPreparation, type RustCallableEmissionPreparationInput, type RustEmissionContextRequest } from "../callables/emission-contexts.js";

export interface RustPhysicalEmissionPreparationInput extends RustCallableEmissionPreparationInput {
  readonly sourceFiles: readonly SourceFile[];
  readonly initialization: RustInitializationErrorRecords;
}

export function prepareRustPhysicalEmissionContexts(
  input: RustPhysicalEmissionPreparationInput,
): TargetStageResult<RustCallableEmissionPreparation> {
  const callable = prepareRustCallableEmissionRequests(input);
  if (callable.kind === "rejected") return callable;
  const bindings = rustEmissionIdentityBindings([])!;
  const requests: RustEmissionContextRequest[] = [...callable.value];
  const modules = new Map<SourceFile, { readonly module: RustModuleErrorInitializer;
    readonly initializers: readonly RustInitializerSelection[] }>();
  for (const initializer of [input.initialization.root, ...input.initialization.workers.map(worker => worker.initializer)])
    for (const module of initializer.modules) {
      const selected = modules.get(module.sourceFile);
      if (selected !== undefined && selected.module !== module) return rejectedTargetStage([{
        code: "RUST_PHYSICAL_EMISSION_CONTEXT_NOT_PREPARED", category: "error", source: "tsonic-rust", sourceNode: module.sourceFile,
        message: "One source module requires its original selected initializer descriptor." }]);
      modules.set(module.sourceFile, { module, initializers: Object.freeze([...selected?.initializers ?? [], initializer]) });
    }
  for (const [sourceFile, { module, initializers }] of modules) {
    requests.push({ use: targetUseSiteRef(sourceFile, "module-initializer", module.identity), role: "module-initializer",
      specialization: Object.freeze({ kind: "ordinary" }), declaration: sourceFile,
      source: { kind: "module", module, initializers },
      bindings, returnDestination: Object.freeze({ kind: "none" }),
      error: Object.freeze({ kind: "region", owner: sourceFile, region: module.region }), sourceCarriers: [],
      physicalCarriers: module.region.sources.map(source => source.errorType),
      demands: input.emissionRequests.filter(demand => demand.owner === sourceFile) });
  }
  for (const worker of input.initialization.workers) {
    requests.push({ use: targetUseSiteRef(worker.sourceFile, "worker-initializer", input.ast.getFileName(worker.sourceFile)), role: "worker-initializer",
      specialization: Object.freeze({ kind: "ordinary" }),
      source: { kind: "worker", initializer: worker.initializer },
      declaration: worker.sourceFile, bindings, returnDestination: Object.freeze({ kind: "none" }), demands: [],
      error: Object.freeze({ kind: "initializer", owner: worker.sourceFile, initializer: worker.initializer }), sourceCarriers: [],
      physicalCarriers: worker.initializer.modules.flatMap(module => module.region.sources.map(source => source.errorType)) });
  }
  return prepareRustEmissionContextRequests(input, requests);
}
