import { relative, resolve } from "node:path";
import type {
  AstReader,
  SourceFile,
} from "@tsonic/tsts";
import type { TargetCompilationPaths } from "@tsonic/target-api";
import type { TargetSourcePackageGraph } from "@tsonic/target-api";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  rustModuleSegmentName,
} from "../../../target-model/names/identifiers.js";

export interface RustSourceFileOutputIdentity {
  readonly fileName: string;
  readonly relativeSourcePath: string;
  readonly moduleSegments: readonly string[];
  readonly moduleName: string;
  readonly artifactPath: string;
  readonly childModuleNames: readonly string[];
  readonly packageId: string;
  readonly componentId: string;
  readonly externalCrateName?: string;
}

export type RustSourceOutputIdentityPlan =
  | {
      readonly kind: "accepted";
      readonly identities: ReadonlyMap<string, RustSourceFileOutputIdentity>;
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    };

export interface RustSourceOutputIdentityPlannerHost {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly paths: TargetCompilationPaths;
  readonly sourcePackages: TargetSourcePackageGraph;
}

export function planRustSourceOutputIdentities(
  host: RustSourceOutputIdentityPlannerHost,
): RustSourceOutputIdentityPlan {
  const diagnostics: TargetDiagnostic[] = [];
  const packageBySourceFile = sourcePackageByFileName(host.sourcePackages);
  const rootPackage = host.sourcePackages.packages.find((entry) =>
    entry.id === host.sourcePackages.rootPackageId);
  if (rootPackage === undefined) {
    return {
      kind: "rejected",
      diagnostics: [sourcePackageIdentityDiagnostic(
        "RUST_ROOT_SOURCE_PACKAGE_MISSING",
        "The checked source-package graph has no root package entry.",
      )],
    };
  }
  const externalCrateNames = externalSourcePackageCrateNames(
    host.sourcePackages,
    rootPackage.componentId,
    diagnostics,
  );
  const packageCountByComponent = new Map(host.sourcePackages.components.map((component) =>
    [component.id, component.packages.length] as const));
  const sourcePaths: {
    readonly fileName: string;
    readonly relativeSourcePath: string;
    readonly sourceSegments: readonly string[];
    readonly packageId: string;
    readonly componentId: string;
    readonly externalCrateName?: string;
  }[] = [];
  const seenSourcePaths = new Map<string, string>();
  for (const sourceFile of host.sourceFiles) {
    const fileName = host.ast.getFileName(sourceFile);
    const sourcePackage = packageBySourceFile.get(normalizePath(resolve(fileName)));
    if (sourcePackage === undefined) {
      diagnostics.push(sourcePackageIdentityDiagnostic(
        "RUST_SOURCE_PACKAGE_IDENTITY_MISSING",
        `Source file '${fileName}' has no exact package identity in the checked source-package graph.`,
      ));
      continue;
    }
    const relativeSourcePath = packageRelativeSourcePath(
      sourcePackage.sourceRoot,
      fileName,
      diagnostics,
    );
    if (relativeSourcePath === undefined) {
      continue;
    }
    const sourceSegments = sourceModuleSegments(relativeSourcePath);
    if (sourceSegments === undefined) {
      diagnostics.push({
        code: "RUST_SOURCE_MODULE_IDENTITY_UNSUPPORTED",
        category: "error",
        source: "tsonic-rust",
        message: `Source file '${fileName}' has no deterministic Rust module identity.`,
        evidence: [
          "target.capability=rust.backend.source-output-identity",
          `source.relative=${relativeSourcePath}`,
        ],
      });
      continue;
    }
    const normalizedSourcePath = sourceSegments.join("/");
    const sourcePathIdentity = `${sourcePackage.componentId}\u0000${normalizedSourcePath}`;
    const existing = seenSourcePaths.get(sourcePathIdentity);
    if (existing !== undefined && existing !== fileName) {
      diagnostics.push(identityCollisionDiagnostic(
        "RUST_SOURCE_MODULE_IDENTITY_COLLISION",
        fileName,
        existing,
        "source module path",
        normalizedSourcePath,
      ));
      continue;
    }
    seenSourcePaths.set(sourcePathIdentity, fileName);
    const localComponent = sourcePackage.componentId === rootPackage.componentId;
    const localSegments = (packageCountByComponent.get(sourcePackage.componentId) ?? 0) > 1
      ? [rustModuleSegmentName(sourcePackage.name ?? "package"), ...sourceSegments]
      : sourceSegments;
    sourcePaths.push({
      fileName,
      relativeSourcePath,
      sourceSegments: localSegments,
      packageId: sourcePackage.id,
      componentId: sourcePackage.componentId,
      ...(localComponent
        ? {}
        : { externalCrateName: externalCrateNames.get(sourcePackage.componentId)! }),
    });
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }

  const rootsByComponent = new Map<string, ModuleSegmentNode>();
  for (const sourcePath of sourcePaths) {
    const root = rootsByComponent.get(sourcePath.componentId) ?? createModuleSegmentNode();
    rootsByComponent.set(sourcePath.componentId, root);
    let node = root;
    for (const segment of sourcePath.sourceSegments) {
      const child = node.children.get(segment) ?? createModuleSegmentNode();
      node.children.set(segment, child);
      node = child;
    }
  }
  for (const root of rootsByComponent.values()) {
    assignRustModuleSegmentNames(root);
  }

  const byFileName = new Map<string, RustSourceFileOutputIdentity>();
  const byModuleName = new Map<string, string>();
  const byArtifactPath = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    const { fileName, relativeSourcePath } = sourcePath;
    const root = rootsByComponent.get(sourcePath.componentId)!;
    const moduleSegments = resolveRustModuleSegments(root, sourcePath.sourceSegments);
    const moduleName = moduleSegments.join("::");
    const artifactPath = `src/${moduleSegments.join("/")}.rs`;
    const moduleIdentity = `${sourcePath.componentId}\u0000${moduleName}`;
    const artifactIdentity = `${sourcePath.componentId}\u0000${artifactPath}`;
    const moduleOwner = byModuleName.get(moduleIdentity);
    const artifactOwner = byArtifactPath.get(artifactIdentity);
    if (moduleOwner !== undefined && moduleOwner !== fileName) {
      diagnostics.push(identityCollisionDiagnostic(
        "RUST_SOURCE_MODULE_IDENTITY_COLLISION",
        fileName,
        moduleOwner,
        "module identity",
        moduleName,
      ));
      continue;
    }
    if (artifactOwner !== undefined && artifactOwner !== fileName) {
      diagnostics.push(identityCollisionDiagnostic(
        "RUST_SOURCE_ARTIFACT_IDENTITY_COLLISION",
        fileName,
        artifactOwner,
        "artifact identity",
        artifactPath,
      ));
      continue;
    }
    byModuleName.set(moduleIdentity, fileName);
    byArtifactPath.set(artifactIdentity, fileName);
    const moduleNode = resolveModuleSegmentNode(root, sourcePath.sourceSegments);
    byFileName.set(fileName, Object.freeze({
      fileName,
      relativeSourcePath,
      moduleSegments: Object.freeze(moduleSegments),
      moduleName,
      artifactPath,
      childModuleNames: Object.freeze(
        [...moduleNode.children.values()]
          .map((child) => child.rustName!)
          .sort(compareNames),
      ),
      packageId: sourcePath.packageId,
      componentId: sourcePath.componentId,
      ...(sourcePath.externalCrateName === undefined
        ? {}
        : { externalCrateName: sourcePath.externalCrateName }),
    }));
  }

  return diagnostics.length === 0
    ? { kind: "accepted", identities: new Map(byFileName) }
    : { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
}

export function rustModuleNameForSourcePath(
  relativeSourcePath: string,
): string | undefined {
  const segments = sourceModuleSegments(relativeSourcePath);
  return segments === undefined
    ? undefined
    : segments.map(rustModuleSegmentName).join("::");
}

export function allocateRustSupportModuleName(
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  preferredName: string,
  additionalReservedNames: readonly string[] = [],
): string {
  const usedNames = new Set(additionalReservedNames);
  for (const identity of identities.values()) {
    if (identity.externalCrateName !== undefined) {
      continue;
    }
    const topLevelName = identity.moduleSegments[0];
    if (topLevelName !== undefined) {
      usedNames.add(topLevelName);
    }
  }
  const baseName = rustModuleSegmentName(preferredName);
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function allocateRustComponentSupportModuleName(
  identities: ReadonlyMap<string, RustSourceFileOutputIdentity>,
  componentId: string,
  preferredName: string,
  additionalReservedNames: readonly string[] = [],
): string {
  const usedNames = new Set(additionalReservedNames);
  for (const identity of identities.values()) {
    if (identity.componentId !== componentId) {
      continue;
    }
    const topLevelName = identity.moduleSegments[0];
    if (topLevelName !== undefined) {
      usedNames.add(topLevelName);
    }
  }
  const baseName = rustModuleSegmentName(preferredName);
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

interface ModuleSegmentNode {
  readonly children: Map<string, ModuleSegmentNode>;
  rustName?: string;
}

function createModuleSegmentNode(): ModuleSegmentNode {
  return { children: new Map() };
}

function sourceModuleSegments(relativeSourcePath: string): readonly string[] | undefined {
  const normalized = normalizePath(relativeSourcePath);
  const sourcePath = stripTypeScriptExtension(normalized);
  if (sourcePath === undefined || sourcePath.length === 0 ||
    sourcePath.startsWith("/") || sourcePath.endsWith("/")) {
    return undefined;
  }
  const segments = sourcePath.split("/");
  return segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ? undefined
    : Object.freeze(segments);
}

function assignRustModuleSegmentNames(
  node: ModuleSegmentNode,
  parentRustName?: string,
): void {
  const groups = new Map<string, { sourceName: string; node: ModuleSegmentNode }[]>();
  for (const [sourceName, child] of node.children) {
    const base = rustModuleSegmentName(sourceName);
    const group = groups.get(base) ?? [];
    group.push({ sourceName, node: child });
    groups.set(base, group);
  }
  const reservedBaseNames = new Set(groups.keys());
  const usedNames = new Set<string>();
  for (const [base, group] of [...groups].sort(([left], [right]) => compareNames(left, right))) {
    group.sort((left, right) => compareNames(left.sourceName, right.sourceName));
    const canonicalIndex = group.findIndex((entry) => entry.sourceName === base);
    if (canonicalIndex > 0) {
      const [canonical] = group.splice(canonicalIndex, 1);
      group.unshift(canonical!);
    }
    for (const [index, entry] of group.entries()) {
      const preserveBase = index === 0 && base !== parentRustName;
      const rustName = preserveBase
        ? base
        : allocateRustModuleSegmentName(base, reservedBaseNames, usedNames, parentRustName);
      entry.node.rustName = rustName;
      usedNames.add(rustName);
      assignRustModuleSegmentNames(entry.node, rustName);
    }
  }
}

function allocateRustModuleSegmentName(
  base: string,
  reservedBaseNames: ReadonlySet<string>,
  usedNames: ReadonlySet<string>,
  parentRustName: string | undefined,
): string {
  let suffix = 2;
  while (true) {
    const candidate = `${base}_${suffix}`;
    if (candidate !== parentRustName &&
      !reservedBaseNames.has(candidate) &&
      !usedNames.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function resolveRustModuleSegments(
  root: ModuleSegmentNode,
  sourceSegments: readonly string[],
): string[] {
  const result: string[] = [];
  let node = root;
  for (const sourceSegment of sourceSegments) {
    node = node.children.get(sourceSegment)!;
    result.push(node.rustName!);
  }
  return result;
}

function resolveModuleSegmentNode(
  root: ModuleSegmentNode,
  sourceSegments: readonly string[],
): ModuleSegmentNode {
  let node = root;
  for (const sourceSegment of sourceSegments) {
    node = node.children.get(sourceSegment)!;
  }
  return node;
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageRelativeSourcePath(
  sourceRootValue: string,
  fileName: string,
  diagnostics: TargetDiagnostic[],
): string | undefined {
  const sourceRoot = normalizePath(resolve(sourceRootValue));
  const absoluteFileName = normalizePath(resolve(fileName));
  const relativeName = normalizePath(relative(sourceRoot, absoluteFileName));
  if (relativeName.length !== 0 && relativeName !== "." &&
    relativeName !== ".." && !relativeName.startsWith("../")) {
    return relativeName;
  }
  diagnostics.push({
    code: "RUST_SOURCE_OUTSIDE_PROJECT_ROOT",
    category: "error",
    source: "tsonic-rust",
    message: `Source file '${fileName}' is outside its exact source-package root '${sourceRoot}'.`,
    evidence: ["target.capability=rust.backend.source-output-identity"],
  });
  return undefined;
}

function sourcePackageByFileName(
  graph: TargetSourcePackageGraph,
): ReadonlyMap<string, TargetSourcePackageGraph["packages"][number]> {
  const result = new Map<string, TargetSourcePackageGraph["packages"][number]>();
  for (const sourcePackage of graph.packages) {
    for (const sourceFile of sourcePackage.sourceFiles) {
      result.set(normalizePath(resolve(sourceFile)), sourcePackage);
    }
  }
  return result;
}

function externalSourcePackageCrateNames(
  graph: TargetSourcePackageGraph,
  rootComponentId: string,
  diagnostics: TargetDiagnostic[],
): ReadonlyMap<string, string> {
  const packagesById = new Map(graph.packages.map((entry) => [entry.id, entry] as const));
  const candidates = graph.components
    .filter((component) => component.id !== rootComponentId)
    .map((component) => {
      const names = component.packages.map((packageId) => packagesById.get(packageId)?.name);
      if (names.some((name) => name === undefined)) {
        diagnostics.push(sourcePackageIdentityDiagnostic(
          "RUST_SOURCE_PACKAGE_NAME_MISSING",
          `External source-package component '${component.id}' contains a package without an explicit package name.`,
        ));
        return undefined;
      }
      const base = rustModuleSegmentName((names as string[]).sort(compareNames).join("_"));
      return { component, base };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const entries = groups.get(candidate.base) ?? [];
    entries.push(candidate);
    groups.set(candidate.base, entries);
  }
  return new Map(candidates.map(({ component, base }) => {
    const collision = (groups.get(base)?.length ?? 0) > 1;
    const digest = component.id.slice(component.id.lastIndexOf(":") + 1, component.id.length);
    return [component.id, collision ? `${base}_${digest.slice(0, 8)}` : base] as const;
  }));
}

function sourcePackageIdentityDiagnostic(
  code: string,
  message: string,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.backend.source-package-identity"],
  };
}

function stripTypeScriptExtension(value: string): string | undefined {
  for (const extension of [".ts", ".tsx", ".mts", ".cts"] as const) {
    if (value.endsWith(extension)) {
      return value.slice(0, -extension.length);
    }
  }
  return undefined;
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function identityCollisionDiagnostic(
  code: string,
  fileName: string,
  existingFileName: string,
  identityKind: string,
  identity: string,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message: `Source files '${existingFileName}' and '${fileName}' produced the same deterministic Rust ${identityKind} '${identity}'.`,
    evidence: ["target.capability=rust.backend.source-output-identity"],
  };
}
