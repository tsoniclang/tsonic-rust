import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { SourceFile } from "@tsonic/tsts";
import type { RustInitializerSelection } from "../../../target-model/records/errors/error-regions.js";
import type { RustNativeTaskUse } from "../../../target-model/records/native/native-tasks.js";
import type { RustItem, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustSourcePackageInitializerPlan } from "../../../target-model/records/program/source-packages.js";
import { resolveRustPhysicalProgramErrorBoundary } from "./source-package-errors.js";
import { rustTypeFromCarrierInContext, type RustTypeRenderingContext } from "../types/render.js";
import { planRustSelectedErrorRegion } from "./error-regions.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import { qualifyRustReferencePath, qualifyRustReferenceType } from "../../target-ast/syntax/type-paths.js";
import { rustSourcePackageReferenceScope } from "./source-package-components.js";
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
    const region = planRustSelectedErrorRegion(selected.region, rendering, selected.sourceFile);
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
  readonly errorJoinName: string | undefined;
  readonly errorBoundary: RustFallibleBoundary | undefined;
  readonly items: readonly RustItem[];
}

export function planRustCrateInitializer(
  selection: RustInitializerSelection,
  initializers: readonly RustModuleInitializer[],
  functionName: string,
  rendering: RustTypeRenderingContext,
  occupiedNames: ReadonlySet<string>,
  nativeTasks: Extract<RustNativeTaskUse, { readonly kind: "entry" }> | undefined,
): RustCrateInitializer | undefined {
  if (selection.modules.length === 0) return undefined;
  const selected = selection.error;
  const names = new Set(occupiedNames);
  names.add(functionName);
  const errorName = selected.kind === "native" ? allocateRustGeneratedName(names, "InitializationError") : undefined;
  const joinName = selected.kind === "native" ? allocateRustGeneratedName(names, "InitializationErrors") : undefined;
  const bySourceFile = new Map(initializers.map(initializer => [initializer.sourceFile, initializer]));
  const boundary = planRustInitializerBoundary(selection, initializers, functionName, joinName, rendering);
  const items: RustItem[] = [...(boundary?.kind === "native" ? boundary.join.items : [])];
  const errorType = selected.kind === "infallible" ? undefined : errorName === undefined ? boundary!.errorType : {
      kind: "named", path: `crate::${errorName}`, identity: `initializer-error:${rendering.sourcePackageComponentId}:${functionName}`,
    } satisfies RustType;
  if (errorType !== undefined && errorType.kind !== "named")
    failRustPlannerInvariant("An admitted initializer requires its exact named error return type.", selection.modules[0]?.sourceFile);
  if (errorName !== undefined) items.push({ kind: "type-alias", name: errorName, visibility: "public",
    generics: emptyRustGenerics, target: boundary!.errorType, attrs: [rustHiddenAttribute] });
  const statements: RustStmt[] = [];
  for (const selectedModule of selection.modules) {
    const initializer = bySourceFile.get(selectedModule.sourceFile);
    if (initializer === undefined) failRustPlannerInvariant("An admitted initializer requires its exact sealed module invocation.", selectedModule.sourceFile);
    const task = rendering.input.program.records.nativeTaskUse.get(selectedModule.sourceFile);
    if (task !== undefined && (task.kind !== "entry" || nativeTasks === undefined))
      failRustPlannerInvariant("An admitted task-aware module requires its selected executable entry input.", selectedModule.sourceFile);
    const call = { kind: "call" as const, path: initializer.path,
      args: task?.kind === "entry" && task.initializer !== undefined
        ? [{ kind: "path" as const, path: task.scope.name }] : [] };
    const execution = selectedModule.asynchronous ? { kind: "await" as const, expr: call } : call;
    const nativeSource = selected.kind === "native" ? selected.sources.find(source => source.kind === "module" &&
      source.sourceFile === selectedModule.sourceFile) : undefined;
    const propagated = selectedModule.region.kind === "infallible" ? execution
      : boundary === undefined || initializer.errorBoundary === undefined ? undefined
        : nativeSource !== undefined
          ? rustPropagateNativeError(boundary, { identity: nativeSource.identity,
            errorType: initializer.errorBoundary.errorType }, execution)
          : selectedModule.region.kind === "package"
            ? rustPropagateLocalError(boundary, initializer.errorBoundary.errorType, execution) : undefined;
    if (propagated === undefined) failRustPlannerInvariant("An admitted initializer requires its selected native error propagation.", selectedModule.sourceFile);
    statements.push({ kind: "expr", expr: propagated });
  }
  if (errorType !== undefined) statements.push({ kind: "tail", expr: { kind: "call", path: "Ok",
    genericArguments: [{ kind: "type", type: { kind: "unit" } }, { kind: "type", type: errorType }],
    args: [{ kind: "path", path: "()" }],
  } });
  const taskType = nativeTasks?.initializer === undefined ? undefined
    : rustTypeFromCarrierInContext(nativeTasks.initializer.inputCarrier, rendering);
  if (nativeTasks?.initializer !== undefined && taskType === undefined)
    failRustPlannerInvariant("An admitted entry initializer requires its selected native scope input type.");
  items.push({ kind: "function", name: functionName, visibility: "public", generics: emptyRustGenerics,
    attrs: [rustHiddenAttribute], ...(selection.asynchronous ? { isAsync: true } : {}),
    params: taskType === undefined ? [] : [{ name: nativeTasks!.scope.name, type: taskType }],
    ...(errorType === undefined ? {} : { errorType }), body: { statements } });
  return Object.freeze({ functionName, asynchronous: selection.asynchronous, errorJoinName: joinName, errorBoundary: boundary,
    ...(errorType === undefined ? {} : { errorType }), ...(errorName === undefined ? {} : { errorName }),
    items: Object.freeze(items),
  });
}

export function planRustInitializerBoundary(
  selection: RustInitializerSelection,
  initializers: readonly RustModuleInitializer[],
  functionName: string,
  joinName: string | undefined,
  rendering: RustTypeRenderingContext,
  referenceCrate?: string,
): RustFallibleBoundary | undefined {
  const selected = selection.error;
  if (selected.kind === "infallible") return undefined;
  const references = referenceCrate === undefined ? undefined : rustSourcePackageReferenceScope(rendering, referenceCrate);
  const physicalOwner = resolveRustPhysicalProgramErrorBoundary(rendering.input.program.records,
    rendering.sourcePackageComponentId, selected.owner);
  if (physicalOwner === undefined)
    failRustPlannerInvariant("An admitted initializer requires its exact physical error owner.", selection.modules[0]?.sourceFile);
  const owner = references === undefined ? physicalOwner : {
    ...physicalOwner, errorTypePath: qualifyRustReferencePath(physicalOwner.errorTypePath, references),
  };
  if (selected.kind === "package") return rustPackageFallibleBoundary(owner);
  if (joinName === undefined)
    failRustPlannerInvariant("An admitted initializer requires its exact native error boundary.", selection.modules[0]?.sourceFile);
  const bySourceFile = new Map(initializers.map(initializer => [initializer.sourceFile, initializer]));
  const local = selected.sources.find(source => source.kind === "package");
  const sources = selected.sources.map(source => {
    const type = source.kind === "package" ? rustErrorType(owner) : bySourceFile.get(source.sourceFile)?.errorBoundary?.errorType;
    if (type === undefined)
      failRustPlannerInvariant("An admitted initializer requires its finalized native error-source syntax.", source.kind === "module" ? source.sourceFile : selection.modules[0]?.sourceFile);
    return { identity: source.identity, variant: source.variant,
      errorType: references === undefined ? type : qualifyRustReferenceType(type, references) };
  });
  const join = planRustNativeErrorJoin({
    identity: `initializer:${rendering.sourcePackageComponentId}:${functionName}`, name: joinName,
    referencePath: referenceCrate === undefined ? `crate::${joinName}` : `${referenceCrate}::${joinName}`,
    visibility: "public", resultShape: "result", sources,
  });
  const boundary = join === undefined ? undefined : rustNativeFallibleBoundary(join,
    local === undefined ? undefined : { owner, source: { identity: local.identity, errorType: rustErrorType(owner) } });
  if (boundary === undefined)
    failRustPlannerInvariant("An admitted initializer requires its exact native error boundary.", selection.modules[0]?.sourceFile);
  return boundary;
}
