import { failRustPlannerInvariant } from "../../invariants.js";
import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { SourceFile } from "@tsonic/tsts";
import type { RustInitializerSelection } from "../../../target-model/records/error-regions.js";
import type { RustItem, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustSourcePackageInitializerPlan } from "../../../target-model/records/source-packages.js";
import { resolveRustPhysicalProgramErrorBoundary } from "./source-package-errors.js";
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
  selection: RustInitializerSelection,
  packageInitializers: RustSourcePackageInitializerPlan,
  rendering: RustTypeRenderingContext,
): readonly RustModuleInitializer[] {
  const ordered: RustModuleInitializer[] = [];
  for (const selected of selection.modules) {
    const contract = packageInitializers.byFileName.get(selected.identity);
    const path = contract?.componentId === rendering.sourcePackageComponentId
      ? `crate::${contract.implementationModuleName}::${contract.implementationFunctionName}`
      : contract?.crateName !== undefined
        ? `${contract.crateName}::${contract.facadeModuleName}::${contract.facadeFunctionName}` : undefined;
    const region = planRustSelectedErrorRegion(selected.region, rendering);
    if (path === undefined || region === undefined) {
      failRustPlannerInvariant(
        `Completed initializer '${selected.identity}' has no exact native symbol or rendered error payload.`,
        selected.sourceFile);
    }
    ordered.push(Object.freeze({ sourceFile: selected.sourceFile, identity: selected.identity, path,
      asynchronous: selected.asynchronous, ...(region.boundary === undefined ? {} : { errorBoundary: region.boundary }) }));
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
  selection: RustInitializerSelection,
  initializers: readonly RustModuleInitializer[],
  functionName: string,
  rendering: RustTypeRenderingContext,
  occupiedNames: ReadonlySet<string>,
): RustCrateInitializer | undefined {
  if (selection.modules.length === 0) return undefined;
  const selected = selection.error;
  const owner = selected.kind === "infallible" || rendering.sourcePackageErrors === undefined ? undefined
    : resolveRustPhysicalProgramErrorBoundary(rendering.input.program.records, rendering.sourcePackageComponentId, selected.owner);
  if (selected.kind !== "infallible" && owner === undefined)
    failRustPlannerInvariant("An admitted initializer requires its exact physical error owner.", selection.modules[0]?.sourceFile);
  const names = new Set(occupiedNames);
  names.add(functionName);
  const errorName = selected.kind === "native" ? allocateRustGeneratedName(names, "InitializationError") : undefined;
  const joinName = selected.kind === "native" ? allocateRustGeneratedName(names, "InitializationErrors") : undefined;
  const bySourceFile = new Map(initializers.map(initializer => [initializer.sourceFile, initializer]));
  const local = selected.kind === "native" ? selected.sources.find(source => source.kind === "package") : undefined;
  const sources = selected.kind === "native" ? selected.sources.map(source => {
    const errorType = source.kind === "package" ? rustErrorType(owner!) : bySourceFile.get(source.sourceFile)?.errorBoundary?.errorType;
    return errorType === undefined ? undefined : { identity: source.identity, variant: source.variant, errorType };
  }) : [];
  if (sources.some(source => source === undefined))
    failRustPlannerInvariant("An admitted initializer requires its finalized native error-source syntax.", selection.modules[0]?.sourceFile);
  const join = selected.kind !== "native" ? undefined : planRustNativeErrorJoin({
    identity: `initializer:${rendering.sourcePackageComponentId}:${functionName}`, name: joinName!,
    referencePath: `crate::${joinName!}`, visibility: "public", sources: sources as NonNullable<typeof sources[number]>[],
  });
  const boundary = selected.kind === "infallible" ? undefined : selected.kind === "package"
    ? rustPackageFallibleBoundary(owner!) : join === undefined ? undefined : rustNativeFallibleBoundary(join,
      local === undefined ? undefined : { owner: owner!, source: { identity: local.identity, errorType: rustErrorType(owner!) } });
  if (selected.kind !== "infallible" && boundary === undefined)
    failRustPlannerInvariant("An admitted initializer requires its exact native error boundary.", selection.modules[0]?.sourceFile);
  const items: RustItem[] = [...(join?.items ?? [])];
  const errorType: Extract<RustType, { readonly kind: "named" }> | undefined = selected.kind === "infallible" ? undefined
    : errorName === undefined ? rustErrorType(owner!) : {
      kind: "named", path: `crate::${errorName}`, identity: `initializer-error:${rendering.sourcePackageComponentId}:${functionName}`,
    };
  if (errorName !== undefined) items.push({ kind: "type-alias", name: errorName, visibility: "public",
    generics: emptyRustGenerics, target: boundary!.errorType, attrs: [rustHiddenAttribute] });
  const statements: RustStmt[] = [];
  for (const selectedModule of selection.modules) {
    const initializer = bySourceFile.get(selectedModule.sourceFile);
    if (initializer === undefined) failRustPlannerInvariant("An admitted initializer requires its exact sealed module invocation.", selectedModule.sourceFile);
    const call = { kind: "call" as const, path: initializer.path, args: [] };
    const execution = selectedModule.asynchronous ? { kind: "await" as const, expr: call } : call;
    const propagated = selectedModule.region.kind === "infallible" ? execution
      : boundary === undefined || initializer.errorBoundary === undefined ? undefined
        : selectedModule.region.kind === "package"
          ? rustPropagateLocalError(boundary, initializer.errorBoundary.errorType, execution)
          : rustPropagateNativeError(boundary, { identity: selectedModule.identity,
            errorType: initializer.errorBoundary.errorType }, execution);
    if (propagated === undefined) failRustPlannerInvariant("An admitted initializer requires its selected native error propagation.", selectedModule.sourceFile);
    statements.push({ kind: "expr", expr: propagated });
  }
  if (errorType !== undefined) statements.push({ kind: "tail", expr: { kind: "call", path: "Ok",
    genericArguments: [{ kind: "type", type: { kind: "unit" } }, { kind: "type", type: errorType }],
    args: [{ kind: "path", path: "()" }],
  } });
  items.push({ kind: "function", name: functionName, visibility: "public", generics: emptyRustGenerics,
    attrs: [rustHiddenAttribute], ...(selection.asynchronous ? { isAsync: true } : {}), params: [],
    ...(errorType === undefined ? {} : { errorType }), body: { statements } });
  return Object.freeze({ functionName, asynchronous: selection.asynchronous,
    ...(errorType === undefined ? {} : { errorType }), ...(errorName === undefined ? {} : { errorName }),
    items: Object.freeze(items),
  });
}
