import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../target-model/records/program.js";

import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustSourcePackageComponentClassifications } from "../../target-model/records/program/source-package-semantics.js";
import type { AnalyzeRustDispatchContextResult, RustDispatchContextAccess, RustDispatchContextCatalog, RustDispatchContextComposition } from "./dispatch-contexts.js";
import type { RustFinalizedDispatchContextInput, RustFinalizedOperationAbi } from "../../target-model/records/operations/finalized-operation.js";
import type { RustDispatchContextProjection } from "../../target-model/operations/dispatch-contexts.js";
import { isRustFinalizedDispatchContextInput } from "../../target-model/operations/finalized-inputs.js";

export interface RustDispatchContextInputSelection {
  readonly input: RustFinalizedDispatchContextInput;
  readonly access: RustDispatchContextAccess;
  readonly rootOrdinal: number;
  readonly handle: RustDispatchContextProjection | undefined;
}

export interface RustDispatchContextDemandPlan {
  forComponent(componentId: string): RustDispatchContextComposition | undefined;
  inputFor(componentId: string, input: RustFinalizedDispatchContextInput): RustDispatchContextInputSelection | undefined;
}

export function analyzeRustDispatchContextDemand(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  records: RustProgramRecords,
  components: RustSourcePackageComponentClassifications,
  isNativeNode: (node: Node) => boolean,
  catalog: RustDispatchContextCatalog,
  binaryAccessContextIds: readonly string[],
): AnalyzeRustDispatchContextResult<RustDispatchContextDemandPlan> {
  const demand = new Map<string, Set<string>>();
  const inputs = new Map<string, Set<RustFinalizedDispatchContextInput>>();
  for (const sourceFile of sourceFiles) {
    const component = components.componentForFile(ast.getFileName(sourceFile));
    if (component === undefined) return rejected("Native dispatch demand has no exact source-package component.");
    const pending: Node[] = [sourceFile];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (!isNativeNode(node)) continue;
      const operation = records.compoundWrite.get(node) ?? records.targetOperation.get(node);
      const disposal = records.resourceManagement.get(node)?.disposal.target;
      const abis: readonly RustFinalizedOperationAbi[] = [
        ...operation?.kind === "provider-operation" || operation?.kind === "runtime-set" ? [operation.abi] :
          operation?.kind === "union-property" ? operation.variants.flatMap(variant => variant.operation === undefined ? [] : [variant.operation.abi]) : [],
        ...disposal?.form === "provider" ? [disposal.abi] : [],
      ];
      for (const abi of abis) {
        for (const input of abi.dispatchInputs) {
          const selected = catalog.resolveInput({
            contextId: input.contextId, view: input.view,
            targetArgumentIndex: input.targetArgumentIndex, mode: input.mode,
          });
          if (selected === undefined || !rustTargetTypeRefEquals(selected.carrier, input.carrier)) {
            return rejected("Native dispatch input disagrees with its exact declaration owner.");
          }
          const selectedContexts = demand.get(component.componentId) ?? new Set<string>();
          selectedContexts.add(input.contextId);
          demand.set(component.componentId, selectedContexts);
        }
        const selectedInputs = inputs.get(component.componentId) ?? new Set<RustFinalizedDispatchContextInput>();
        for (const input of abi.targetArguments.filter(isRustFinalizedDispatchContextInput)) selectedInputs.add(input);
        inputs.set(component.componentId, selectedInputs);
      }
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
  }
  const plans = new Map<string, RustDispatchContextComposition>();
  const selections = new Map<string, ReadonlyMap<RustFinalizedDispatchContextInput, RustDispatchContextInputSelection>>();
  for (const component of components.components) {
    const demandedContextIds = [...demand.get(component.componentId) ?? []];
    const selected = catalog.compose({ demandedContextIds,
      accessContextIds: [...new Set([...demandedContextIds, ...binaryAccessContextIds])] });
    if (selected.kind === "rejected") return selected;
    plans.set(component.componentId, selected.plan);
    const prepared = new Map<RustFinalizedDispatchContextInput, RustDispatchContextInputSelection>();
    for (const input of inputs.get(component.componentId) ?? []) {
      const declaration = catalog.declaration(input.source.contextId);
      const access = selected.plan.access(input.source.contextId);
      const carrier = input.source.view === "root" ? declaration?.rootCarrier : declaration?.handleCarrier;
      const rootOrdinal = access === undefined ? -1 : selected.plan.rootContextIds.indexOf(access.rootContextId);
      if (declaration === undefined || access === undefined || rootOrdinal < 0 || carrier === undefined ||
        !rustTargetTypeRefEquals(carrier, input.carrier) || input.source.view === "handle" && declaration.handle === undefined)
        return rejected("A native dispatch input has no matching exact declaration and demanded physical root.");
      prepared.set(input, Object.freeze({ input, access, rootOrdinal,
        handle: input.source.view === "handle" ? declaration.handle : undefined }));
    }
    selections.set(component.componentId, prepared);
  }
  return { kind: "resolved", plan: Object.freeze({
    forComponent: (componentId: string) => plans.get(componentId),
    inputFor: (componentId: string, input: RustFinalizedDispatchContextInput) => selections.get(componentId)?.get(input),
  }) };
}

function rejected(message: string): AnalyzeRustDispatchContextResult<never> {
  return { kind: "rejected", diagnostics: Object.freeze([{
    code: "RUST_DISPATCH_CONTEXT_DEMAND_INVALID", category: "error", source: "tsonic-rust", message,
    evidence: ["rust.runtime.dispatch-context-demand"],
  }]) };
}
