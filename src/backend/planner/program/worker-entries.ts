import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { SourceFile } from "@tsonic/tsts";
import type { RustPlanningContext } from "../context.js";
import type { RustItem, RustType } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import { rustItemBindingNames } from "../../target-ast/syntax/item-bindings.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import type { RustSourcePackageComponentPlan } from "../../../target-model/records/program/source-packages.js";
import type { RustSourcePackageCrateContentPlan } from "./source-package-crates.js";
import type { RustSourcePackageInitializerPlan } from "../../../target-model/records/program/source-packages.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import {
  planRustCrateInitializer,
  planRustInitializerBoundary,
  planRustModuleInitializers,
} from "./module-initialization.js";
import { resolveRustSourcePackageErrorBoundary } from "./source-package-errors.js";
import type { RustSourcePackageErrorPlan } from "../../../target-model/records/errors/source-package-errors.js";
import type { RustInitializerErrorSelection } from "../../../target-model/records/errors/error-regions.js";
import type { RustFallibleBoundary } from "./fallible-boundaries.js";

export interface RustWorkerEntryPlan {
  readonly sourceFile: SourceFile;
  readonly identity: string;
  readonly componentId: string;
  readonly functionName: string;
  readonly callPath: string;
  readonly asynchronous: boolean;
  readonly operandErrorType?: RustType;
  readonly nativeError: boolean;
  readonly errorIdentity: string;
  readonly initializerError: RustInitializerErrorSelection;
  readonly initializerBoundary: RustFallibleBoundary | undefined;
}

export interface RustWorkerEntryPlans {
  readonly entries: readonly RustWorkerEntryPlan[];
  readonly itemsByComponentId: ReadonlyMap<string, readonly RustItem[]>;
}

export function planRustWorkerEntries(input: {
  readonly planning: RustPlanningContext;
  readonly components: readonly RustSourcePackageComponentPlan[];
  readonly contentByComponentId: ReadonlyMap<string, RustSourcePackageCrateContentPlan>;
  readonly packageInitializers: RustSourcePackageInitializerPlan;
  readonly sourcePackageErrors: RustSourcePackageErrorPlan;
  readonly rootComponentId: string;
  readonly rootCrateName: string;
  readonly rootErrorType: RustType;
  readonly typeRenderingContextFor: (component: RustSourcePackageComponentPlan) => RustTypeRenderingContext;
}): RustWorkerEntryPlans {
  const componentById = new Map(input.components.map((component) =>
    [component.componentId, component] as const));
  const occupiedNamesByComponent = new Map<string, Set<string>>();
  const itemsByComponentId = new Map<string, RustItem[]>();
  const entries: RustWorkerEntryPlan[] = [];

  const targets = input.planning.program.records.workerEntries.get();
  if (targets === undefined) failRustPlannerInvariant("Worker entries require their admitted exact source inventory.");
  for (const target of targets) {
    const identity = target.sourceIdentity;
    const component = componentById.get(target.componentId);
    const content = component === undefined
      ? undefined
      : input.contentByComponentId.get(component.componentId);
    if (identity === undefined || component === undefined || content === undefined)
      failRustPlannerInvariant("An admitted worker entry requires its component source artifact.", target.sourceFile);
    const componentErrorDomain = input.sourcePackageErrors.domainsByComponentId.get(
      component.componentId,
    );
    if (componentErrorDomain === undefined) {
      failRustPlannerInvariant("An admitted worker entry requires its component error domain.", target.sourceFile);
    }
    const selection = target.initializer;
    const initializers = planRustModuleInitializers(
      selection,
      input.packageInitializers,
      input.typeRenderingContextFor(component),
    );

    const occupied = occupiedNamesByComponent.get(component.componentId) ?? new Set(
      content.libraryItems.flatMap(rustItemBindingNames),
    );
    occupiedNamesByComponent.set(component.componentId, occupied);
    const baseName = `tsonic_worker_${identity.moduleSegments.join("_")}`;
    const functionName = allocateRustGeneratedName(occupied, baseName);
    const initializer = planRustCrateInitializer(
      selection,
      initializers,
      functionName,
      input.typeRenderingContextFor(component),
      occupied,
      undefined,
    );
    if (selection.modules.length > 0 && initializer === undefined) {
      failRustPlannerInvariant(
        "A completed worker error composition has no exact native reconstruction.", target.sourceFile);
    }
    const emptyItem: RustItem = {
      kind: "function",
      name: functionName,
      visibility: "public",
      attrs: [rustHiddenAttribute],
      generics: emptyRustGenerics,
      params: [],
      body: { statements: [] },
    };
    const selectedItems = initializer?.items ?? [emptyItem];
    for (const name of selectedItems.flatMap(rustItemBindingNames)) occupied.add(name);
    const items = itemsByComponentId.get(component.componentId) ?? [];
    items.push(...selectedItems);
    itemsByComponentId.set(component.componentId, items);

    const nativeError = selection.error.kind === "native";
    const errorBoundary = initializer?.errorType === undefined || nativeError
      ? undefined
      : resolveRustSourcePackageErrorBoundary(
          input.planning.program.records,
          input.rootComponentId,
          component.componentId,
        );
    if (initializer?.errorType !== undefined && !nativeError && errorBoundary === undefined) {
      failRustPlannerInvariant("An admitted worker entry requires its exact root error conversion.", target.sourceFile);
    }
    entries.push(Object.freeze({
      sourceFile: target.sourceFile,
      identity: target.identity,
      componentId: component.componentId,
      functionName,
      callPath: component.root
        ? `${input.rootCrateName}::${functionName}`
        : `${component.crateName}::${functionName}`,
      asynchronous: initializer?.asynchronous === true,
      nativeError,
      errorIdentity: target.fileName,
      initializerError: selection.error,
      initializerBoundary: initializer?.errorType === undefined ? undefined
        : planRustInitializerBoundary(selection, initializers, functionName, initializer.errorJoinName,
          input.typeRenderingContextFor(component), component.root ? input.rootCrateName : component.crateName),
      ...(initializer?.errorType === undefined
        ? {}
        : {
            operandErrorType: nativeError ? {
              kind: "named" as const,
              path: `${component.root ? input.rootCrateName : component.crateName}::${initializer.errorName}`,
              identity: initializer.errorType.identity,
            } : component.componentId === input.rootComponentId
              ? input.rootErrorType
              : {
                  kind: "named" as const,
                  path: errorBoundary!.errorTypePath,
                  identity: errorBoundary!.errorTypeIdentity,
                },
          }),
    }));
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    itemsByComponentId: new Map([...itemsByComponentId].map(([componentId, items]) =>
      [componentId, Object.freeze(items)] as const)),
  });
}
