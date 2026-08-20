import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import type { RustSourceFileOutputIdentity } from "../names/source-output-identities.js";
import { allocateRustComponentSupportModuleName } from "../names/source-output-identities.js";
import type { RustErrorDomain } from "../../target-ast/nodes.js";
import type { RustSourcePackageFacadePlan } from "./source-package-facades.js";

export interface RustSourcePackageComponentPlan {
  readonly componentId: string;
  readonly sourceFileNames: ReadonlySet<string>;
  readonly dependencyComponentIds: readonly string[];
  readonly crateName?: string;
  readonly programModuleName: string;
  readonly structuralShapesModuleName: string;
  readonly publicModuleNames: ReadonlySet<string>;
  readonly publicImplementationModuleNames: ReadonlySet<string>;
  readonly publicImplementationItemIdentities: ReadonlySet<string>;
  readonly publishesImplementationAbi: boolean;
  readonly errorDomain: RustErrorDomain;
  readonly root: boolean;
}

export function planRustSourcePackageComponents(
  input: RustPlanningContext,
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  facades: RustSourcePackageFacadePlan,
):
  | { readonly kind: "accepted"; readonly components: readonly RustSourcePackageComponentPlan[] }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const diagnostics: TargetDiagnostic[] = [];
  const componentById = new Map(input.input.sourcePackages.components.map((component) =>
    [component.id, component] as const));
  if (!componentById.has(facades.rootComponentId)) {
    return rejected(
      "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING",
      "The exact root source-package component is absent from the checked component graph.",
    );
  }
  const order: string[] = [];
  const activeComponentIds = new Set(
    [...identities.values()].map((identity) => identity.componentId),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (componentId: string): void => {
    if (visited.has(componentId) || diagnostics.length > 0) {
      return;
    }
    if (visiting.has(componentId)) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_GRAPH_CYCLE",
        `Source-package component '${componentId}' participates in a cycle outside one compiler-owned component.`,
      ));
      return;
    }
    const component = componentById.get(componentId);
    if (component === undefined) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_DEPENDENCY_MISSING",
        `Source-package component '${componentId}' is referenced but absent from the checked component graph.`,
      ));
      return;
    }
    visiting.add(componentId);
    for (const dependency of [...component.dependencies]
      .filter((candidate) => activeComponentIds.has(candidate))
      .sort(compareNames)) {
      visit(dependency);
    }
    visiting.delete(componentId);
    visited.add(componentId);
    order.push(componentId);
  };
  visit(facades.rootComponentId);
  for (const componentId of [...activeComponentIds].sort(compareNames)) {
    visit(componentId);
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }

  const componentByFileName = new Map([...identities].map(([fileName, identity]) =>
    [fileName, identity.componentId] as const));
  const errorComponents = new Set(input.program.projectTypes.programErrorDefinitions.flatMap((definition) => {
    const componentId = componentByFileName.get(definition.fileName);
    return componentId === undefined ? [] : [componentId];
  }));
  const reachesError = new Map<string, boolean>();
  const componentReachesError = (componentId: string): boolean => {
    const existing = reachesError.get(componentId);
    if (existing !== undefined) {
      return existing;
    }
    const component = componentById.get(componentId);
    if (component === undefined || !activeComponentIds.has(componentId)) {
      return false;
    }
    const value = errorComponents.has(componentId) ||
      component.dependencies
        .filter((dependency) => activeComponentIds.has(dependency))
        .some(componentReachesError);
    reachesError.set(componentId, value);
    return value;
  };
  const plans: RustSourcePackageComponentPlan[] = [];
  for (const componentId of order) {
    const componentIdentities = [...identities.values()].filter((identity) =>
      identity.componentId === componentId);
    const root = componentId === facades.rootComponentId;
    const dependencyComponentIds = Object.freeze([...componentById.get(componentId)!
      .dependencies]
      .filter((candidate) => activeComponentIds.has(candidate))
      .sort(compareNames));
    const crateNames = new Set(componentIdentities.flatMap((identity) =>
      identity.externalCrateName === undefined ? [] : [identity.externalCrateName]));
    if (!root && crateNames.size !== 1) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_CRATE_IDENTITY_INVALID",
        `External source-package component '${componentId}' does not resolve to one exact Rust crate identity.`,
      ));
      continue;
    }
    const structuralShapesModuleName = allocateRustComponentSupportModuleName(
      identities,
      componentId,
      "shapes",
    );
    const programModuleName = allocateRustComponentSupportModuleName(
      identities,
      componentId,
      "program",
      [structuralShapesModuleName],
    );
    const publishesImplementationAbi = !root || input.program.configuration.outputType === "lib";
    const publicImplementationModuleNames = publishesImplementationAbi
      ? allModuleAncestors(componentIdentities.map((identity) => identity.moduleName))
      : Object.freeze(new Set<string>());
    plans.push(Object.freeze({
      componentId,
      sourceFileNames: Object.freeze(new Set(componentIdentities.map((identity) =>
        identity.fileName))),
      dependencyComponentIds,
      ...(root ? {} : { crateName: [...crateNames][0]! }),
      programModuleName,
      structuralShapesModuleName,
      publicModuleNames: facades.publicModuleNamesByComponent.get(componentId) ??
        Object.freeze(new Set<string>()),
      publicImplementationModuleNames,
      publicImplementationItemIdentities:
        facades.publicImplementationItemIdentitiesByComponent.get(componentId) ??
          Object.freeze(new Set<string>()),
      publishesImplementationAbi,
      errorDomain: componentReachesError(componentId) ? "project" : "runtime",
      root,
    }));
  }
  return diagnostics.length === 0
    ? { kind: "accepted", components: Object.freeze(plans) }
    : { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
}

function allModuleAncestors(moduleNames: readonly string[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const moduleName of moduleNames) {
    const segments = moduleName.split("::");
    for (let length = 1; length <= segments.length; length += 1) {
      result.add(segments.slice(0, length).join("::"));
    }
  }
  return Object.freeze(result);
}

function rejected(
  code: string,
  message: string,
): { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  return { kind: "rejected", diagnostics: [componentDiagnostic(code, message)] };
}

function componentDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.backend.source-package-components"],
  };
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
