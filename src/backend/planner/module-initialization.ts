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
  const plannedBySourceFile = new Map(
    plannedSources.map((source) => [source.sourceFile, source]),
  );
  if (!validateRuntimeModuleGraph(
    input,
    plannedBySourceFile,
    entrySourceFile,
    diagnostics,
  )) {
    return undefined;
  }
  const visited = new Set<SourceFile>();
  const active = new Set<SourceFile>();
  const ordered: RustModuleInitializer[] = [];
  const visit = (sourceFile: SourceFile): void => {
    if (visited.has(sourceFile) || active.has(sourceFile)) {
      return;
    }
    active.add(sourceFile);
    for (const dependency of input.source.navigation.moduleDependencies(sourceFile)) {
      visit(dependency.sourceFile);
    }
    active.delete(sourceFile);
    visited.add(sourceFile);
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
  plannedBySourceFile: ReadonlyMap<SourceFile, PlannedRustSourceFile>,
  entrySourceFile: SourceFile,
  diagnostics: TargetDiagnostic[],
): boolean {
  const reachable = collectReachableSourceFiles(input, entrySourceFile);
  const components = stronglyConnectedSourceFiles(input, reachable);
  let valid = true;
  for (const component of components) {
    const cyclic = component.length > 1 || input.source.navigation
      .moduleDependencies(component[0]!)
      .some((dependency) => dependency.sourceFile === component[0]);
    if (!cyclic) {
      continue;
    }
    const initialized = component.filter((sourceFile) =>
      plannedBySourceFile.get(sourceFile)?.moduleInitialization !== undefined);
    if (initialized.length === 0) {
      continue;
    }
    valid = false;
    const files = component
      .map((sourceFile) => input.ast.getFileName(sourceFile))
      .sort((left, right) => left.localeCompare(right, "en"));
    diagnostics.push({
      code: "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE",
      category: "error",
      source: "tsonic-rust",
      message:
        `Runtime ES module dependency component '${files.join(" -> ")}' contains ${initialized.length} module initializer${initialized.length === 1 ? "" : "s"} and cannot be executed without finalized cyclic call, live-binding, and temporal-dead-zone evidence.`,
      evidence: [
        "target.capability=rust.backend.module-initialization",
        ...initialized
          .map((sourceFile) => input.ast.getFileName(sourceFile))
          .sort((left, right) => left.localeCompare(right, "en"))
          .map((fileName) => `runtime.initializer=${fileName}`),
      ],
    });
  }
  return valid;
}

function collectReachableSourceFiles(
  input: RustTranslationContext,
  entrySourceFile: SourceFile,
): ReadonlySet<SourceFile> {
  const reachable = new Set<SourceFile>();
  const visit = (sourceFile: SourceFile): void => {
    if (reachable.has(sourceFile)) {
      return;
    }
    reachable.add(sourceFile);
    for (const dependency of input.source.navigation.moduleDependencies(sourceFile)) {
      visit(dependency.sourceFile);
    }
  };
  visit(entrySourceFile);
  return reachable;
}

function stronglyConnectedSourceFiles(
  input: RustTranslationContext,
  sourceFiles: ReadonlySet<SourceFile>,
): readonly (readonly SourceFile[])[] {
  let nextIndex = 0;
  const indexBySourceFile = new Map<SourceFile, number>();
  const lowLinkBySourceFile = new Map<SourceFile, number>();
  const stack: SourceFile[] = [];
  const onStack = new Set<SourceFile>();
  const components: SourceFile[][] = [];
  const visit = (sourceFile: SourceFile): void => {
    const index = nextIndex;
    nextIndex += 1;
    indexBySourceFile.set(sourceFile, index);
    lowLinkBySourceFile.set(sourceFile, index);
    stack.push(sourceFile);
    onStack.add(sourceFile);
    for (const dependency of input.source.navigation.moduleDependencies(sourceFile)) {
      const target = dependency.sourceFile;
      if (!sourceFiles.has(target)) {
        continue;
      }
      const targetIndex = indexBySourceFile.get(target);
      if (targetIndex === undefined) {
        visit(target);
        lowLinkBySourceFile.set(
          sourceFile,
          Math.min(lowLinkBySourceFile.get(sourceFile)!, lowLinkBySourceFile.get(target)!),
        );
      } else if (onStack.has(target)) {
        lowLinkBySourceFile.set(
          sourceFile,
          Math.min(lowLinkBySourceFile.get(sourceFile)!, targetIndex),
        );
      }
    }
    if (lowLinkBySourceFile.get(sourceFile) !== index) {
      return;
    }
    const component: SourceFile[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === sourceFile) {
        break;
      }
    }
    components.push(component);
  };
  for (const sourceFile of sourceFiles) {
    if (!indexBySourceFile.has(sourceFile)) {
      visit(sourceFile);
    }
  }
  return components;
}
