import { relative, resolve } from "node:path";
import type {
  AstReader,
  SourceFile,
} from "@tsonic/tsts";
import type {
  TargetCompilationPaths,
  TargetDiagnostic,
} from "@tsonic/target-api";
import { rustReservedIdentifiers } from "../../common/rust-identifiers.js";

export interface RustSourceFileOutputIdentity {
  readonly fileName: string;
  readonly relativeSourcePath: string;
  readonly moduleSegments: readonly string[];
  readonly moduleName: string;
  readonly artifactPath: string;
  readonly childModuleNames: readonly string[];
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
}

export function planRustSourceOutputIdentities(
  host: RustSourceOutputIdentityPlannerHost,
): RustSourceOutputIdentityPlan {
  const diagnostics: TargetDiagnostic[] = [];
  const sourcePaths: {
    readonly fileName: string;
    readonly relativeSourcePath: string;
    readonly sourceSegments: readonly string[];
  }[] = [];
  const seenSourcePaths = new Map<string, string>();
  for (const sourceFile of host.sourceFiles) {
    const fileName = host.ast.getFileName(sourceFile);
    const relativeSourcePath = projectRelativeSourcePath(
      host.paths.projectRoot,
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
    const existing = seenSourcePaths.get(normalizedSourcePath);
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
    seenSourcePaths.set(normalizedSourcePath, fileName);
    sourcePaths.push({ fileName, relativeSourcePath, sourceSegments });
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }

  const root = createModuleSegmentNode();
  for (const sourcePath of sourcePaths) {
    let node = root;
    for (const segment of sourcePath.sourceSegments) {
      const child = node.children.get(segment) ?? createModuleSegmentNode();
      node.children.set(segment, child);
      node = child;
    }
  }
  assignRustModuleSegmentNames(root);

  const byFileName = new Map<string, RustSourceFileOutputIdentity>();
  const byModuleName = new Map<string, string>();
  const byArtifactPath = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    const { fileName, relativeSourcePath } = sourcePath;
    const moduleSegments = resolveRustModuleSegments(root, sourcePath.sourceSegments);
    const moduleName = moduleSegments.join("::");
    const artifactPath = `src/${moduleSegments.join("/")}.rs`;
    const moduleOwner = byModuleName.get(moduleName);
    const artifactOwner = byArtifactPath.get(artifactPath);
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
    byModuleName.set(moduleName, fileName);
    byArtifactPath.set(artifactPath, fileName);
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
    : segments.map(rustModuleSegmentBase).join("::");
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

function assignRustModuleSegmentNames(node: ModuleSegmentNode): void {
  const groups = new Map<string, { sourceName: string; node: ModuleSegmentNode }[]>();
  for (const [sourceName, child] of node.children) {
    const base = rustModuleSegmentBase(sourceName);
    const group = groups.get(base) ?? [];
    group.push({ sourceName, node: child });
    groups.set(base, group);
  }
  for (const [base, group] of groups) {
    group.sort((left, right) => compareNames(left.sourceName, right.sourceName));
    const canonicalIndex = group.findIndex((entry) => entry.sourceName === base);
    if (canonicalIndex > 0) {
      const [canonical] = group.splice(canonicalIndex, 1);
      group.unshift(canonical!);
    }
    group.forEach((entry, index) => {
      entry.node.rustName = index === 0 ? base : `${base}_${index + 1}`;
      assignRustModuleSegmentNames(entry.node);
    });
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

function rustModuleSegmentBase(sourceName: string): string {
  let value = sourceName
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "module";
  if (/^[0-9]/u.test(value) || value === "main" || value === "lib" || value === "mod" ||
    value.startsWith("__tsonic") || rustReservedIdentifiers.has(value)) {
    value = `${value}_module`;
  }
  return value.length <= 120 ? value : value.slice(0, 120).replace(/_+$/u, "");
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectRelativeSourcePath(
  projectRootValue: string,
  fileName: string,
  diagnostics: TargetDiagnostic[],
): string | undefined {
  const projectRoot = normalizePath(resolve(projectRootValue));
  const absoluteFileName = normalizePath(resolve(fileName));
  const relativeName = normalizePath(relative(projectRoot, absoluteFileName));
  if (relativeName.length !== 0 && relativeName !== "." &&
    relativeName !== ".." && !relativeName.startsWith("../")) {
    return relativeName;
  }
  const installedSourcePath = installedSourcePackageRelativePath(absoluteFileName);
  if (installedSourcePath !== undefined) {
    return installedSourcePath;
  }
  diagnostics.push({
    code: "RUST_SOURCE_OUTSIDE_PROJECT_ROOT",
    category: "error",
    source: "tsonic-rust",
    message: `Source file '${fileName}' is outside project root '${projectRoot}' and is not an installed source-package file. Rust output identity must be rooted in the checked TSTS source graph.`,
    evidence: ["target.capability=rust.backend.source-output-identity"],
  });
  return undefined;
}

function installedSourcePackageRelativePath(
  absoluteFileName: string,
): string | undefined {
  const marker = "/node_modules/";
  const markerIndex = absoluteFileName.indexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }
  const packageRelativePath = absoluteFileName.slice(markerIndex + marker.length);
  return packageRelativePath.length === 0
    ? undefined
    : `node_modules/${packageRelativePath}`;
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
