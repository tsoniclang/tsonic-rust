import type { SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import type { RustSourceFileOutputIdentity } from "../names/source-output-identities.js";
import type { RustItem, RustType } from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import type { RustSourcePackageComponentPlan } from "./source-package-components.js";
import type { RustSourcePackageCrateContentPlan } from "./source-package-crates.js";
import type { RustSourcePackageInitializerPlan } from "./source-package-initializers.js";
import {
  planRustCrateInitializer,
  planRustModuleInitializers,
} from "./module-initialization.js";
import {
  resolveRustSourcePackageErrorBoundary,
  rustSourcePackageErrorTypeIdentity,
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
    const componentErrorType: RustType = {
      kind: "named",
      path: componentErrorDomain.errorDomain === "runtime"
        ? "tsonic_rust_runtime::TsonicError"
        : `crate::${component.programModuleName}::TsonicError`,
      identity: rustSourcePackageErrorTypeIdentity(
        component.componentId,
        componentErrorDomain.errorDomain,
      ),
    };
    const initializers = planRustModuleInitializers(
      input.planning,
      content.sources,
      [target.sourceFile],
      input.packageInitializers,
      input.sourcePackageErrors,
      component.componentId,
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
      initializers,
      functionName,
      componentErrorType,
    );
    const item: RustItem = initializer?.item ?? {
      kind: "function",
      name: functionName,
      visibility: "public",
      attrs: ["#[doc(hidden)]"],
      generics: emptyRustGenerics,
      params: [],
      body: { statements: [] },
    };
    const items = itemsByComponentId.get(component.componentId) ?? [];
    items.push(item);
    itemsByComponentId.set(component.componentId, items);

    const errorBoundary = initializer?.errorType === undefined
      ? undefined
      : resolveRustSourcePackageErrorBoundary(
          input.sourcePackageErrors,
          input.rootComponentId,
          component.componentId,
        );
    if (initializer?.errorType !== undefined && errorBoundary === undefined) {
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
      ...(initializer?.errorType === undefined
        ? {}
        : {
            operandErrorType: component.componentId === input.rootComponentId
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
