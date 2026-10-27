import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourcePackageComponentPlan, RustSourcePackageInitializerPlan, RustSourcePackageModuleInitializer } from "../../target-model/records/program/source-packages.js";
import { allocateRustComponentSupportModuleName } from "../../policy/identities/support-modules.js";
import type { RustSourceFileOutputIdentity } from "../../target-model/names/source-output-identities.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import { rustTargetIdentifier } from "../../target-model/names/identifiers.js";
export function analyzeRustSourcePackageInitializers(
  program: Pick<RustAnalysisProgram, "source" | "sourceFiles" | "sourcePackageComponents" | "moduleInitialization" | "errorRegions">,
  components: readonly RustSourcePackageComponentPlan[],
  identitiesByFileName: ReadonlyMap<string, RustSourceFileOutputIdentity>,
): {
  readonly plan?: RustSourcePackageInitializerPlan;
  readonly diagnostics: readonly TargetDiagnostic[];
} {
  const diagnostics: TargetDiagnostic[] = [];
  const functionNameByFileName = new Map<string, string>();
  const facadeModuleNameByComponent = new Map<string, string>();
  for (const component of components) {
    const shapesName = component.structuralShapesModuleName;
    const programName = component.programModuleName;
    facadeModuleNameByComponent.set(
      component.componentId,
      allocateRustComponentSupportModuleName(
        identitiesByFileName,
        component.componentId,
        "initializers",
        [shapesName, programName],
      ),
    );
  }

  const pending: Omit<RustSourcePackageModuleInitializer, "facadeFunctionName">[] = [];
  for (const sourceFile of program.sourceFiles) {
    const fileName = program.source.ast.getFileName(sourceFile);
    const functionName = moduleInitializerFunctionName(program.source.ast, sourceFile);
    functionNameByFileName.set(fileName, functionName);
    const identity = identitiesByFileName.get(fileName);
    if (identity === undefined) {
      diagnostics.push(initializerDiagnostic(
        "RUST_SOURCE_PACKAGE_INITIALIZER_IDENTITY_MISSING",
        `Source module '${fileName}' has no exact Rust source-package output identity.`,
      ));
      continue;
    }
    const requirement = program.moduleInitialization.requirementFor(sourceFile);
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
    const selected = program.errorRegions.initialization.moduleFor(sourceFile);
    if (selected === undefined) {
      failTargetAnalysisInvariant("tsonic-rust", 
        `Source module '${fileName}' has no exact finalized initializer error effects.`,
        sourceFile);
    }
    pending.push({
      sourceFile,
      fileName,
      componentId: identity.componentId,
      ...(identity.externalCrateName === undefined
        ? {}
        : { crateName: identity.externalCrateName }),
      implementationModuleName: identity.moduleName,
      implementationFunctionName: functionName,
      facadeModuleName,
      asynchronous: selected.asynchronous,
      errorRegion: selected.region,
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
      functionNameByFileName,
      byFileName: new Map(byFileName),
      facadeModuleNameByComponent: new Map(facadeModuleNameByComponent),
    }),
  };
}

function moduleInitializerFunctionName(ast: AstReader, sourceFile: SourceFile): string {
  const reserved = new Set<string>();
  const visit = (node: Node): void => {
    if (ast.is.IsIdentifier(node)) {
      const name = ast.text(node);
      reserved.add(name);
      reserved.add(rustTargetIdentifier(name));
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(sourceFile);
  return allocateRustGeneratedName(reserved, "module_init");
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
