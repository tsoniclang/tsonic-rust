import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustSourcePackageErrorPlan } from "../../target-model/records/source-package-errors.js";
import type { RustDispatchRootEmission } from "../../target-model/records/dispatch-contexts.js";
import type { RustDispatchContextEmissionProducer } from "../program/records/dispatch-contexts.js";
import type { RustPhysicalErrorOwner } from "../../target-model/records/error-regions.js";
import { isRustProgramErrorCarrier, rustProgramErrorTargetType } from "../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { selectRustStandaloneTypeIdentity } from "../../policy/types/standalone-emission.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export function analyzeRustDispatchRootEmission(program: Omit<RustTargetProgram, "reachability">,
  errors: RustSourcePackageErrorPlan, producer: RustDispatchContextEmissionProducer): readonly TargetDiagnostic[] {
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
      const carrier = mapRustTargetTypes(declaration.rootCarrier, type => isRustProgramErrorCarrier(type) ? error : type);
      if (selectRustStandaloneTypeIdentity(carrier, { programError: true }) === undefined) {
        refuse("A demanded native dispatch root has no exact renderable carrier.");
        continue;
      }
      roots.push(Object.freeze({ index, carrier, construct: Object.freeze({ path: declaration.construct.path, const: declaration.construct.const }) }));
    }
    producer.roots(domain.componentId, roots);
  }
  return Object.freeze(issues);
}
