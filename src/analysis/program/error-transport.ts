import type { RustAnalysisContext } from "./context.js";
import type { SourceErrorStorageDemandQueries } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { RustProjectTypePolicy, RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { RustSourcePackageComponentClassifications } from "./source-package-components.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustJsValueTargetType, rustTsValueTargetType } from "../../target-model/types/index.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";

export interface RustErrorPayloadAdmission {
  readonly target: TargetTypeRef;
  readonly conversion: RustValueConversion | null;
}

export type RustErrorPayloadVariant =
  | { readonly kind: "project"; readonly name: string; readonly definition: RustProjectTypeDefinition;
      readonly carrier: TargetTypeRef; readonly sourceError: boolean; readonly admissions: readonly RustErrorPayloadAdmission[] }
  | { readonly kind: "closed"; readonly name: string; readonly carrier: TargetTypeRef;
      readonly admissions: readonly RustErrorPayloadAdmission[] }
  | { readonly kind: "retained"; readonly name: "Retained" };

export interface RustErrorTransportQueries {
  forComponent(componentId: string): readonly RustErrorPayloadVariant[] | undefined;
}

export function analyzeRustErrorTransport(input: {
  readonly ast: Pick<RustAnalysisContext["ast"], "getSourceFile" | "getFileName">;
  readonly projectTypes: Pick<RustProjectTypePolicy,
    "programErrorDefinitions" | "programErrorVariant" | "openCarrier" | "sourceErrorDefinitions">;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly sourcePackageComponents: RustSourcePackageComponentClassifications;
  readonly errorStorageDemands: Pick<SourceErrorStorageDemandQueries, "retainedBoundaries">;
}): TargetStageResult<RustErrorTransportQueries> {
  const byComponent = new Map<string, RustErrorPayloadVariant[]>();
  const diagnostics: TargetDiagnostic[] = [];
  const reject = (message: string): void => {
    diagnostics.push({ code: "RUST_ERROR_TRANSPORT_UNRESOLVED", category: "error", source: "tsonic-rust",
      message, evidence: ["target.capability=rust.analysis.error-transport"] });
  };
  const admissionsFor = (source: TargetTypeRef): readonly RustErrorPayloadAdmission[] => {
    const admissions: RustErrorPayloadAdmission[] = [];
    for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
      if (rustTargetTypeRefEquals(source, target)) {
        admissions.push(Object.freeze({ target: snapshotClosedMetadata(target), conversion: null }));
        continue;
      }
      const conversion = selectRustSourceValueConversion(source, target, input.typeDefinitions);
      const contract = conversion === undefined ? undefined : rustValueConversionContract(conversion, input.typeDefinitions);
      if (conversion !== undefined && contract !== undefined && !contract.fallible &&
        contract.lowering !== "program-error-closed-value" && rustTargetTypeRefEquals(contract.source, source) &&
        rustTargetTypeRefEquals(contract.target, target)) {
        admissions.push(Object.freeze({ target: snapshotClosedMetadata(target),
          conversion: snapshotClosedMetadata(conversion) }));
      }
    }
    return Object.freeze(admissions);
  };
  for (const component of input.sourcePackageComponents.components) {
    if (component.errorDomain === "project" && component.errorOwnerComponentId === component.componentId) {
      byComponent.set(component.componentId, []);
    }
  }
  for (const definition of input.projectTypes.programErrorDefinitions) {
    const component = input.sourcePackageComponents.componentForFile(definition.fileName);
    const variants = component === undefined ? undefined : byComponent.get(component.componentId);
    const name = input.projectTypes.programErrorVariant(definition);
    if (variants === undefined || name === undefined) {
      reject("A project Error payload has no exact component-owned variant identity.");
      continue;
    }
    const carrier = input.projectTypes.openCarrier(definition);
    variants.push(Object.freeze({ kind: "project", name, definition, carrier,
      sourceError: input.projectTypes.sourceErrorDefinitions.includes(definition), admissions: admissionsFor(carrier) }));
  }
  const retainedOwners = new Set<string>();
  for (const boundary of input.errorStorageDemands.retainedBoundaries) {
    const file = input.ast.getSourceFile(boundary);
    const component = file === undefined ? undefined
      : input.sourcePackageComponents.componentForFile(input.ast.getFileName(file));
    if (component === undefined) reject("A retained Error boundary has no exact source-package identity.");
    else retainedOwners.add(component.componentId);
  }
  for (const component of input.sourcePackageComponents.components) {
    const variants = byComponent.get(component.componentId);
    if (variants === undefined) continue;
    const closed = new Map<string, TargetTypeRef>();
    for (const carrier of component.closedErrorDemand.thrownCarriers) {
      const name = rustTargetTypeRefEquals(carrier, rustTsValueTargetType()) ? "ClosedNative"
        : rustTargetTypeRefEquals(carrier, rustJsValueTargetType()) ? "ClosedJs" : undefined;
      if (name === undefined) reject("A closed Error payload has no exact supported native carrier.");
      else closed.set(name, carrier);
    }
    for (const [name, carrier] of [...closed].sort(([left], [right]) => left.localeCompare(right))) {
      variants.push(Object.freeze({ kind: "closed", name, carrier, admissions: admissionsFor(carrier) }));
    }
    if (component.closedErrorDemand.retained || retainedOwners.has(component.componentId)) {
      variants.push(Object.freeze({ kind: "retained", name: "Retained" }));
    }
    if (new Set(variants.map(variant => variant.name)).size !== variants.length ||
      variants.some(variant => ["Runtime", "SourceCreated", "Suppressed"].includes(variant.name))) {
      reject("An Error transport contains conflicting or reserved native variant identities.");
    }
    Object.freeze(variants);
  }
  return diagnostics.length > 0 ? rejectedTargetStage(diagnostics)
    : resolvedTargetStage(Object.freeze({ forComponent: (componentId: string) => byComponent.get(componentId) }));
}
