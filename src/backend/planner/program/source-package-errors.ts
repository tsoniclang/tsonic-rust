import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import { rustPascalCaseIdentifier } from "../../../target-model/names/identifiers.js";
import type { RustPlanningContext } from "../context.js";
import type { RustSourcePackageComponentPlan } from "./source-package-components.js";
import type {
  RustErrorDomain,
} from "../../../target-model/operations/error-boundary.js";

export interface RustExternalSourcePackageError {
  readonly componentId: string;
  readonly crateName: string;
  readonly typePath: string;
  readonly variant: string;
}

export interface RustSourcePackageErrorDomainPlan {
  readonly componentId: string;
  readonly errorDomain: RustErrorDomain;
  readonly definitions: readonly RustProjectTypeDefinition[];
  readonly externalErrors: readonly RustExternalSourcePackageError[];
}

export interface RustSourcePackageErrorPlan {
  readonly componentIdByFileName: ReadonlyMap<string, string>;
  readonly componentIdByDefinition: ReadonlyMap<RustProjectTypeDefinition, string>;
  readonly domainsByComponentId: ReadonlyMap<string, RustSourcePackageErrorDomainPlan>;
}

export interface RustSourcePackageErrorBoundary {
  readonly componentId: string;
  readonly errorDomain: RustErrorDomain;
  readonly errorTypePath: string;
  readonly errorTypeIdentity: string;
}

export const rustRuntimeErrorTypeIdentity = "tsonic-rust-runtime:TsonicError";

export function rustSourcePackageErrorTypeIdentity(
  componentId: string,
  errorDomain: RustErrorDomain,
): string {
  return errorDomain === "runtime"
    ? rustRuntimeErrorTypeIdentity
    : `tsonic-source-package:${componentId}:TsonicError`;
}

export type RustProgramErrorRoute =
  | {
      readonly kind: "local";
      readonly variant: string;
    }
  | {
      readonly kind: "external";
      readonly consumerVariant: string;
      readonly ownerTypePath: string;
      readonly ownerVariant: string;
    };

export function planRustSourcePackageErrors(
  input: RustPlanningContext,
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
  for (const definition of input.program.projectTypes.programErrorDefinitions) {
    const componentId = componentIdByFileName.get(definition.fileName);
    if (componentId === undefined) {
      diagnostics.push(errorPlanDiagnostic(
        "RUST_PROJECT_ERROR_SOURCE_PACKAGE_MISSING",
        `Project error '${definition.sourceName}' has no exact source-package component identity.`,
        definition,
      ));
      continue;
    }
    const variant = input.program.projectTypes.programErrorVariant(definition);
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
  for (const component of components) {
    const definitions = Object.freeze([
      ...(definitionsByComponentId.get(component.componentId) ?? []),
    ]);
    const usedVariantNames = new Set([
      "Runtime",
      "Suppressed",
      ...definitions.map((definition) => input.program.projectTypes.programErrorVariant(definition)!),
    ]);
    const externalErrors: RustExternalSourcePackageError[] = [];
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
      if (dependency.crateName === undefined) {
        diagnostics.push(errorPlanDiagnostic(
          "RUST_EXTERNAL_SOURCE_PACKAGE_ERROR_CRATE_MISSING",
          `External source-package component '${dependencyComponentId}' has a project error domain but no exact Rust crate identity.`,
        ));
        continue;
      }
      const preferredVariantName = `${rustPascalCaseIdentifier(dependency.crateName)}Error`;
      const variant = allocateVariantName(preferredVariantName, usedVariantNames);
      externalErrors.push(Object.freeze({
        componentId: dependencyComponentId,
        crateName: dependency.crateName,
        typePath: `${dependency.crateName}::${dependency.programModuleName}::TsonicError`,
        variant,
      }));
    }
    domainsByComponentId.set(component.componentId, Object.freeze({
      componentId: component.componentId,
      errorDomain: component.errorDomain,
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
    }),
    diagnostics: Object.freeze([]),
  };
}

export function resolveRustSourcePackageErrorBoundary(
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
      errorTypeIdentity: rustSourcePackageErrorTypeIdentity(
        ownerComponentId,
        ownerDomain.errorDomain,
      ),
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
  const external = plan.domainsByComponentId.get(consumerComponentId)
    ?.externalErrors.find((candidate) => candidate.componentId === ownerComponentId);
  return external === undefined
    ? undefined
    : Object.freeze({
        componentId: ownerComponentId,
        errorDomain: "project",
        errorTypePath: external.typePath,
        errorTypeIdentity: rustSourcePackageErrorTypeIdentity(
          ownerComponentId,
          "project",
        ),
      });
}

export function resolveRustProgramErrorRoute(
  plan: RustSourcePackageErrorPlan,
  componentId: string,
  definition: RustProjectTypeDefinition,
  ownerVariant: string,
): RustProgramErrorRoute | undefined {
  const ownerComponentId = plan.componentIdByDefinition.get(definition);
  if (ownerComponentId === undefined) {
    return undefined;
  }
  if (ownerComponentId === componentId) {
    return Object.freeze({ kind: "local", variant: ownerVariant });
  }
  const consumerDomain = plan.domainsByComponentId.get(componentId);
  const external = consumerDomain?.externalErrors.find((candidate) =>
    candidate.componentId === ownerComponentId);
  return external === undefined
    ? undefined
    : Object.freeze({
        kind: "external",
        consumerVariant: external.variant,
        ownerTypePath: external.typePath,
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
