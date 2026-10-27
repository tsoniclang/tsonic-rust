import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageErrorPlan } from "../../target-model/records/errors/source-package-errors.js";
import type { RustDispatchRootEmission } from "../../target-model/records/operations/dispatch-contexts.js";
import type { RustDispatchContextEmissionProducer } from "../program/records/operations/dispatch-contexts.js";
import type { RustPhysicalErrorOwner } from "../../target-model/records/errors/error-regions.js";
import { isRustProgramErrorCarrier, rustProgramErrorTargetType } from "../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { selectRustStandaloneTypeIdentity } from "../../policy/types/resolution/standalone-emission.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { closeRustRetainedCallableCarrier } from "../../policy/ownership/retained-storage.js";
import { rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import type { Node } from "@tsonic/tsts";
import type { RustFinalizedDispatchContextInput, RustFinalizedOperationAbi } from "../../target-model/records/operations/finalized-operation.js";
import { isRustFinalizedDispatchContextInput } from "../../target-model/operations/finalized-inputs.js";

export function analyzeRustDispatchRootEmission(program: Omit<RustAnalysisProgram, "reachability">,
  errors: RustSourcePackageErrorPlan, nodes: readonly Node[], producer: RustDispatchContextEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (message: string): void => {
    issues.push(Object.freeze({ code: "RUST_DISPATCH_CONTEXT_ROOT_INVALID", category: "error", source: "tsonic-rust",
      message, evidence: Object.freeze(["rust.backend.dispatch-context-root"]) }));
  };
  for (const domain of errors.domainsByComponentId.values()) {
    const demand = program.dispatchContextDemand.forComponent(domain.componentId);
    if (demand === undefined) { refuse("A source-package component has no sealed dispatch demand."); continue; }
    if (domain.errorDomain === "project" && domain.errorOwnerComponentId === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted project error domain requires its physical owning component.");
    const owner: RustPhysicalErrorOwner = domain.errorDomain === "runtime" ? { kind: "physical", domain: "runtime" }
      : { kind: "physical", domain: "project", componentId: domain.errorOwnerComponentId! };
    const error = rustProgramErrorTargetType(owner);
    const roots: RustDispatchRootEmission[] = [];
    for (const [index, identity] of demand.rootContextIds.entries()) {
      const declaration = program.dispatchContexts.declaration(identity);
      if (declaration === undefined) { refuse("A demanded physical dispatch root has no exact declaration."); continue; }
      // A dispatch root is program-lived thread-local storage: callables it retains live for the whole program, so a
      // provider-declared placeholder callable lifetime closes as 'static.
      const carrier = closeRustRetainedCallableCarrier(
        mapRustTargetTypes(declaration.rootCarrier, type => isRustProgramErrorCarrier(type) ? error : type), rustStaticLifetime);
      if (selectRustStandaloneTypeIdentity(carrier, { programError: true }) === undefined) {
        refuse("A demanded native dispatch root has no exact renderable carrier.");
        continue;
      }
      roots.push(Object.freeze({ name: `dispatch_root_${index + 1}`, index, carrier, construct: Object.freeze({ path: declaration.construct.path, const: declaration.construct.const }) }));
    }
    producer.roots(domain.componentId, roots);
  }
  const components = program.records.sourcePackageComponents.get();
  if (components === undefined) failTargetAnalysisInvariant("tsonic-rust", "Native dispatch input publication requires its exact source components.");
  const published = new Map<string, Set<RustFinalizedDispatchContextInput>>();
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const file = program.source.ast.getSourceFile(node);
    const fileName = file === undefined ? undefined : program.source.ast.getFileName(file);
    const component = fileName === undefined ? undefined : components.find(selected => selected.sourceFileNames.has(fileName));
    if (component === undefined) continue;
    const operation = program.records.compoundWrite.get(node) ?? program.records.targetOperation.get(node);
    const disposal = program.records.resourceManagement.get(node)?.disposal.target;
    const abis: readonly RustFinalizedOperationAbi[] = [
      ...(operation?.kind === "provider-operation" || operation?.kind === "runtime-set" ? [operation.abi]
        : operation?.kind === "union-property" ? operation.variants.flatMap(variant => variant.operation === undefined ? [] : [variant.operation.abi]) : []),
      ...(disposal?.form === "provider" ? [disposal.abi] : []),
    ];
    const selected = published.get(component.componentId) ?? new Set<RustFinalizedDispatchContextInput>();
    published.set(component.componentId, selected);
    for (const abi of abis) for (const input of abi.targetArguments.filter(isRustFinalizedDispatchContextInput)) {
      if (selected.has(input)) continue;
      const selection = program.dispatchContextDemand.inputFor(component.componentId, input);
      if (selection === undefined) { refuse("Native dispatch rendering requires its admitted exact component-owned input."); continue; }
      const root = producer.records.dispatchRoots.get(component.componentId)?.find(candidate => candidate.index === selection.rootOrdinal);
      if (root === undefined) { refuse("A demanded native dispatch input requires its exact physical root."); continue; }
      producer.input(component.componentId, input, { rootIdentity: selection.access.rootContextId,
        path: `crate::${component.programModuleName}::${root.name}`, projections: selection.access.projections,
        handle: selection.handle?.name, reference: input.source.view === "handle" && input.mode === "ref" });
      selected.add(input);
    }
  }
  return Object.freeze(issues);
}
