import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import type {
  AstReader,
  SourceFile,
} from "@tsonic/tsts";
import type {
  TargetCompilationPaths,
  TargetDiagnostic,
} from "@tsonic/target-api";
import { rustReservedIdentifiers } from "../../backend/planner/plan-context.js";

export interface RustSourceFileOutputIdentity {
  readonly fileName: string;
  readonly relativeSourcePath: string;
  readonly moduleName: string;
  readonly artifactPath: string;
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
  const byFileName = new Map<string, RustSourceFileOutputIdentity>();
  const byModuleName = new Map<string, string>();
  const byArtifactPath = new Map<string, string>();
  const diagnostics: TargetDiagnostic[] = [];

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
    const moduleName = rustModuleNameForSourcePath(relativeSourcePath);
    if (moduleName === undefined) {
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
    const artifactPath = `src/${moduleName}.rs`;
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
    byFileName.set(fileName, Object.freeze({
      fileName,
      relativeSourcePath,
      moduleName,
      artifactPath,
    }));
  }

  return diagnostics.length === 0
    ? { kind: "accepted", identities: new Map(byFileName) }
    : { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
}

export function rustModuleNameForSourcePath(
  relativeSourcePath: string,
): string | undefined {
  const normalized = normalizePath(relativeSourcePath);
  const sourcePath = stripTypeScriptExtension(normalized);
  if (sourcePath === undefined || sourcePath.length === 0 ||
    sourcePath.startsWith("/") || sourcePath.endsWith("/") ||
    sourcePath.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    return undefined;
  }

  const parts = sourcePath.split("/");
  const canonical = parts.every((part) =>
    /^[a-z_][a-z0-9_]*$/u.test(part) && !part.includes("__"));
  let moduleName = canonical ? parts.join("__") : undefined;
  if (moduleName === undefined) {
    const readable = sourcePath
      .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
      .toLowerCase()
      .replace(/\//gu, "__")
      .replace(/[^a-z0-9_]/gu, "_")
      .replace(/_+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "module";
    const digest = createHash("sha256").update(normalized).digest("hex");
    moduleName = `${readable.slice(0, 120)}__id_${digest}`;
  }
  if (/^[0-9]/u.test(moduleName) || moduleName === "main" || moduleName === "lib" ||
    rustReservedIdentifiers.has(moduleName)) {
    moduleName = `source__${moduleName}`;
  }
  if (!/^[a-z_][a-z0-9_]*$/u.test(moduleName)) {
    return undefined;
  }
  if (moduleName.length > 240) {
    moduleName = `source__id_${createHash("sha256").update(normalized).digest("hex")}`;
  }
  return moduleName;
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
