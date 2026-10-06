import type { RustTargetProgram } from "../../../analysis/program/model.js";
import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTsValueTargetType, rustJsValueTargetType } from "../../../target-model/types/index.js";
import type { RustExternalSourcePackageError, RustSourcePackageErrorDomainPlan } from "./source-package-errors.js";

export type RustSelectedErrorVariant =
  | { readonly kind: "project"; readonly name: string; readonly definition: RustProjectTypeDefinition;
      readonly carrier: TargetTypeRef; readonly sourceError: boolean }
  | { readonly kind: "external"; readonly name: string; readonly external: RustExternalSourcePackageError }
  | { readonly kind: "closed"; readonly name: string; readonly carrier: TargetTypeRef }
  | { readonly kind: "retained"; readonly name: "Retained" };

export function selectRustErrorVariants(
  program: RustTargetProgram,
  domain: RustSourcePackageErrorDomainPlan,
): readonly RustSelectedErrorVariant[] | undefined {
  if (domain.errorDomain !== "project" || domain.errorOwnerComponentId !== domain.componentId ||
    domain.forwardModulePath !== undefined) return undefined;
  const owner = domain.componentId;
  const demand = program.sourcePackageComponents.forComponent(owner)?.closedErrorDemand;
  if (demand === undefined) return undefined;
  const variants: RustSelectedErrorVariant[] = [];
  for (const definition of domain.definitions) {
    const name = program.projectTypes.programErrorVariant(definition);
    if (name === undefined) return undefined;
    variants.push({ kind: "project", name, definition,
      carrier: program.projectTypes.openCarrier(definition),
      sourceError: program.projectTypes.sourceErrorDefinitions.includes(definition) });
  }
  for (const external of domain.externalErrors) {
    variants.push({ kind: "external", name: external.variant, external });
  }
  const closed = new Map<string, TargetTypeRef>();
  for (const carrier of demand.thrownCarriers) {
    const name = rustTargetTypeRefEquals(carrier, rustTsValueTargetType()) ? "ClosedNative"
      : rustTargetTypeRefEquals(carrier, rustJsValueTargetType()) ? "ClosedJs" : undefined;
    if (name === undefined) return undefined;
    closed.set(name, carrier);
  }
  for (const [name, carrier] of [...closed].sort(([left], [right]) => left.localeCompare(right))) {
    variants.push({ kind: "closed", name, carrier });
  }
  if (demand.retained || program.errorStorageDemands.retainedBoundaries.some(boundary => {
    const file = program.source.ast.getSourceFile(boundary);
    return file !== undefined && owner === program.sourcePackageComponents.componentForFile(
      program.source.ast.getFileName(file))?.componentId;
  })) variants.push({ kind: "retained", name: "Retained" });
  if (new Set(variants.map(variant => variant.name)).size !== variants.length ||
    variants.some(variant => variant.name === "Runtime" || variant.name === "SourceCreated" ||
      variant.name === "Suppressed")) return undefined;
  return Object.freeze(variants.map(variant => Object.freeze(variant)));
}
