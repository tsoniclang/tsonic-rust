import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageErrorPlan } from "../../target-model/records/errors/source-package-errors.js";
import type { RustPlannedErrorVariant } from "../../target-model/records/errors/error-transport.js";
import type { RustErrorTransportEmissionProducer } from "../program/records/errors/error-transport.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustErrorVariantEmission(program: Pick<RustAnalysisProgram, "errorTransport">,
  errors: RustSourcePackageErrorPlan, producer: RustErrorTransportEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const domain of errors.domainsByComponentId.values()) {
    if (domain.errorDomain !== "project" || domain.errorOwnerComponentId !== domain.componentId || domain.forwardModulePath !== undefined) continue;
    const inventory = program.errorTransport.forComponent(domain.componentId);
    const project = inventory?.filter(variant => variant.kind === "project");
    const variants: readonly RustPlannedErrorVariant[] | undefined = project === undefined || inventory === undefined ? undefined
      : Object.freeze([...project, ...domain.externalErrors.map(external =>
        Object.freeze({ kind: "external" as const, name: external.variant, external })),
        ...inventory.filter(variant => variant.kind !== "project")]);
    if (variants === undefined || project === undefined || project.length !== domain.definitions.length ||
      project.some((variant, index) => variant.definition !== domain.definitions[index]) ||
      new Set(variants.map(variant => variant.name)).size !== variants.length ||
      variants.some(variant => variant.name === "Runtime" || variant.name === "SourceCreated" || variant.name === "Suppressed")) {
      issues.push(Object.freeze({ code: "RUST_CLOSED_ERROR_DEMAND_MISSING", category: "error", source: "tsonic-rust",
        message: "Program Error transport requires its exact sealed variant inventory." }));
      continue;
    }
    producer.variants(domain.componentId, variants);
  }
  if (issues.length !== 0) return Object.freeze(issues);
  for (const selected of errors.domainsByComponentId.values()) {
    const domain = selected.forwardModulePath === undefined ? selected
      : selected.errorOwnerComponentId === undefined ? undefined : errors.domainsByComponentId.get(selected.errorOwnerComponentId);
    const variants = domain === undefined ? undefined : producer.records.programErrorVariants.get(domain.componentId);
    if (domain !== undefined && variants !== undefined && domain.errorTypeIdentity === selected.errorTypeIdentity) {
      const retained = variants.find(variant => variant.kind === "retained");
      const closed = variants.find(variant => variant.kind === "closed" && rustTargetTypeRefEquals(variant.carrier, rustJsValueTargetType()));
      producer.boundary(selected.componentId, selected.errorTypeIdentity, { domain, variants,
        jsRejection: retained === undefined || closed === undefined ? undefined : Object.freeze({ retained: retained.name, closed: closed.name }) });
    }
  }
  return Object.freeze(issues);
}
