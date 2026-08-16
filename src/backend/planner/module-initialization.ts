import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api";
import type { RustTranslationContext } from "../../translate/context.js";
import { stronglyConnectedSourceFiles } from "../../common/source-module-graph.js";
import type { RustErrorDomain, RustItem, RustStmt } from "../rust-ast/nodes.js";
import type { PlannedRustSourceFile } from "./source-file-planner.js";

export interface RustModuleInitializer {
  readonly sourceFile: SourceFile;
  readonly moduleName: string;
  readonly functionName: string;
  readonly asynchronous: boolean;
  readonly fallible: boolean;
}

export function planRustModuleInitializers(
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

export interface RustCrateInitializer {
  readonly functionName: string;
  readonly asynchronous: boolean;
  readonly fallible: boolean;
  readonly item: RustItem;
}

export function planRustCrateInitializer(
  initializers: readonly RustModuleInitializer[],
  functionName: string,
  resultTypePath: string,
  errorDomain: RustErrorDomain,
): RustCrateInitializer | undefined {
  if (initializers.length === 0) {
    return undefined;
  }
  const asynchronous = initializers.some((initializer) => initializer.asynchronous);
  const fallible = initializers.some((initializer) => initializer.fallible);
  const statements: RustStmt[] = initializers.map((initializer) => {
    const call = {
      kind: "call" as const,
      path: `crate::${initializer.moduleName}::${initializer.functionName}`,
      args: [],
    };
    const execution = initializer.asynchronous
      ? { kind: "await" as const, expr: call }
      : call;
    return {
      kind: "expr" as const,
      expr: initializer.fallible
        ? { kind: "try" as const, expr: execution, errorDomain }
        : execution,
    };
  });
  if (fallible) {
    statements.push({
      kind: "tail",
      expr: { kind: "path", path: "Ok(())" },
    });
  }
  const item: RustItem = {
    kind: "function",
    name: functionName,
    visibility: "public",
    attrs: ["#[doc(hidden)]"],
    ...(asynchronous ? { isAsync: true } : {}),
    params: [],
    ...(fallible
      ? {
          returnType: {
            kind: "named" as const,
            path: resultTypePath,
            typeArguments: [{ kind: "unit" as const }],
          },
        }
      : {}),
    body: { statements },
  };
  return {
    functionName,
    asynchronous,
    fallible,
    item,
  };
}

function validateRuntimeModuleGraph(
  input: RustTranslationContext,
  plannedBySourceFile: ReadonlyMap<SourceFile, PlannedRustSourceFile>,
  entrySourceFile: SourceFile,
  diagnostics: TargetDiagnostic[],
): boolean {
  const reachable = collectReachableSourceFiles(input, entrySourceFile);
  const components = stronglyConnectedSourceFiles(input.source.navigation, reachable);
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
