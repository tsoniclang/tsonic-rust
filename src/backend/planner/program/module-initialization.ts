import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import { stronglyConnectedSourceFiles } from "../../../analysis/program/module-graph.js";
import type { RustItem, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { PlannedRustSourceFile } from "./source-file.js";
import type { RustSourcePackageInitializerPlan } from "./source-package-initializers.js";
import type { RustSourcePackageErrorBoundary } from "./source-package-errors.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import { planRustSelectedErrorRegion } from "./error-regions.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import { rustErrorType, rustNativeFallibleBoundary, rustPackageFallibleBoundary,
  rustPropagateLocalError, rustPropagateNativeError, type RustFallibleBoundary } from "./fallible-boundaries.js";

export interface RustModuleInitializer {
  readonly sourceFile: SourceFile;
  readonly identity: string;
  readonly path: string;
  readonly asynchronous: boolean;
  readonly errorBoundary?: RustFallibleBoundary;
}

export function planRustModuleInitializers(
  input: RustPlanningContext,
  plannedSources: readonly PlannedRustSourceFile[],
  roots: readonly SourceFile[],
  packageInitializers: RustSourcePackageInitializerPlan,
  rendering: RustTypeRenderingContext,
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
    for (const dependency of input.program.sourceNavigation.moduleDependencies(sourceFile)) {
      visit(dependency.sourceFile);
    }
    active.delete(sourceFile);
    visited.add(sourceFile);
    const planned = plannedBySourceFile.get(sourceFile);
    const initialization = planned?.moduleInitialization;
    const contract = packageInitializers.byFileName.get(input.program.source.ast.getFileName(sourceFile));
    if (planned !== undefined && initialization !== undefined) {
      ordered.push({
        sourceFile,
        identity: input.program.source.ast.getFileName(sourceFile),
        path: `crate::${planned.moduleName}::${initialization.functionName}`,
        asynchronous: initialization.asynchronous,
        ...(initialization.errorBoundary === undefined
          ? {}
          : { errorBoundary: initialization.errorBoundary }),
      });
    } else if (planned === undefined && contract?.crateName !== undefined) {
      const region = planRustSelectedErrorRegion(sourceFile, contract.errorEffects, rendering);
      if (region === undefined) {
        diagnostics.push({
          code: "RUST_SOURCE_PACKAGE_INITIALIZER_ERROR_BOUNDARY_MISSING",
          category: "error",
          source: "tsonic-rust",
          message: `External source module '${contract.fileName}' has no exact initializer error ABI from component '${rendering.sourcePackageComponentId}'.`,
          sourceNode: sourceFile,
          evidence: ["target.capability=rust.backend.source-package-initialization"],
        });
        return;
      }
      const errorBoundary = region.boundary;
      ordered.push({
        sourceFile,
        identity: contract.fileName,
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
  readonly errorType?: Extract<RustType, { readonly kind: "named" }>;
  readonly errorName?: string;
  readonly items: readonly RustItem[];
}

export function planRustCrateInitializer(
  initializers: readonly RustModuleInitializer[],
  functionName: string,
  owner: RustSourcePackageErrorBoundary,
  occupiedNames: ReadonlySet<string>,
): RustCrateInitializer | undefined {
  if (initializers.length === 0) {
    return undefined;
  }
  const asynchronous = initializers.some((initializer) => initializer.asynchronous);
  const fallible = initializers.some((initializer) => initializer.errorBoundary !== undefined);
  const native = initializers.filter(initializer => initializer.errorBoundary?.kind === "native");
  const local = initializers.some(initializer => initializer.errorBoundary?.kind === "source-package")
    ? { identity: `package:${owner.errorTypeIdentity}`, variant: "Local", errorType: rustErrorType(owner) }
    : undefined;
  const names = new Set(occupiedNames);
  names.add(functionName);
  const errorName = native.length === 0 ? undefined : allocateRustGeneratedName(names, "InitializationError");
  const joinName = native.length === 0 ? undefined : allocateRustGeneratedName(names, "InitializationErrors");
  const join = joinName === undefined ? undefined : planRustNativeErrorJoin({
    identity: `initializer:${owner.componentId}:${functionName}`,
    name: joinName, referencePath: `crate::${joinName}`, visibility: "public",
    sources: [...(local === undefined ? [] : [local]), ...native.map((initializer, index) => ({
      identity: initializer.identity, variant: `Module${index}`, errorType: initializer.errorBoundary!.errorType,
    }))],
  });
  const boundary = native.length === 0 ? rustPackageFallibleBoundary(owner) : join === undefined ? undefined
    : rustNativeFallibleBoundary(join, local === undefined ? undefined : { owner, source: local });
  if (boundary === undefined) throw new Error("Finalized module initializers require an exact native error composition.");
  const items: RustItem[] = [...(join?.items ?? [])];
  const errorType: Extract<RustType, { readonly kind: "named" }> = errorName === undefined ? rustErrorType(owner) : {
    kind: "named", path: `crate::${errorName}`, identity: `initializer-error:${owner.componentId}:${functionName}`,
  };
  if (errorName !== undefined) items.push({ kind: "type-alias", name: errorName, visibility: "public",
    generics: emptyRustGenerics, target: boundary.errorType, attrs: [rustHiddenAttribute] });
  const statements: RustStmt[] = initializers.map((initializer) => {
    const call = {
      kind: "call" as const,
      path: initializer.path,
      args: [],
    };
    const execution = initializer.asynchronous
      ? { kind: "await" as const, expr: call }
      : call;
    const operand = initializer.errorBoundary;
    const propagated = operand === undefined ? execution : operand.kind === "source-package"
      ? rustPropagateLocalError(boundary, operand.errorType, execution)
      : rustPropagateNativeError(boundary, { identity: initializer.identity, errorType: operand.errorType }, execution);
    if (propagated === undefined) throw new Error("Module initializer propagation requires its exact selected error channel.");
    return {
      kind: "expr" as const,
      expr: propagated,
    };
  });
  if (fallible) {
    statements.push({
      kind: "tail",
      expr: {
        kind: "call",
        path: "Ok",
        genericArguments: [
          { kind: "type", type: { kind: "unit" } },
          { kind: "type", type: errorType },
        ],
        args: [{ kind: "path", path: "()" }],
      },
    });
  }
  const item: RustItem = {
    kind: "function",
    name: functionName,
    visibility: "public",
    generics: emptyRustGenerics,
    attrs: [rustHiddenAttribute],
    ...(asynchronous ? { isAsync: true } : {}),
    params: [],
    ...(fallible
      ? { errorType }
      : {}),
    body: { statements },
  };
  items.push(item);
  return {
    functionName,
    asynchronous,
    ...(fallible ? { errorType } : {}),
    ...(errorName === undefined ? {} : { errorName }),
    items: Object.freeze(items),
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
  const components = stronglyConnectedSourceFiles(input.program.sourceNavigation, reachable);
  if (components.kind === "unresolved") {
    diagnostics.push({ code: "RUST_SOURCE_MODULE_GRAPH_NOT_PROVEN", category: "error", source: "tsonic-rust", message: components.reason });
    return false;
  }
  let valid = true;
  for (const component of components.components) {
    const cyclic = component.length > 1 || input.program.sourceNavigation
      .moduleDependencies(component[0]!)
      .some((dependency) => dependency.sourceFile === component[0]);
    if (!cyclic) {
      continue;
    }
    const initialized = component.filter((sourceFile) =>
      plannedBySourceFile.get(sourceFile)?.moduleInitialization !== undefined ||
      packageInitializers.byFileName.has(input.program.source.ast.getFileName(sourceFile)));
    if (initialized.length === 0) {
      continue;
    }
    if (component.every(sourceFile => input.program.moduleInitialization.hasStateIndependentCycle(sourceFile))) {
      continue;
    }
    valid = false;
    const files = component
      .map((sourceFile) => input.program.source.ast.getFileName(sourceFile))
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
          .map((sourceFile) => input.program.source.ast.getFileName(sourceFile))
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
  const pending = [...roots];
  while (pending.length > 0) {
    const sourceFile = pending.pop()!;
    if (reachable.has(sourceFile)) continue;
    reachable.add(sourceFile);
    for (const dependency of input.program.sourceNavigation.moduleDependencies(sourceFile)) {
      if (!reachable.has(dependency.sourceFile)) pending.push(dependency.sourceFile);
    }
  }
  return reachable;
}
