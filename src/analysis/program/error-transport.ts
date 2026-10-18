import type { RustExternalSourcePackageError, RustSourcePackageErrorBoundary,
  RustSourcePackageErrorDomainPlan, RustSourcePackageErrorPlan } from "../../target-model/records/error-regions.js";
import { rustRuntimeErrorTypeIdentity, type RustErrorDomain } from "../../target-model/operations/error-boundary.js";
import { isRustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustPascalCaseIdentifier } from "../../target-model/names/identifiers.js";
import type { RustSourceModuleConstructionIndex } from "../source-modules/model.js";
import type { RustAnalysisContext } from "./context.js";
import type { SourceErrorStorageDemandQueries } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { RustProjectTypePolicy, RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { RustProgramErrorOwner, TargetTypeRef } from "../../target-model/types/model.js";
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

export interface RustErrorTransportQueries extends RustSourcePackageErrorPlan {
  dependencyComponentIdsFor(componentId: string): readonly string[] | undefined;
  forComponent(componentId: string): readonly RustErrorPayloadVariant[] | undefined;
}

export function analyzeRustErrorTransport(input: {
  readonly ast: Pick<RustAnalysisContext["ast"], "getSourceFile" | "getFileName">;
  readonly projectTypes: Pick<RustProjectTypePolicy,
    "programErrorDefinitions" | "programErrorVariant" | "openCarrier" | "sourceErrorDefinitions">;
  readonly typeDefinitions: RustTypeDefinitions;
  readonly sourcePackageComponents: RustSourcePackageComponentClassifications;
  readonly errorStorageDemands: Pick<SourceErrorStorageDemandQueries, "retainedBoundaries" | "nativeConstructors" | "storageFor">;
  readonly sourceModuleConstructions: Pick<RustSourceModuleConstructionIndex, "entries">;
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
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);
  const components = sourcePackageErrorComponents(input);
  if (components.kind === "rejected") return components;
  const native = analyzeRustSourcePackageErrors(input, components.value);
  if (native.plan === undefined) return rejectedTargetStage(native.diagnostics);
  const dependencyIds = new Map(components.value.map(component => [component.componentId, component.dependencyComponentIds]));
  return resolvedTargetStage(Object.freeze({ ...native.plan,
    dependencyComponentIdsFor: (componentId: string) => dependencyIds.get(componentId),
    forComponent: (componentId: string) => byComponent.get(componentId) }));
}

export interface RustSourcePackageErrorAnalysisInput {
  readonly ast: Pick<RustAnalysisContext["ast"], "getSourceFile" | "getFileName">;
  readonly projectTypes: Pick<RustProjectTypePolicy, "programErrorDefinitions" | "programErrorVariant">;
  readonly sourcePackageComponents: Pick<RustSourcePackageComponentClassifications, "forComponent">;
  readonly errorStorageDemands: Pick<SourceErrorStorageDemandQueries, "retainedBoundaries" | "nativeConstructors" | "storageFor">;
}

interface RustSourcePackageErrorComponent {
  readonly componentId: string;
  readonly sourceFileNames: ReadonlySet<string>;
  readonly dependencyComponentIds: readonly string[];
  readonly crateName: string | undefined;
  readonly programModuleName: string;
  readonly errorDomain: RustErrorDomain;
  readonly errorOwnerComponentId: string | undefined;
}

export function rustSourcePackageErrorTypeIdentity(componentId: string, errorDomain: RustErrorDomain): string {
  return errorDomain === "runtime" ? rustRuntimeErrorTypeIdentity : `tsonic-source-package:${componentId}:TsonicError`;
}

function sourcePackageErrorComponents(
  input: Parameters<typeof analyzeRustErrorTransport>[0],
): TargetStageResult<readonly RustSourcePackageErrorComponent[]> {
  const components = input.sourcePackageComponents.components;
  const ids = new Map(components.flatMap(component => component.sourceFileNames.map(file => [file, component.componentId] as const)));
  const dependencies = new Map(components.map(component => [component.componentId, new Set(component.dependencyComponentIds)]));
  for (const construction of input.sourceModuleConstructions.entries()) {
    const source = ids.get(input.ast.getFileName(construction.sourceFile));
    const target = ids.get(input.ast.getFileName(construction.targetSourceFile));
    if (source === undefined || target === undefined) return rejectedTargetStage([{
      code: "RUST_SOURCE_MODULE_COMPONENT_IDENTITY_MISSING", category: "error", source: "tsonic-rust",
      message: "A selected source-module construction has no exact source-package component identity.",
      evidence: ["target.capability=rust.backend.source-package-components"],
    }]);
    if (source !== target) dependencies.get(source)!.add(target);
  }
  return resolvedTargetStage(Object.freeze(components.map(component => Object.freeze({
    ...component,
    sourceFileNames: Object.freeze(new Set(component.sourceFileNames)),
    dependencyComponentIds: Object.freeze([...dependencies.get(component.componentId)!]
      .sort((left, right) => left.localeCompare(right, "en"))),
    ...(component.crateName === undefined ? {} : { crateName: component.crateName }),
  }))));
}

export function analyzeRustSourcePackageErrors(
  input: RustSourcePackageErrorAnalysisInput,
  components: readonly RustSourcePackageErrorComponent[],
): {
  readonly plan?: RustSourcePackageErrorPlan;
  readonly diagnostics: readonly TargetDiagnostic[];
} {
  const diagnostics: TargetDiagnostic[] = [];
  const componentIdByFileName = new Map(components.flatMap((component) =>
    [...component.sourceFileNames].map((fileName) =>
      [fileName, component.componentId] as const)));
  const componentIdByDefinition = new Map<RustProjectTypeDefinition, string>();
  const definitionsByComponentId = new Map<string, RustProjectTypeDefinition[]>();
  for (const definition of input.projectTypes.programErrorDefinitions) {
    const componentId = componentIdByFileName.get(definition.fileName);
    if (componentId === undefined) {
      diagnostics.push(errorPlanDiagnostic(
        "RUST_PROJECT_ERROR_SOURCE_PACKAGE_MISSING",
        `Project error '${definition.sourceName}' has no exact source-package component identity.`,
        definition,
      ));
      continue;
    }
    const variant = input.projectTypes.programErrorVariant(definition);
    if (variant === undefined) {
      diagnostics.push(errorPlanDiagnostic(
        "RUST_PROGRAM_ERROR_VARIANT_MISSING",
        `Project error '${definition.sourceName}' has no exact component-owned Rust variant identity.`,
        definition,
      ));
      continue;
    }
    componentIdByDefinition.set(definition, componentId);
    const definitions = definitionsByComponentId.get(componentId) ?? [];
    definitions.push(definition);
    definitionsByComponentId.set(componentId, definitions);
  }
  if (diagnostics.length > 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }

  const componentById = new Map(components.map((component) =>
    [component.componentId, component] as const));
  if (componentById.size !== components.length) return {
    diagnostics: Object.freeze([errorPlanDiagnostic("RUST_SOURCE_PACKAGE_ERROR_BOUNDARY_CONFLICT",
      "Source-package error transport requires one authoritative component per identity.")]),
  };
  const domainsByComponentId = new Map<string, RustSourcePackageErrorDomainPlan>();
  const dependencyErrorsByComponentId = new Map<string, readonly RustExternalSourcePackageError[]>();
  for (const component of components) {
    const definitions = Object.freeze([
      ...(definitionsByComponentId.get(component.componentId) ?? []),
    ]);
    const usedVariantNames = new Set([
      "Runtime",
      "SourceCreated",
      "Retained",
      "ClosedNative",
      "ClosedJs",
      "Suppressed",
      ...definitions.map((definition) => input.projectTypes.programErrorVariant(definition)!),
    ]);
    const externalErrors: RustExternalSourcePackageError[] = [];
    const dependencyErrors: RustExternalSourcePackageError[] = [];
    const externalByOwner = new Map<string, RustExternalSourcePackageError>();
    for (const dependencyComponentId of component.dependencyComponentIds) {
      const dependency = componentById.get(dependencyComponentId);
      if (dependency === undefined) {
        diagnostics.push(errorPlanDiagnostic(
          "RUST_SOURCE_PACKAGE_ERROR_DEPENDENCY_MISSING",
          `Source-package component '${component.componentId}' has no exact plan for dependency '${dependencyComponentId}'.`,
        ));
        continue;
      }
      if (dependency.errorDomain !== "project") {
        continue;
      }
      if (dependency.errorOwnerComponentId === undefined) {
        diagnostics.push(errorPlanDiagnostic("RUST_SOURCE_PACKAGE_ERROR_OWNER_MISSING",
          `Source-package component '${dependencyComponentId}' has no sealed project-error owner.`));
        continue;
      }
      if (dependency.crateName === undefined) {
        diagnostics.push(errorPlanDiagnostic(
          "RUST_EXTERNAL_SOURCE_PACKAGE_ERROR_CRATE_MISSING",
          `External source-package component '${dependencyComponentId}' has a project error domain but no exact Rust crate identity.`,
        ));
        continue;
      }
      const existing = externalByOwner.get(dependency.errorOwnerComponentId);
      const preferredVariantName = `${rustPascalCaseIdentifier(dependency.crateName)}Error`;
      const variant = existing?.variant ?? allocateVariantName(preferredVariantName, usedVariantNames);
      const external = Object.freeze({
        componentId: dependencyComponentId,
        errorOwnerComponentId: dependency.errorOwnerComponentId,
        crateName: dependency.crateName,
        typePath: `${dependency.crateName}::${dependency.programModuleName}::TsonicError`,
        variant,
      });
      dependencyErrors.push(external);
      if (existing === undefined) {
        externalByOwner.set(dependency.errorOwnerComponentId, external);
        externalErrors.push(external);
      }
    }
    const owner = component.errorOwnerComponentId;
    const forwarding = owner === undefined || owner === component.componentId
      ? undefined : externalByOwner.get(owner);
    const demand = input.sourcePackageComponents.forComponent(component.componentId)?.closedErrorDemand;
    const validDemand = demand !== undefined && typeof demand.sourceView === "boolean" && typeof demand.retained === "boolean";
    const validDomain = validDemand && (component.errorDomain === "runtime"
      ? owner === undefined && definitions.length === 0 && externalErrors.length === 0 && !demand.sourceView && !demand.retained
      : owner !== undefined && (owner === component.componentId
        ? definitions.length > 0 || externalErrors.length > 1 ||
          demand.retained || demand.sourceView ||
          input.errorStorageDemands.retainedBoundaries.some(boundary =>
          component.sourceFileNames.has(input.ast.getFileName(input.ast.getSourceFile(boundary)!))) ||
          input.errorStorageDemands.nativeConstructors.some(constructor =>
          input.errorStorageDemands.storageFor(constructor).kind === "writable" &&
          component.sourceFileNames.has(input.ast.getFileName(input.ast.getSourceFile(constructor.node)!)))
        : forwarding !== undefined && definitions.length === 0 && externalErrors.length === 1 && !demand.sourceView && !demand.retained));
    if (!validDomain) {
      diagnostics.push(errorPlanDiagnostic("RUST_SOURCE_PACKAGE_ERROR_OWNER_CONFLICT",
        `Source-package component '${component.componentId}' disagrees with its sealed error-domain ownership.`));
      continue;
    }
    dependencyErrorsByComponentId.set(component.componentId, Object.freeze(dependencyErrors));
    domainsByComponentId.set(component.componentId, Object.freeze({
      componentId: component.componentId,
      errorDomain: component.errorDomain,
      errorOwnerComponentId: owner,
      errorTypeIdentity: rustSourcePackageErrorTypeIdentity(owner ?? component.componentId, component.errorDomain),
      ...(forwarding === undefined ? {} : {
        forwardModulePath: `${forwarding.crateName}::${componentById.get(forwarding.componentId)!.programModuleName}`,
      }),
      definitions,
      externalErrors: Object.freeze(externalErrors),
    }));
  }
  if (diagnostics.length > 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }
  const boundaries = new Map<string, ReadonlyMap<string, RustSourcePackageErrorBoundary>>();
  const runtimeBoundaries = new Map<string, RustSourcePackageErrorBoundary>();
  const physicalBoundaries = new Map<string, ReadonlyMap<string, RustSourcePackageErrorBoundary>>();
  for (const consumer of domainsByComponentId.values()) {
    const local = Object.freeze({ componentId: consumer.componentId, errorDomain: consumer.errorDomain,
      errorTypePath: "rt::TsonicError", errorTypeIdentity: consumer.errorTypeIdentity });
    const selected = new Map<string, RustSourcePackageErrorBoundary>([[consumer.componentId, local]]);
    runtimeBoundaries.set(consumer.componentId, consumer.errorDomain === "runtime"
      ? local
      : Object.freeze({ componentId: consumer.componentId, errorDomain: "runtime",
          errorTypePath: "tsonic_rust_runtime::TsonicError", errorTypeIdentity: rustRuntimeErrorTypeIdentity }));
    const physical = new Map<string, RustSourcePackageErrorBoundary>();
    const admitPhysical = (ownerId: string, boundary: RustSourcePackageErrorBoundary): void => {
      const owner = domainsByComponentId.get(ownerId);
      if (owner?.errorDomain !== "project" || owner.errorOwnerComponentId !== ownerId ||
        owner.errorTypeIdentity !== boundary.errorTypeIdentity) {
        diagnostics.push(errorPlanDiagnostic("RUST_SOURCE_PACKAGE_ERROR_BOUNDARY_CONFLICT",
          `Source-package component '${consumer.componentId}' has no exact physical error boundary for owner '${ownerId}'.`));
        return;
      }
      const existing = physical.get(ownerId);
      if (existing === undefined) physical.set(ownerId, boundary);
      else if (existing.errorTypeIdentity !== boundary.errorTypeIdentity) diagnostics.push(errorPlanDiagnostic(
        "RUST_SOURCE_PACKAGE_ERROR_BOUNDARY_CONFLICT",
        `Source-package component '${consumer.componentId}' has conflicting physical error identities for owner '${ownerId}'.`));
    };
    if (consumer.errorOwnerComponentId !== undefined) admitPhysical(consumer.errorOwnerComponentId, local);
    const externalByComponent = new Map(dependencyErrorsByComponentId.get(consumer.componentId)!
      .map(external => [external.componentId, external] as const));
    for (const dependencyId of componentById.get(consumer.componentId)!.dependencyComponentIds) {
      const owner = domainsByComponentId.get(dependencyId);
      const external = externalByComponent.get(dependencyId);
      if (owner === undefined || selected.has(dependencyId) ||
        owner.errorDomain === "project" && external === undefined) {
        diagnostics.push(errorPlanDiagnostic("RUST_SOURCE_PACKAGE_ERROR_BOUNDARY_CONFLICT",
          `Source-package component '${consumer.componentId}' has no unique selected dependency boundary for '${dependencyId}'.`));
        continue;
      }
      const boundary = Object.freeze({ componentId: dependencyId, errorDomain: owner.errorDomain,
        errorTypePath: owner.errorDomain === "runtime" ? "tsonic_rust_runtime::TsonicError" : external!.typePath,
        errorTypeIdentity: owner.errorTypeIdentity });
      selected.set(dependencyId, boundary);
      if (external !== undefined) admitPhysical(external.errorOwnerComponentId, boundary);
    }
    boundaries.set(consumer.componentId, selected);
    physicalBoundaries.set(consumer.componentId, physical);
  }
  if (diagnostics.length > 0) return { diagnostics: Object.freeze(diagnostics) };
  const componentBoundaryFor = (consumer: string, owner: string): RustSourcePackageErrorBoundary | undefined =>
    boundaries.get(consumer)?.get(owner);
  const physicalBoundaryFor = (consumer: string, owner: RustProgramErrorOwner): RustSourcePackageErrorBoundary | undefined =>
    !isRustProgramErrorOwner(owner) || owner.kind !== "physical" ? undefined
      : owner.domain === "runtime" ? runtimeBoundaries.get(consumer)
        : physicalBoundaries.get(consumer)?.get(owner.componentId);
  return {
    plan: Object.freeze({
      componentIdByFileName: new Map(componentIdByFileName),
      componentIdByDefinition: new Map(componentIdByDefinition),
      domainsByComponentId: new Map(domainsByComponentId),
      dependencyErrorsByComponentId: new Map(dependencyErrorsByComponentId),
      componentBoundaryFor,
      physicalBoundaryFor,
      nativeBoundaryFor: (consumer: string, owner: RustProgramErrorOwner) =>
        !isRustProgramErrorOwner(owner) ? undefined : owner.kind === "logical"
          ? componentBoundaryFor(consumer, consumer) : physicalBoundaryFor(consumer, owner),
    }),
    diagnostics: Object.freeze([]),
  };
}

function allocateVariantName(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function errorPlanDiagnostic(
  code: string,
  message: string,
  definition?: RustProjectTypeDefinition,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    ...(definition === undefined ? {} : { sourceNode: definition.declaration }),
    evidence: ["target.capability=rust.error.source-package-conversion"],
  };
}
