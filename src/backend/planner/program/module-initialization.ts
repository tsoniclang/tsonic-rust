import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import { stronglyConnectedSourceFiles } from "../../../analysis/program/module-graph.js";
import type { RustItem, RustStmt, RustType } from "../../rust-ast/nodes.js";
import type { PlannedRustSourceFile } from "./source-file.js";
import type { RustSourcePackageInitializerPlan } from "./source-package-initializers.js";
import {
  resolveRustSourcePackageErrorBoundary,
  type RustSourcePackageErrorBoundary,
  type RustSourcePackageErrorPlan,
} from "./source-package-errors.js";

export interface RustModuleInitializer {
  readonly sourceFile: SourceFile;
  readonly path: string;
  readonly asynchronous: boolean;
  readonly errorBoundary?: RustSourcePackageErrorBoundary;
}

export function planRustModuleInitializers(
  input: RustPlanningContext,
  plannedSources: readonly PlannedRustSourceFile[],
  roots: readonly SourceFile[],
  packageInitializers: RustSourcePackageInitializerPlan,
  sourcePackageErrors: RustSourcePackageErrorPlan,
  consumerComponentId: string,
  diagnostics: TargetDiagnostic[],
): readonly RustModuleInitializer[] | undefined {
  const plannedBySourceFile = new Map(
    plannedSources.map((source) => [source.sourceFile, source]),
  );
  if (!validateRuntimeModuleGraph(
    input,
    plannedBySourceFile,
    roots,
    packageInitializers,
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
    const contract = packageInitializers.byFileName.get(input.ast.getFileName(sourceFile));
    if (planned !== undefined && initialization !== undefined) {
      ordered.push({
        sourceFile,
        path: `crate::${planned.moduleName}::${initialization.functionName}`,
        asynchronous: initialization.asynchronous,
        ...(initialization.errorBoundary === undefined
          ? {}
          : { errorBoundary: initialization.errorBoundary }),
      });
    } else if (planned === undefined && contract?.crateName !== undefined) {
      const errorBoundary = contract.fallible
        ? resolveRustSourcePackageErrorBoundary(
            sourcePackageErrors,
            consumerComponentId,
            contract.componentId,
          )
        : undefined;
      if (contract.fallible && errorBoundary === undefined) {
        diagnostics.push({
          code: "RUST_SOURCE_PACKAGE_INITIALIZER_ERROR_BOUNDARY_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `External source module '${contract.fileName}' has no exact initializer error ABI from component '${consumerComponentId}'.`,
          sourceNode: sourceFile,
          evidence: ["target.capability=rust.backend.source-package-initialization"],
        });
        return;
      }
      ordered.push({
        sourceFile,
        path: `${contract.crateName}::${contract.facadeModuleName}::${contract.facadeFunctionName}`,
        asynchronous: contract.asynchronous,
        ...(errorBoundary === undefined ? {} : { errorBoundary }),
      });
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return Object.freeze(ordered);
}

export interface RustCrateInitializer {
  readonly functionName: string;
  readonly asynchronous: boolean;
  readonly errorType?: RustType;
  readonly item: RustItem;
}

export function planRustCrateInitializer(
  initializers: readonly RustModuleInitializer[],
  functionName: string,
  errorType: RustType,
): RustCrateInitializer | undefined {
  if (initializers.length === 0) {
    return undefined;
  }
  const asynchronous = initializers.some((initializer) => initializer.asynchronous);
  const fallible = initializers.some((initializer) => initializer.errorBoundary !== undefined);
  const statements: RustStmt[] = initializers.map((initializer) => {
    const call = {
      kind: "call" as const,
      path: initializer.path,
      args: [],
    };
    const execution = initializer.asynchronous
      ? { kind: "await" as const, expr: call }
      : call;
    return {
      kind: "expr" as const,
      expr: initializer.errorBoundary !== undefined
        ? {
            kind: "try" as const,
            expr: execution,
            resultErrorType: errorType,
            operandErrorType: {
              kind: "named" as const,
              path: initializer.errorBoundary.errorTypePath,
              identity: initializer.errorBoundary.errorTypeIdentity,
            },
          }
        : execution,
    };
  });
  if (fallible) {
    statements.push({
      kind: "tail",
      expr: {
        kind: "call",
        path: "Ok",
        typeArguments: [{ kind: "unit" }, errorType],
        args: [{ kind: "path", path: "()" }],
      },
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
      ? { errorType }
      : {}),
    body: { statements },
  };
  return {
    functionName,
    asynchronous,
    ...(fallible ? { errorType } : {}),
    item,
  };
}

function validateRuntimeModuleGraph(
  input: RustPlanningContext,
  plannedBySourceFile: ReadonlyMap<SourceFile, PlannedRustSourceFile>,
  roots: readonly SourceFile[],
  packageInitializers: RustSourcePackageInitializerPlan,
  diagnostics: TargetDiagnostic[],
): boolean {
  const reachable = collectReachableSourceFiles(input, roots);
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
      plannedBySourceFile.get(sourceFile)?.moduleInitialization !== undefined ||
      packageInitializers.byFileName.has(input.ast.getFileName(sourceFile)));
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
  input: RustPlanningContext,
  roots: readonly SourceFile[],
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
  for (const root of roots) {
    visit(root);
  }
  return reachable;
}
