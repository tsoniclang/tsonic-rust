import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import type { RustSourceFileOutputIdentity } from "../names/source-output-identities.js";
import type { RustItem, RustType } from "../../target-ast/syntax/nodes.js";
import { emptyRustGenerics } from "../../target-ast/syntax/nodes.js";
import type { RustSourcePackageComponentPlan } from "./source-package-components.js";
import type { RustSourcePackageCrateContentPlan } from "./source-package-crates.js";
import type { RustSourcePackageInitializerPlan } from "./source-package-initializers.js";
import type { RustTypeRenderingContext } from "../types/render.js";
import {
  planRustCrateInitializer,
  planRustModuleInitializers,
} from "./module-initialization.js";
import {
  resolveRustSourcePackageErrorBoundary,
  type RustSourcePackageErrorPlan,
} from "./source-package-errors.js";

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
}

export interface RustWorkerEntryPlans {
  readonly entries: readonly RustWorkerEntryPlan[];
  readonly itemsByComponentId: ReadonlyMap<string, readonly RustItem[]>;
}

export function rustWorkerEntryIdentity(
  identity: RustSourceFileOutputIdentity,
): string {
  return `${identity.componentId.length}:${identity.componentId}:${identity.moduleName}`;
}

export function planRustWorkerEntries(input: {
  readonly planning: RustPlanningContext;
  readonly identities: ReadonlyMap<string, RustSourceFileOutputIdentity>;
  readonly components: readonly RustSourcePackageComponentPlan[];
  readonly contentByComponentId: ReadonlyMap<string, RustSourcePackageCrateContentPlan>;
  readonly packageInitializers: RustSourcePackageInitializerPlan;
  readonly sourcePackageErrors: RustSourcePackageErrorPlan;
  readonly rootComponentId: string;
  readonly rootCrateName: string;
  readonly rootErrorType: RustType;
  readonly typeRenderingContextFor: (component: RustSourcePackageComponentPlan) => RustTypeRenderingContext;
  readonly diagnostics: TargetDiagnostic[];
}): RustWorkerEntryPlans | undefined {
  const componentById = new Map(input.components.map((component) =>
    [component.componentId, component] as const));
  const sourceFileByName = new Map(input.planning.program.sourceFiles.map((sourceFile) =>
    [input.planning.program.source.ast.getFileName(sourceFile), sourceFile] as const));
  const occupiedNamesByComponent = new Map<string, Set<string>>();
  const itemsByComponentId = new Map<string, RustItem[]>();
  const entries: RustWorkerEntryPlan[] = [];

  const targets = [...input.planning.program.sourceModuleConstructions.targets()]
    .map((sourceFile) => ({
      sourceFile,
      fileName: input.planning.program.source.ast.getFileName(sourceFile),
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));
  for (const target of targets) {
    const identity = input.identities.get(target.fileName);
    const component = identity === undefined
      ? undefined
      : componentById.get(identity.componentId);
    const content = component === undefined
      ? undefined
      : input.contentByComponentId.get(component.componentId);
    if (identity === undefined || component === undefined || content === undefined ||
      sourceFileByName.get(target.fileName) !== target.sourceFile) {
      input.diagnostics.push(workerDiagnostic(
        "RUST_WORKER_ENTRY_OUTPUT_IDENTITY_MISSING",
        `Worker source module '${target.fileName}' has no exact generated crate/module identity.`,
        target.sourceFile,
      ));
      continue;
    }
    const componentErrorDomain = input.sourcePackageErrors.domainsByComponentId.get(
      component.componentId,
    );
    if (componentErrorDomain === undefined) {
      input.diagnostics.push(workerDiagnostic(
        "RUST_WORKER_ENTRY_ERROR_DOMAIN_MISSING",
        `Worker source module '${target.fileName}' has no exact source-package error domain.`,
        target.sourceFile,
      ));
      continue;
    }
    const selection = input.planning.program.errorRegions.initialization.workerFor(target.sourceFile);
    if (selection === undefined) {
      input.diagnostics.push(workerDiagnostic("RUST_WORKER_ENTRY_ERROR_REGION_MISSING",
        "A worker initializer has no completed exact error composition.", target.sourceFile));
      continue;
    }
    const initializers = planRustModuleInitializers(
      input.planning,
      content.sources,
      selection,
      input.packageInitializers,
      input.typeRenderingContextFor(component),
      input.diagnostics,
    );
    if (initializers === undefined) continue;

    const occupied = occupiedNamesByComponent.get(component.componentId) ?? new Set(
      content.libraryItems.flatMap((item) => "name" in item ? [item.name] : []),
    );
    occupiedNamesByComponent.set(component.componentId, occupied);
    const baseName = `tsonic_worker_${identity.moduleSegments.join("_")}`;
    const functionName = allocateName(baseName, occupied);
    const initializer = planRustCrateInitializer(
      selection,
      initializers,
      functionName,
      input.typeRenderingContextFor(component),
      occupied,
    );
    if (selection.modules.length > 0 && initializer === undefined) {
      input.diagnostics.push(workerDiagnostic("RUST_WORKER_ENTRY_ERROR_RECONSTRUCTION_MISSING",
        "A completed worker error composition has no exact native reconstruction.", target.sourceFile));
      continue;
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
    for (const item of selectedItems) if ("name" in item) occupied.add(item.name);
    const items = itemsByComponentId.get(component.componentId) ?? [];
    items.push(...selectedItems);
    itemsByComponentId.set(component.componentId, items);

    const nativeError = selection.error.kind === "native";
    const errorBoundary = initializer?.errorType === undefined || nativeError
      ? undefined
      : resolveRustSourcePackageErrorBoundary(
          input.sourcePackageErrors,
          input.rootComponentId,
          component.componentId,
        );
    if (initializer?.errorType !== undefined && !nativeError && errorBoundary === undefined) {
      input.diagnostics.push(workerDiagnostic(
        "RUST_WORKER_ENTRY_ERROR_BOUNDARY_MISSING",
        `Worker source module '${target.fileName}' has no exact error conversion into the root executable.`,
        target.sourceFile,
      ));
      continue;
    }
    entries.push(Object.freeze({
      sourceFile: target.sourceFile,
      identity: rustWorkerEntryIdentity(identity),
      componentId: component.componentId,
      functionName,
      callPath: component.root
        ? `${input.rootCrateName}::${functionName}`
        : `${component.crateName}::${functionName}`,
      asynchronous: initializer?.asynchronous === true,
      nativeError,
      errorIdentity: target.fileName,
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
  if (input.diagnostics.length > 0) return undefined;
  return Object.freeze({
    entries: Object.freeze(entries),
    itemsByComponentId: new Map([...itemsByComponentId].map(([componentId, items]) =>
      [componentId, Object.freeze(items)] as const)),
  });
}

function allocateName(baseName: string, occupied: Set<string>): string {
  let candidate = baseName;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  occupied.add(candidate);
  return candidate;
}

function workerDiagnostic(
  code: string,
  message: string,
  sourceNode: SourceFile,
): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    sourceNode,
    evidence: ["target.capability=rust.backend.source-module-construction"],
  };
}
