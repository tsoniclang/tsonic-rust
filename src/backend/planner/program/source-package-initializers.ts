import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import {
  allocateRustComponentSupportModuleName,
  type RustSourceFileOutputIdentity,
} from "../names/source-output-identities.js";
import type { RustPlanningContext } from "../context.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";

export interface RustSourcePackageModuleInitializer {
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly componentId: string;
  readonly crateName?: string;
  readonly implementationModuleName: string;
  readonly implementationFunctionName: string;
  readonly facadeModuleName: string;
  readonly facadeFunctionName: string;
  readonly asynchronous: boolean;
  readonly fallible: boolean;
}

export interface RustSourcePackageInitializerPlan {
  readonly byFileName: ReadonlyMap<string, RustSourcePackageModuleInitializer>;
  readonly facadeModuleNameByComponent: ReadonlyMap<string, string>;
}

export function planRustSourcePackageInitializers(
  input: RustPlanningContext,
  identitiesByFileName: ReadonlyMap<string, RustSourceFileOutputIdentity>,
): {
  readonly plan?: RustSourcePackageInitializerPlan;
  readonly diagnostics: readonly TargetDiagnostic[];
} {
  const diagnostics: TargetDiagnostic[] = [];
  const facadeModuleNameByComponent = new Map<string, string>();
  for (const component of input.input.sourcePackages.components) {
    const shapesName = allocateRustComponentSupportModuleName(
      identitiesByFileName,
      component.id,
      "shapes",
    );
    const programName = allocateRustComponentSupportModuleName(
      identitiesByFileName,
      component.id,
      "program",
      [shapesName],
    );
    facadeModuleNameByComponent.set(
      component.id,
      allocateRustComponentSupportModuleName(
        identitiesByFileName,
        component.id,
        "initializers",
        [shapesName, programName],
      ),
    );
  }

  const pending: Omit<RustSourcePackageModuleInitializer, "facadeFunctionName">[] = [];
  for (const sourceFile of input.program.sourceFiles) {
    const fileName = input.program.source.ast.getFileName(sourceFile);
    const identity = identitiesByFileName.get(fileName);
    if (identity === undefined) {
      diagnostics.push(initializerDiagnostic(
        "RUST_SOURCE_PACKAGE_INITIALIZER_IDENTITY_MISSING",
        `Source module '${fileName}' has no exact Rust source-package output identity.`,
      ));
      continue;
    }
    const requirement = input.program.moduleInitialization.requirementFor(sourceFile);
    if (requirement.kind === "unresolved") {
      diagnostics.push({
        ...initializerDiagnostic(
          "RUST_SOURCE_PACKAGE_INITIALIZER_FACT_MISSING",
          requirement.reason,
        ),
        sourceNode: requirement.node,
      });
      continue;
    }
    if (requirement.kind === "not-required") {
      continue;
    }
    const facadeModuleName = facadeModuleNameByComponent.get(identity.componentId);
    if (facadeModuleName === undefined) {
      diagnostics.push(initializerDiagnostic(
        "RUST_SOURCE_PACKAGE_INITIALIZER_COMPONENT_MISSING",
        `Source module '${fileName}' has no exact source-package component initializer identity.`,
      ));
      continue;
    }
    pending.push({
      sourceFile,
      fileName,
      componentId: identity.componentId,
      ...(identity.externalCrateName === undefined
        ? {}
        : { crateName: identity.externalCrateName }),
      implementationModuleName: identity.moduleName,
      implementationFunctionName: rustModuleInitializerFunctionName(input, sourceFile),
      facadeModuleName,
      asynchronous: input.program.source.navigation.moduleHasTopLevelAwait(sourceFile),
      fallible: input.program.facts.getFact(sourceFile, rustFallibleFactKey) !== undefined,
    });
  }
  if (diagnostics.length > 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }

  const byFileName = new Map<string, RustSourcePackageModuleInitializer>();
  const usedNamesByComponent = new Map<string, Set<string>>();
  pending.sort((left, right) => compareNames(left.componentId, right.componentId) ||
    compareNames(left.implementationModuleName, right.implementationModuleName) ||
    compareNames(left.fileName, right.fileName));
  for (const initializer of pending) {
    const usedNames = usedNamesByComponent.get(initializer.componentId) ?? new Set<string>();
    usedNamesByComponent.set(initializer.componentId, usedNames);
    const baseName = initializerFacadeFunctionBase(initializer.implementationModuleName);
    let facadeFunctionName = baseName;
    let suffix = 2;
    while (usedNames.has(facadeFunctionName)) {
      facadeFunctionName = `${baseName}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(facadeFunctionName);
    byFileName.set(initializer.fileName, Object.freeze({
      ...initializer,
      facadeFunctionName,
    }));
  }
  return {
    diagnostics: Object.freeze([]),
    plan: Object.freeze({
      byFileName: new Map(byFileName),
      facadeModuleNameByComponent: new Map(facadeModuleNameByComponent),
    }),
  };
}

export function rustModuleInitializerFunctionName(
  input: RustPlanningContext,
  sourceFile: SourceFile,
): string {
  return allocateRustSyntheticName(
    createRustSyntheticNameState(input.program.source.ast, sourceFile, []),
    "module_init",
  );
}

function initializerFacadeFunctionBase(moduleName: string): string {
  const readable = `${moduleName.split("::").join("__")}__initialize`
    .replace(/[^A-Za-z0-9_]/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "initialize_module";
  return /^[0-9]/u.test(readable) ? `module_${readable}` : readable;
}

function initializerDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.backend.source-package-initialization"],
  };
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
