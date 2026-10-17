import { rustModuleSegmentName } from "./identifiers.js";

export interface RustSourceFileOutputIdentity {
  readonly fileName: string;
  readonly relativeSourcePath: string;
  readonly moduleSegments: readonly string[];
  readonly moduleName: string;
  readonly childModuleNames: readonly string[];
  readonly packageId: string;
  readonly componentId: string;
  readonly externalCrateName?: string;
}

export function rustModuleNameForSourcePath(
  relativeSourcePath: string,
): string | undefined {
  const segments = rustSourceModuleSegments(relativeSourcePath);
  return segments === undefined
    ? undefined
    : segments.map(rustModuleSegmentName).join("::");
}

export function rustSourceModuleSegments(relativeSourcePath: string): readonly string[] | undefined {
  const normalized = normalizeRustSourceOutputPath(relativeSourcePath);
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

function stripTypeScriptExtension(value: string): string | undefined {
  for (const extension of [".ts", ".tsx", ".mts", ".cts"] as const) {
    if (value.endsWith(extension)) {
      return value.slice(0, -extension.length);
    }
  }
  return undefined;
}

export function normalizeRustSourceOutputPath(value: string): string {
  return value.split("\\").join("/");
}
