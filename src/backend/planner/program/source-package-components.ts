import type {
  TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import type {
  RustErrorDomain,
} from "../../../target-model/operations/error-boundary.js";
import type {
  RustPlanningContext,
} from "../context.js";
import {
  allocateRustComponentSupportModuleName,
} from "../names/source-output-identities.js";
import type {
  RustSourceFileOutputIdentity,
} from "../names/source-output-identities.js";
import type {
  RustSourcePackageFacadePlan,
} from "./source-package-facades.js";

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
  | {
      readonly kind: "accepted";
      readonly components: readonly RustSourcePackageComponentPlan[];
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    } {
  const diagnostics: TargetDiagnostic[] = [];
  const classifications = input.program.sourcePackageComponents;
  if (classifications.rootComponentId !== facades.rootComponentId) {
    return rejected(
      "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISMATCH",
      "The sealed source-package component graph and facade contract disagree on the root component.",
    );
  }

  const plans: RustSourcePackageComponentPlan[] = [];
  const componentIdByFileName = new Map(classifications.components.flatMap(
    (component) => component.sourceFileNames.map((fileName) =>
      [fileName, component.componentId] as const),
  ));
  const sourceModuleDependenciesByComponent = new Map<string, Set<string>>();
  for (const construction of input.program.sourceModuleConstructions.entries()) {
    const sourceComponentId = componentIdByFileName.get(
      input.program.source.ast.getFileName(construction.sourceFile),
    );
    const targetComponentId = componentIdByFileName.get(
      input.program.source.ast.getFileName(construction.targetSourceFile),
    );
    if (sourceComponentId === undefined || targetComponentId === undefined) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_MODULE_COMPONENT_IDENTITY_MISSING",
        "A selected source-module construction has no exact source-package component identity.",
      ));
      continue;
    }
    if (sourceComponentId !== targetComponentId) {
      const dependencies = sourceModuleDependenciesByComponent.get(sourceComponentId) ??
        new Set<string>();
      dependencies.add(targetComponentId);
      sourceModuleDependenciesByComponent.set(sourceComponentId, dependencies);
    }
  }
  for (const component of classifications.components) {
    const componentIdentities = [...identities.values()].filter((identity) =>
      identity.componentId === component.componentId);
    const physicalSourceFileNames = new Set(componentIdentities.map((identity) =>
      identity.fileName));
    if (!setsEqual(
      physicalSourceFileNames,
      new Set(component.sourceFileNames),
    )) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_IDENTITY_MISMATCH",
        `Physical module identities for source-package component '${component.componentId}' do not match its sealed source files.`,
      ));
      continue;
    }
    const crateNames = new Set(componentIdentities.flatMap((identity) =>
      identity.externalCrateName === undefined
        ? []
        : [identity.externalCrateName]));
    if (!component.root && crateNames.size !== 1) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_CRATE_IDENTITY_INVALID",
        `External source-package component '${component.componentId}' does not resolve to one exact Rust crate identity.`,
      ));
      continue;
    }
    const structuralShapesModuleName = allocateRustComponentSupportModuleName(
      identities,
      component.componentId,
      "shapes",
    );
    const programModuleName = allocateRustComponentSupportModuleName(
      identities,
      component.componentId,
      "program",
      [structuralShapesModuleName],
    );
    const publicImplementationModuleNames =
      component.publishesImplementationAbi
        ? allModuleAncestors(componentIdentities.map((identity) =>
            identity.moduleName))
        : Object.freeze(new Set<string>());
    plans.push(Object.freeze({
      componentId: component.componentId,
      sourceFileNames: Object.freeze(new Set(component.sourceFileNames)),
      dependencyComponentIds: Object.freeze([...new Set([
        ...component.dependencyComponentIds,
        ...(sourceModuleDependenciesByComponent.get(component.componentId) ?? []),
      ])].sort((left, right) => left.localeCompare(right, "en"))),
      ...(component.root ? {} : { crateName: [...crateNames][0]! }),
      programModuleName,
      structuralShapesModuleName,
      publicModuleNames: facades.publicModuleNamesByComponent.get(
        component.componentId,
      ) ?? Object.freeze(new Set<string>()),
      publicImplementationModuleNames,
      publicImplementationItemIdentities:
        facades.publicImplementationItemIdentitiesByComponent.get(
          component.componentId,
        ) ?? Object.freeze(new Set<string>()),
      publishesImplementationAbi: component.publishesImplementationAbi,
      errorDomain: component.errorDomain,
      root: component.root,
    }));
  }
  return diagnostics.length === 0
    ? { kind: "accepted", components: Object.freeze(plans) }
    : { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
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
): {
  readonly kind: "rejected";
  readonly diagnostics: readonly TargetDiagnostic[];
} {
  return {
    kind: "rejected",
    diagnostics: Object.freeze([componentDiagnostic(code, message)]),
  };
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
