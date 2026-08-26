import type { Node } from "@tsonic/tsts";
import type {
  TargetSourcePackage,
} from "@tsonic/target-api";
import type {
  TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import {
  isValidRustIdentifier,
  rustModuleSegmentName,
} from "../../target-model/names/identifiers.js";
import {
  rustModuleBindingFactKey,
  rustTypeAliasDeclarationFactKey,
} from "../facts/keys.js";
import type {
  RustAnalysisContext,
} from "./context.js";

export interface RustSourcePackageFacadeExportContract {
  readonly packageId: string;
  readonly componentId: string;
  readonly sourceModuleFileName: string;
  readonly declaration: Node;
  readonly implementationFileName: string;
  readonly implementationName: string;
  readonly facadeModuleSegments: readonly string[];
  readonly facadeName: string;
}

export interface RustSourcePackageFacadeClassifications {
  readonly rootComponentId: string;
  readonly componentIds: readonly string[];
  readonly rootExports: readonly RustSourcePackageFacadeExportContract[];
  exportsForComponent(
    componentId: string,
  ): readonly RustSourcePackageFacadeExportContract[];
  publicModuleNamesForComponent(componentId: string): readonly string[];
  publicImplementationItemIdentitiesForComponent(
    componentId: string,
  ): readonly string[];
}

export type AnalyzeRustSourcePackageFacadesResult =
  | {
      readonly kind: "resolved";
      readonly plan: RustSourcePackageFacadeClassifications;
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    };

export function analyzeRustSourcePackageFacades(
  context: RustAnalysisContext,
): AnalyzeRustSourcePackageFacadesResult {
  const diagnostics: TargetDiagnostic[] = [];
  const sourcePackages = context.sourcePackages;
  const packageById = new Map(sourcePackages.packages.map((entry) =>
    [entry.id, entry] as const));
  const rootPackage = packageById.get(sourcePackages.rootPackageId);
  if (rootPackage === undefined) {
    return rejected(
      "RUST_SOURCE_PACKAGE_FACADE_ROOT_MISSING",
      "The checked source-package graph has no root package for Rust facade analysis.",
    );
  }
  const sourceFileByName = new Map(context.sourceFiles.map((sourceFile) =>
    [normalizePath(context.ast.getFileName(sourceFile)), sourceFile] as const));
  const componentByFileName = new Map(sourcePackages.packages.flatMap((entry) =>
    entry.sourceFiles.map((fileName) =>
      [normalizePath(fileName), entry.componentId] as const)));
  const componentPackageCounts = new Map(sourcePackages.components.map((component) =>
    [component.id, component.packages.length] as const));
  const exports: RustSourcePackageFacadeExportContract[] = [];
  const facadeOwners = new Map<string, RustSourcePackageFacadeExportContract>();

  for (const sourcePackage of sourcePackages.packages) {
    for (const sourceExport of sourcePackage.exports) {
      const exportedSourceFile = sourceFileByName.get(
        normalizePath(sourceExport.sourceFile),
      );
      if (exportedSourceFile === undefined) {
        continue;
      }
      const facadeModuleSegments = sourcePackageFacadeModuleSegments(
        sourcePackage,
        sourceExport.specifier,
        (componentPackageCounts.get(sourcePackage.componentId) ?? 0) > 1,
      );
      for (const exported of context.source.navigation.moduleExports(
        exportedSourceFile,
      )) {
        const implementationFileName = context.ast.getFileName(
          exported.sourceFile,
        );
        if (
          componentByFileName.get(normalizePath(implementationFileName)) !==
            sourcePackage.componentId
        ) {
          diagnostics.push(facadeDiagnostic(
            "RUST_SOURCE_PACKAGE_FACADE_DECLARATION_IDENTITY_MISSING",
            `Export '${exported.exportName}' from '${sourceExport.specifier}' has no implementation in its exact source-package component.`,
          ));
          continue;
        }
        for (const implementationName of rustDeclarationItemNames(
          context,
          exported.declaration,
        )) {
          const entry: RustSourcePackageFacadeExportContract = Object.freeze({
            packageId: sourcePackage.id,
            componentId: sourcePackage.componentId,
            sourceModuleFileName: context.ast.getFileName(exportedSourceFile),
            declaration: exported.declaration,
            implementationFileName,
            implementationName,
            facadeModuleSegments,
            facadeName: implementationName,
          });
          const ownerKey = facadeExportIdentity(entry);
          const existing = facadeOwners.get(ownerKey);
          if (
            existing !== undefined &&
            (
              existing.implementationFileName !== entry.implementationFileName ||
              existing.implementationName !== entry.implementationName
            )
          ) {
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
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }

  exports.sort(compareFacadeExports);
  const rootExports = Object.freeze(exports.filter((entry) =>
    entry.componentId === rootPackage.componentId));
  const exportsByComponentId = new Map(sourcePackages.components.map((component) =>
    [component.id, Object.freeze(exports.filter((entry) =>
      entry.componentId === component.id))] as const));
  const publicModuleNamesByComponent = new Map<string, readonly string[]>();
  const publicImplementationItemIdentitiesByComponent = new Map<
    string,
    readonly string[]
  >();
  for (const component of sourcePackages.components) {
    const componentExports = exports.filter((entry) =>
      entry.componentId === component.id);
    const moduleNames = new Set<string>();
    for (const exported of componentExports) {
      for (
        let length = 1;
        length <= exported.facadeModuleSegments.length;
        length += 1
      ) {
        moduleNames.add(
          exported.facadeModuleSegments.slice(0, length).join("::"),
        );
      }
    }
    publicModuleNamesByComponent.set(
      component.id,
      Object.freeze([...moduleNames].sort(compareNames)),
    );
    publicImplementationItemIdentitiesByComponent.set(
      component.id,
      Object.freeze([...new Set(componentExports.map((entry) =>
        rustSourceItemIdentity(
          entry.implementationFileName,
          entry.implementationName,
        )))].sort(compareNames)),
    );
  }
  const plan: RustSourcePackageFacadeClassifications = {
    rootComponentId: rootPackage.componentId,
    componentIds: Object.freeze(sourcePackages.components
      .map((component) => component.id)
      .sort(compareNames)),
    rootExports,
    exportsForComponent(componentId: string) {
      return exportsByComponentId.get(componentId) ?? emptyExports;
    },
    publicModuleNamesForComponent(componentId: string) {
      return publicModuleNamesByComponent.get(componentId) ?? emptyNames;
    },
    publicImplementationItemIdentitiesForComponent(componentId: string) {
      return publicImplementationItemIdentitiesByComponent.get(componentId) ??
        emptyNames;
    },
  };
  return {
    kind: "resolved",
    plan: Object.freeze(plan),
  };
}

const emptyExports: readonly RustSourcePackageFacadeExportContract[] =
  Object.freeze([]);
const emptyNames: readonly string[] = Object.freeze([]);

export function rustSourceItemIdentity(
  fileName: string,
  itemName: string,
): string {
  return `${fileName.length}:${fileName}${itemName.length}:${itemName}`;
}

function rustDeclarationItemNames(
  context: RustAnalysisContext,
  declaration: Node,
): readonly string[] {
  if (
    context.ast.kindName(declaration) === "KindTypeAliasDeclaration" &&
    context.facts.getFact(declaration, rustTypeAliasDeclarationFactKey)?.kind ===
      "erased"
  ) {
    return emptyNames;
  }
  const binding = context.facts.getFact(declaration, rustModuleBindingFactKey);
  const candidates = binding?.storage === "native-callable"
    ? [binding.value?.name ?? binding.name]
    : context.ast.is.IsFunctionDeclaration(declaration)
      ? [context.names.functionNameForDeclaration(declaration)]
      : [context.names.nameForDeclaration(declaration)];
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
  if (
    specifier === "." ||
    specifier === "./index.js" ||
    specifier === "./index.mjs" ||
    specifier === "./index.ts" ||
    specifier === "./index.mts"
  ) {
    return Object.freeze(packagePrefix);
  }
  const withoutPrefix = specifier.startsWith("./")
    ? specifier.slice(2)
    : specifier;
  const withoutExtension = withoutPrefix.replace(/\.(?:mjs|mts|js|ts)$/u, "");
  const segments = withoutExtension.split("/")
    .filter((segment) => segment.length > 0)
    .map(rustModuleSegmentName);
  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }
  return Object.freeze([...packagePrefix, ...segments]);
}

function facadeExportIdentity(
  value: RustSourcePackageFacadeExportContract,
): string {
  return [
    value.componentId,
    value.facadeModuleSegments.join("::"),
    value.facadeName,
  ].map((part) => `${part.length}:${part}`).join("");
}

function facadeDisplayPath(
  value: RustSourcePackageFacadeExportContract,
): string {
  return [...value.facadeModuleSegments, value.facadeName].join("::");
}

function compareFacadeExports(
  left: RustSourcePackageFacadeExportContract,
  right: RustSourcePackageFacadeExportContract,
): number {
  return compareNames(left.componentId, right.componentId) ||
    compareNames(
      left.facadeModuleSegments.join("::"),
      right.facadeModuleSegments.join("::"),
    ) ||
    compareNames(left.facadeName, right.facadeName) ||
    compareNames(left.implementationFileName, right.implementationFileName) ||
    compareNames(left.implementationName, right.implementationName);
}

function rejected(
  code: string,
  message: string,
): AnalyzeRustSourcePackageFacadesResult {
  return {
    kind: "rejected",
    diagnostics: Object.freeze([facadeDiagnostic(code, message)]),
  };
}

function facadeDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.analysis.source-package-facade"],
  };
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
