import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { rustPascalCaseIdentifier } from "../../../policy/names/identifiers.js";
import {
  allocateRustComponentSupportModuleName,
  type RustSourceFileOutputIdentity,
} from "../../../analysis/program/source-output-identities.js";
import type { RustPlanningContext } from "../context.js";

export interface RustExternalSourcePackageError {
  readonly componentId: string;
  readonly crateName: string;
  readonly typePath: string;
  readonly preferredVariantName: string;
}

export function planRustExternalSourcePackageErrors(
  input: RustPlanningContext,
  identitiesByFileName: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  rootComponentId: string,
): {
  readonly errors: readonly RustExternalSourcePackageError[];
  readonly diagnostics: readonly TargetDiagnostic[];
} {
  const diagnostics: TargetDiagnostic[] = [];
  const componentByFileName = new Map(input.sourcePackages.packages.flatMap((sourcePackage) =>
    sourcePackage.sourceFiles.map((fileName) => [fileName, sourcePackage.componentId] as const)));
  const componentsWithProjectErrors = new Set(input.projectTypes.programErrorDefinitions
    .flatMap((definition) => {
      const componentId = componentByFileName.get(definition.fileName);
      return componentId === undefined || componentId === rootComponentId ? [] : [componentId];
    }));
  const errors: RustExternalSourcePackageError[] = [];
  for (const componentId of [...componentsWithProjectErrors].sort(compareNames)) {
    const componentIdentities = [...identitiesByFileName.values()].filter((identity) =>
      identity.componentId === componentId);
    const crateName = componentIdentities.find((identity) =>
      identity.externalCrateName !== undefined)?.externalCrateName;
    if (crateName === undefined) {
      diagnostics.push({
        code: "RUST_EXTERNAL_SOURCE_PACKAGE_ERROR_CRATE_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `External source-package component '${componentId}' owns project errors but has no exact Rust crate identity.`,
        evidence: ["target.capability=rust.error.source-package-conversion"],
      });
      continue;
    }
    const shapesModuleName = allocateRustComponentSupportModuleName(
      identitiesByFileName,
      componentId,
      "shapes",
    );
    const programModuleName = allocateRustComponentSupportModuleName(
      identitiesByFileName,
      componentId,
      "program",
      [shapesModuleName],
    );
    errors.push(Object.freeze({
      componentId,
      crateName,
      typePath: `${crateName}::${programModuleName}::TsonicError`,
      preferredVariantName: `${rustPascalCaseIdentifier(crateName)}Error`,
    }));
  }
  return {
    errors: Object.freeze(errors),
    diagnostics: Object.freeze(diagnostics),
  };
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
