import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api";
import type { RustTranslationContext } from "../../translate/context.js";
import type { PlannedRustSourceFile } from "./source-file-planner.js";

export interface RustModuleInitializer {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly functionName: string;
  readonly asynchronous: boolean;
  readonly fallible: boolean;
}

export function planRustBinaryModuleInitializers(
  input: RustTranslationContext,
  plannedSources: readonly PlannedRustSourceFile[],
  entrySourceFile: SourceFile,
  diagnostics: TargetDiagnostic[],
): readonly RustModuleInitializer[] | undefined {
  if (!validateRuntimeModuleGraph(input, diagnostics)) {
    return undefined;
  }
  const plannedBySourceFile = new Map(
    plannedSources.map((source) => [source.sourceFile, source]),
  );
  const visited = new Set<SourceFile>();
  const ordered: RustModuleInitializer[] = [];
  const visit = (sourceFile: SourceFile): void => {
    if (visited.has(sourceFile)) {
      return;
    }
    visited.add(sourceFile);
    for (const dependency of input.source.navigation.moduleDependencies(sourceFile)) {
      visit(dependency.sourceFile);
    }
    const planned = plannedBySourceFile.get(sourceFile);
    const initialization = planned?.moduleInitialization;
    if (planned !== undefined && initialization !== undefined) {
      ordered.push({
        sourceFile,
        moduleName: planned.moduleName,
        functionName: initialization.functionName,
        asynchronous: initialization.asynchronous,
        fallible: initialization.fallible,
      });
    }
  };
  visit(entrySourceFile);
  return Object.freeze(ordered);
}

export function diagnoseRustLibraryModuleInitialization(
  input: RustTranslationContext,
  plannedSources: readonly PlannedRustSourceFile[],
  diagnostics: TargetDiagnostic[],
): void {
  const runtimeSources = plannedSources.filter((source) =>
    source.moduleInitialization !== undefined);
  if (runtimeSources.length === 0) {
    return;
  }
  diagnostics.push({
    code: "RUST_LIBRARY_MODULE_INITIALIZATION_UNSUPPORTED",
    category: "error",
    source: "tsonic-rust",
    message:
      "Rust library output cannot preserve TypeScript runtime module initialization without an explicit target-toolchain startup contract.",
    evidence: [
      "target.capability=rust.backend.module-initialization",
      ...runtimeSources.map((source) =>
        `source.file=${input.ast.getFileName(source.sourceFile)}`),
    ],
  });
}

function validateRuntimeModuleGraph(
  input: RustTranslationContext,
  diagnostics: TargetDiagnostic[],
): boolean {
  const visited = new Set<SourceFile>();
  const active = new Map<SourceFile, number>();
  const stack: SourceFile[] = [];
  const reported = new Set<string>();
  for (const sourceFile of input.sourceFiles) {
    visit(sourceFile);
  }
  return diagnostics.every((diagnostic) =>
    diagnostic.code !== "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE");

  function visit(sourceFile: SourceFile): void {
    if (visited.has(sourceFile)) {
      return;
    }
    const activeIndex = active.get(sourceFile);
    if (activeIndex !== undefined) {
      const cycle = [...stack.slice(activeIndex), sourceFile];
      const key = [...new Set(cycle.map((entry) => input.ast.getFileName(entry)))]
        .sort((left, right) => left.localeCompare(right, "en"))
        .join("\0");
      if (!reported.has(key)) {
        reported.add(key);
        diagnostics.push({
          code: "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE",
          category: "error",
          source: "tsonic-rust",
          message:
            `Runtime ES module dependency cycle '${cycle.map((entry) => input.ast.getFileName(entry)).join(" -> ")}' cannot be lowered without finalized live-binding and temporal-dead-zone support.`,
          evidence: [
            "target.capability=rust.backend.module-initialization",
            "TSTS selected a runtime project-source import/export dependency cycle.",
          ],
        });
      }
      return;
    }
    active.set(sourceFile, stack.length);
    stack.push(sourceFile);
    for (const dependency of input.source.navigation.moduleDependencies(sourceFile)) {
      visit(dependency.sourceFile);
    }
    stack.pop();
    active.delete(sourceFile);
    visited.add(sourceFile);
  }
}
