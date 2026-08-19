import type { Node } from "@tsonic/tsts";
import type { TargetSourcePackage } from "@tsonic/target-api";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { isValidRustIdentifier } from "../../../policy/names/identifiers.js";
import type { RustPlanningContext } from "../context.js";
import type { RustSourceFileOutputIdentity } from "../../../analysis/program/source-output-identities.js";
import { rustModuleSegmentName } from "../../../analysis/program/source-output-identities.js";
import { rustModuleBindingFactKey } from "../../../analysis/facts/keys.js";

export interface RustSourcePackageFacadeExport {
  readonly packageId: string;
  readonly componentId: string;
  readonly sourceModuleFileName: string;
  readonly declaration: Node;
  readonly implementationFileName: string;
  readonly implementationModuleName: string;
  readonly implementationName: string;
  readonly facadeModuleSegments: readonly string[];
  readonly facadeName: string;
}

export interface RustSourcePackageFacadePlan {
  readonly rootComponentId: string;
  readonly rootExports: readonly RustSourcePackageFacadeExport[];
  readonly externalItemPathByIdentity: ReadonlyMap<string, string>;
  readonly publicTopLevelModules: ReadonlySet<string>;
  readonly publicModuleNames: ReadonlySet<string>;
  readonly publicImplementationItemIdentities: ReadonlySet<string>;
}

export function planRustSourcePackageFacades(
  input: RustPlanningContext,
  identitiesByFileName: ReadonlyMap<string, RustSourceFileOutputIdentity>,
): { readonly plan?: RustSourcePackageFacadePlan; readonly diagnostics: readonly TargetDiagnostic[] } {
  const diagnostics: TargetDiagnostic[] = [];
  const packageById = new Map(input.sourcePackages.packages.map((entry) =>
    [entry.id, entry] as const));
  const rootPackage = packageById.get(input.sourcePackages.rootPackageId);
  if (rootPackage === undefined) {
    return {
      diagnostics: [facadeDiagnostic(
        "RUST_SOURCE_PACKAGE_FACADE_ROOT_MISSING",
        "The checked source-package graph has no root package for Rust facade planning.",
      )],
    };
  }
  const sourceFileByName = new Map(input.sourceFiles.map((sourceFile) =>
    [normalizePath(input.ast.getFileName(sourceFile)), sourceFile] as const));
  const componentPackageCounts = new Map(input.sourcePackages.components.map((component) =>
    [component.id, component.packages.length] as const));
  const exports: RustSourcePackageFacadeExport[] = [];
  const facadeOwners = new Map<string, RustSourcePackageFacadeExport>();

  for (const sourcePackage of input.sourcePackages.packages) {
    for (const sourceExport of sourcePackage.exports) {
      const exportedSourceFile = sourceFileByName.get(normalizePath(sourceExport.sourceFile));
      if (exportedSourceFile === undefined) {
        diagnostics.push(facadeDiagnostic(
          "RUST_SOURCE_PACKAGE_FACADE_SOURCE_MISSING",
          `Source-package export '${sourceExport.specifier}' in '${sourcePackage.name ?? sourcePackage.id}' has no checked source file.`,
        ));
        continue;
      }
      const facadeModuleSegments = sourcePackageFacadeModuleSegments(
        sourcePackage,
        sourceExport.specifier,
        (componentPackageCounts.get(sourcePackage.componentId) ?? 0) > 1,
      );
      for (const exported of input.source.navigation.moduleExports(exportedSourceFile)) {
        const implementationFileName = input.ast.getFileName(exported.sourceFile);
        const implementationIdentity = identitiesByFileName.get(implementationFileName);
        if (implementationIdentity === undefined ||
          implementationIdentity.componentId !== sourcePackage.componentId) {
          diagnostics.push(facadeDiagnostic(
            "RUST_SOURCE_PACKAGE_FACADE_DECLARATION_IDENTITY_MISSING",
            `Export '${exported.exportName}' from '${sourceExport.specifier}' has no implementation in its exact source-package component.`,
          ));
          continue;
        }
        for (const implementationName of rustDeclarationItemNames(input, exported.declaration)) {
          const entry: RustSourcePackageFacadeExport = Object.freeze({
            packageId: sourcePackage.id,
            componentId: sourcePackage.componentId,
            sourceModuleFileName: input.ast.getFileName(exportedSourceFile),
            declaration: exported.declaration,
            implementationFileName,
            implementationModuleName: implementationIdentity.moduleName,
            implementationName,
            facadeModuleSegments,
            facadeName: implementationName,
          });
          const ownerKey = facadeExportIdentity(entry);
          const existing = facadeOwners.get(ownerKey);
          if (existing !== undefined &&
            (existing.implementationFileName !== entry.implementationFileName ||
              existing.implementationName !== entry.implementationName)) {
            diagnostics.push(facadeDiagnostic(
              "RUST_SOURCE_PACKAGE_FACADE_EXPORT_CONFLICT",
              `Rust package facade '${facadeDisplayPath(entry)}' resolves to more than one exact source declaration.`,
            ));
            continue;
          }
          if (existing === undefined) {
            facadeOwners.set(ownerKey, entry);
            exports.push(entry);
          }
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }
  exports.sort(compareFacadeExports);
  const externalItemCandidates = new Map<string, RustSourcePackageFacadeExport[]>();
  for (const exported of exports) {
    if (exported.componentId === rootPackage.componentId) {
      continue;
    }
    const key = sourceItemIdentity(exported.implementationFileName, exported.implementationName);
    const candidates = externalItemCandidates.get(key) ?? [];
    candidates.push(exported);
    externalItemCandidates.set(key, candidates);
  }
  const externalItemPathByIdentity = new Map<string, string>();
  for (const [key, candidates] of externalItemCandidates) {
    candidates.sort(compareFacadePreference);
    const selected = candidates[0]!;
    const crateName = identitiesByFileName.get(selected.implementationFileName)?.externalCrateName;
    if (crateName === undefined) {
      diagnostics.push(facadeDiagnostic(
        "RUST_SOURCE_PACKAGE_FACADE_CRATE_IDENTITY_MISSING",
        `External package facade '${facadeDisplayPath(selected)}' has no deterministic Rust crate identity.`,
      ));
      continue;
    }
    externalItemPathByIdentity.set(
      key,
      [crateName, ...selected.facadeModuleSegments, selected.facadeName].join("::"),
    );
  }
  if (diagnostics.length > 0) {
    return { diagnostics: Object.freeze(diagnostics) };
  }
  const rootExports = Object.freeze(exports.filter((entry) =>
    entry.componentId === rootPackage.componentId));
  const publicModuleNames = new Set<string>();
  for (const exported of rootExports) {
    for (let length = 1; length <= exported.facadeModuleSegments.length; length += 1) {
      publicModuleNames.add(exported.facadeModuleSegments.slice(0, length).join("::"));
    }
  }
  return {
    diagnostics: Object.freeze([]),
    plan: Object.freeze({
      rootComponentId: rootPackage.componentId,
      rootExports,
      externalItemPathByIdentity,
      publicTopLevelModules: Object.freeze(new Set([...publicModuleNames]
        .filter((name) => !name.includes("::")))),
      publicModuleNames: Object.freeze(publicModuleNames),
      publicImplementationItemIdentities: Object.freeze(new Set(rootExports.map((entry) =>
        sourceItemIdentity(entry.implementationFileName, entry.implementationName)))),
    }),
  };
}

export function rustSourceItemIdentity(fileName: string, itemName: string): string {
  return sourceItemIdentity(fileName, itemName);
}

function rustDeclarationItemNames(
  input: RustPlanningContext,
  declaration: Node,
): readonly string[] {
  const binding = input.facts.getFact(declaration, rustModuleBindingFactKey);
  const candidates = binding?.storage === "native-callable"
    ? [binding.value?.name ?? binding.name]
    : input.ast.is.IsFunctionDeclaration(declaration)
      ? [input.names.functionNameForDeclaration(declaration)]
      : [input.names.nameForDeclaration(declaration)];
  const names = new Set(candidates.filter((name): name is string =>
    name !== undefined && isValidRustIdentifier(name)));
  return Object.freeze([...names].sort(compareNames));
}

function sourcePackageFacadeModuleSegments(
  sourcePackage: TargetSourcePackage,
  specifier: string,
  packagePrefixRequired: boolean,
): readonly string[] {
  const packagePrefix = packagePrefixRequired
    ? [rustModuleSegmentName(sourcePackage.name ?? sourcePackage.id)]
    : [];
  if (specifier === "." || specifier === "./index.js" ||
    specifier === "./index.mjs" || specifier === "./index.ts" ||
    specifier === "./index.mts") {
    return Object.freeze(packagePrefix);
  }
  const withoutPrefix = specifier.startsWith("./") ? specifier.slice(2) : specifier;
  const withoutExtension = withoutPrefix.replace(/\.(?:mjs|mts|js|ts)$/u, "");
  const segments = withoutExtension.split("/")
    .filter((segment) => segment.length > 0)
    .map(rustModuleSegmentName);
  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }
  return Object.freeze([...packagePrefix, ...segments]);
}

function facadeExportIdentity(value: RustSourcePackageFacadeExport): string {
  return [
    value.componentId,
    value.facadeModuleSegments.join("::"),
    value.facadeName,
  ].map((part) => `${part.length}:${part}`).join("");
}

function sourceItemIdentity(fileName: string, itemName: string): string {
  return `${fileName.length}:${fileName}${itemName.length}:${itemName}`;
}

function facadeDisplayPath(value: RustSourcePackageFacadeExport): string {
  return [...value.facadeModuleSegments, value.facadeName].join("::");
}

function compareFacadeExports(
  left: RustSourcePackageFacadeExport,
  right: RustSourcePackageFacadeExport,
): number {
  return compareNames(left.componentId, right.componentId) ||
    compareNames(left.facadeModuleSegments.join("::"), right.facadeModuleSegments.join("::")) ||
    compareNames(left.facadeName, right.facadeName) ||
    compareNames(left.implementationFileName, right.implementationFileName) ||
    compareNames(left.implementationName, right.implementationName);
}

function compareFacadePreference(
  left: RustSourcePackageFacadeExport,
  right: RustSourcePackageFacadeExport,
): number {
  return left.facadeModuleSegments.length - right.facadeModuleSegments.length ||
    compareFacadeExports(left, right);
}

function facadeDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.backend.source-package-facade"],
  };
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
