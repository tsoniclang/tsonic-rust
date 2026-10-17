import type {
  TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import type {
  RustErrorDomain,
} from "../../../target-model/operations/error-boundary.js";
import type {
  RustPlanningContext,
} from "../context.js";
import type {
  RustSourceFileOutputIdentity,
} from "../../../target-model/names/source-output-identities.js";
import type {
  RustSourcePackageFacadePlan,
} from "./source-package-facades.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/error-regions.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export interface RustSourcePackageComponentPlan {
  readonly componentId: string;
  readonly sourceFileNames: ReadonlySet<string>;
  readonly dependencyComponentIds: readonly string[];
  readonly crateName?: string;
  readonly programModuleName: string;
  readonly structuralShapesModuleName: string;
  readonly initializerFacadeModuleName: string;
  readonly crateInitializerFunctionBase: string;
  readonly publicModuleNames: ReadonlySet<string>;
  readonly publicImplementationModuleNames: ReadonlySet<string>;
  readonly publicImplementationItemIdentities: ReadonlySet<string>;
  readonly publishesImplementationAbi: boolean;
  readonly errorDomain: RustErrorDomain;
  readonly errorOwnerComponentId: string | undefined;
  readonly root: boolean;
}

export function createRustSourcePackageTypeRenderingContext(
  input: RustPlanningContext,
  component: RustSourcePackageComponentPlan,
  sourcePackageErrors: RustSourcePackageErrorPlan,
  paths: Pick<RustTypeRenderingContext, "moduleNameByFileName" | "externalCrateNameByFileName" |
    "externalItemPathByIdentity" | "externalStructuralShapeModuleByFileName">,
): RustTypeRenderingContext & { readonly input: RustPlanningContext } {
  return {
    input, ...paths, sourcePackageErrors, sourcePackageComponentId: component.componentId,
    moduleName: component.programModuleName, structuralShapesModuleName: component.structuralShapesModuleName,
    ...(component.crateName === undefined ? {} : { crateName: component.crateName }),
  };
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
  for (const component of classifications.components) {
    const componentIdentities = [...identities.values()].filter((identity) =>
      identity.componentId === component.componentId);
    const publicImplementationModuleNames =
      component.publishesImplementationAbi
        ? allModuleAncestors(componentIdentities.map((identity) =>
            identity.moduleName))
        : Object.freeze(new Set<string>());
    plans.push(Object.freeze({
      componentId: component.componentId,
      sourceFileNames: Object.freeze(new Set(component.sourceFileNames)),
      dependencyComponentIds: input.program.errorTransport.dependencyComponentIdsFor(component.componentId) ??
        failRustPlannerInvariant("An admitted source-package component lost its selected native dependency identities."),
      ...(component.crateName === undefined ? {} : { crateName: component.crateName }),
      programModuleName: component.programModuleName,
      structuralShapesModuleName: component.structuralShapesModuleName,
      initializerFacadeModuleName: component.initializerFacadeModuleName,
      crateInitializerFunctionBase: component.crateInitializerFunctionBase,
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
      errorOwnerComponentId: component.errorOwnerComponentId,
      root: component.root,
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
