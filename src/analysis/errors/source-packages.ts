import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { RustSourcePackageComponentPlan } from "../../target-model/records/program/source-packages.js";
import type { RustSourcePackageErrorPlan, RustSourcePackageErrorBoundary, RustSourcePackageErrorDomainPlan, RustExternalSourcePackageError } from "../../target-model/records/errors/source-package-errors.js";
import type { RustSourcePackageErrorRoute } from "../../target-model/records/errors/source-package-errors.js";
import type { RustErrorDomain } from "../../target-model/operations/error-boundary.js";
import { rustRuntimeErrorTypeIdentity } from "../../target-model/types/carriers/runtime-carriers.js";
import type { RustProgramErrorOwner } from "../../target-model/types/model.js";
import { isRustProgramErrorOwner } from "../../target-model/types/carriers/program-errors.js";
import { rustPascalCaseIdentifier } from "../../target-model/names/identifiers.js";
import type { RustSourcePackageEmissionProducer } from "../program/records/program/source-packages.js";
export function rustSourcePackageErrorTypeIdentity(
  componentId: string,
  errorDomain: RustErrorDomain,
): string {
  return errorDomain === "runtime"
    ? rustRuntimeErrorTypeIdentity
    : `tsonic-source-package:${componentId}:TsonicError`;
}

export function analyzeRustSourcePackageErrors(
  program: Pick<RustAnalysisProgram, "projectTypes" | "sourcePackageComponents" | "errorStorageDemands" | "source">,
  components: readonly RustSourcePackageComponentPlan[],
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
  for (const definition of program.projectTypes.programErrorDefinitions) {
    const componentId = componentIdByFileName.get(definition.fileName);
    if (componentId === undefined) {
      diagnostics.push(errorPlanDiagnostic(
        "RUST_PROJECT_ERROR_SOURCE_PACKAGE_MISSING",
        `Project error '${definition.sourceName}' has no exact source-package component identity.`,
        definition,
      ));
      continue;
    }
    const variant = program.projectTypes.programErrorVariant(definition);
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
      ...definitions.map((definition) => program.projectTypes.programErrorVariant(definition)!),
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
        transportTypePath: `${dependency.crateName}::${dependency.programModuleName}::ErrorTransport`,
        sourceErrorTypePath: `${dependency.crateName}::${dependency.programModuleName}::SourceError`,
        writableSourceErrorTypePath: `${dependency.crateName}::${dependency.programModuleName}::WritableSourceError`,
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
    const demand = program.sourcePackageComponents.forComponent(component.componentId)?.closedErrorDemand;
    const validDemand = demand !== undefined && typeof demand.sourceView === "boolean" && typeof demand.retained === "boolean";
    const validDomain = validDemand && (component.errorDomain === "runtime"
      ? owner === undefined && definitions.length === 0 && externalErrors.length === 0 && !demand.sourceView && !demand.retained
      : owner !== undefined && (owner === component.componentId
        ? definitions.length > 0 || externalErrors.length > 1 ||
          demand.retained || demand.sourceView ||
          program.errorStorageDemands.retainedBoundaries.some(boundary =>
          component.sourceFileNames.has(program.source.ast.getFileName(program.source.ast.getSourceFile(boundary)!))) ||
          program.errorStorageDemands.nativeConstructors.some(constructor =>
          program.errorStorageDemands.storageFor(constructor).kind === "writable" &&
          component.sourceFileNames.has(program.source.ast.getFileName(program.source.ast.getSourceFile(constructor.node)!)))
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
  return {
    plan: Object.freeze({
      componentIdByFileName: new Map(componentIdByFileName),
      componentIdByDefinition: new Map(componentIdByDefinition),
      domainsByComponentId: new Map(domainsByComponentId),
      dependencyErrorsByComponentId: new Map(dependencyErrorsByComponentId),
    }),
    diagnostics: Object.freeze([]),
  };
}

export function selectRustSourcePackageErrorBoundary(
  plan: RustSourcePackageErrorPlan,
  consumerComponentId: string,
  ownerComponentId: string,
): RustSourcePackageErrorBoundary | undefined {
  const ownerDomain = plan.domainsByComponentId.get(ownerComponentId);
  if (ownerDomain === undefined) {
    return undefined;
  }
  if (ownerComponentId === consumerComponentId) {
    return Object.freeze({
      componentId: ownerComponentId,
      errorDomain: ownerDomain.errorDomain,
      errorTypePath: "rt::TsonicError",
      errorTypeIdentity: ownerDomain.errorTypeIdentity,
    });
  }
  if (ownerDomain.errorDomain === "runtime") {
    return Object.freeze({
      componentId: ownerComponentId,
      errorDomain: "runtime",
      errorTypePath: "tsonic_rust_runtime::TsonicError",
      errorTypeIdentity: rustRuntimeErrorTypeIdentity,
    });
  }
  const external = plan.dependencyErrorsByComponentId.get(consumerComponentId)
    ?.find((candidate) => candidate.componentId === ownerComponentId);
  return external === undefined
    ? undefined
    : Object.freeze({
        componentId: ownerComponentId,
        errorDomain: "project",
        errorTypePath: external.typePath,
        errorTypeIdentity: ownerDomain.errorTypeIdentity,
      });
}

export function selectRustPhysicalProgramErrorBoundary(
  plan: RustSourcePackageErrorPlan,
  consumerComponentId: string,
  owner: RustProgramErrorOwner,
): RustSourcePackageErrorBoundary | undefined {
  if (!isRustProgramErrorOwner(owner) || owner.kind !== "physical") return undefined;
  const consumer = plan.domainsByComponentId.get(consumerComponentId);
  if (consumer === undefined) return undefined;
  if (owner.domain === "runtime" && consumer.errorDomain === "runtime")
    return selectRustSourcePackageErrorBoundary(plan, consumerComponentId, consumerComponentId);
  if (owner.domain === "runtime") return Object.freeze({ componentId: consumerComponentId,
    errorDomain: "runtime", errorTypePath: "tsonic_rust_runtime::TsonicError",
    errorTypeIdentity: rustRuntimeErrorTypeIdentity });
  const actualOwner = plan.domainsByComponentId.get(owner.componentId);
  if (actualOwner?.errorDomain !== "project" || actualOwner.errorOwnerComponentId !== owner.componentId) return undefined;
  const visible = consumer.errorOwnerComponentId === owner.componentId ? consumerComponentId
    : plan.dependencyErrorsByComponentId.get(consumerComponentId)
      ?.find(dependency => dependency.errorOwnerComponentId === owner.componentId)?.componentId;
  const boundary = visible === undefined ? undefined : selectRustSourcePackageErrorBoundary(plan, consumerComponentId, visible);
  return boundary?.errorTypeIdentity === actualOwner.errorTypeIdentity ? boundary : undefined;
}

export function selectRustProgramErrorRoute(
  plan: RustSourcePackageErrorPlan,
  componentId: string,
  definition: RustProjectTypeDefinition,
  ownerVariant: string,
): RustSourcePackageErrorRoute | undefined {
  const ownerComponentId = plan.componentIdByDefinition.get(definition);
  if (ownerComponentId === undefined) {
    return undefined;
  }
  const consumerDomain = plan.domainsByComponentId.get(componentId);
  if (ownerComponentId === componentId || consumerDomain?.errorOwnerComponentId === ownerComponentId) {
    return Object.freeze({ kind: "local", variant: ownerVariant });
  }
  const external = consumerDomain?.externalErrors.find((candidate) =>
    candidate.errorOwnerComponentId === ownerComponentId);
  return external === undefined
    ? undefined
    : Object.freeze({
        kind: "external",
        consumerVariant: external.variant,
        ownerTypePath: external.typePath,
        ownerTransportTypePath: external.transportTypePath,
        sourceErrorTypePath: external.sourceErrorTypePath,
        writableSourceErrorTypePath: external.writableSourceErrorTypePath,
        ownerVariant,
      });
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

export function analyzeRustSourcePackageErrorBoundaries(
  program: Pick<RustAnalysisProgram, "projectTypes">,
  plan: RustSourcePackageErrorPlan,
  producer: RustSourcePackageEmissionProducer,
): void {
  producer.errors(plan);
  for (const consumer of plan.domainsByComponentId.keys()) {
    for (const owner of plan.domainsByComponentId.keys()) {
      const boundary = selectRustSourcePackageErrorBoundary(plan, consumer, owner);
      if (boundary !== undefined) producer.boundary(consumer, owner, boundary);
      const physical = selectRustPhysicalProgramErrorBoundary(plan, consumer, { kind: "physical", domain: "project", componentId: owner });
      if (physical !== undefined) producer.physicalBoundary(consumer, owner, physical);
    }
    const runtime = selectRustPhysicalProgramErrorBoundary(plan, consumer, { kind: "physical", domain: "runtime" });
    if (runtime !== undefined) producer.runtimeBoundary(consumer, runtime);
    for (const definition of program.projectTypes.programErrorDefinitions) {
      const variant = program.projectTypes.programErrorVariant(definition);
      if (variant === undefined) continue;
      const route = selectRustProgramErrorRoute(plan, consumer, definition, variant);
      if (route !== undefined) producer.route(consumer, definition, variant, route);
    }
  }
}
