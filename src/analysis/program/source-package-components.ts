import type {
  TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import type {
  RustErrorDomain,
} from "../../target-model/operations/error-boundary.js";
import type {
  RustAnalysisContext,
} from "./context.js";

export interface RustSourcePackageComponentSemantics {
  readonly componentId: string;
  readonly sourceFileNames: readonly string[];
  readonly dependencyComponentIds: readonly string[];
  readonly publishesImplementationAbi: boolean;
  readonly errorDomain: RustErrorDomain;
  readonly root: boolean;
}

export interface RustSourcePackageComponentClassifications {
  readonly components: readonly RustSourcePackageComponentSemantics[];
  readonly rootComponentId: string;
  forComponent(componentId: string): RustSourcePackageComponentSemantics | undefined;
  componentForFile(fileName: string): RustSourcePackageComponentSemantics | undefined;
}

export type AnalyzeRustSourcePackageComponentsResult =
  | {
      readonly kind: "resolved";
      readonly plan: RustSourcePackageComponentClassifications;
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    };

export function analyzeRustSourcePackageComponents(
  context: RustAnalysisContext,
  outputType: "bin" | "lib",
): AnalyzeRustSourcePackageComponentsResult {
  const diagnostics: TargetDiagnostic[] = [];
  const graph = context.sourcePackages;
  const componentById = new Map(graph.components.map((component) =>
    [component.id, component] as const));
  const rootPackage = graph.packages.find((sourcePackage) =>
    sourcePackage.id === graph.rootPackageId);
  if (rootPackage === undefined || !componentById.has(rootPackage.componentId)) {
    return rejected(
      "RUST_SOURCE_PACKAGE_COMPONENT_ROOT_MISSING",
      "The checked source-package graph has no exact root component.",
    );
  }

  const componentIdByFileName = new Map<string, string>();
  for (const sourcePackage of graph.packages) {
    for (const fileName of sourcePackage.sourceFiles) {
      const normalized = normalizePath(fileName);
      const existing = componentIdByFileName.get(normalized);
      if (existing !== undefined && existing !== sourcePackage.componentId) {
        diagnostics.push(componentDiagnostic(
          "RUST_SOURCE_PACKAGE_FILE_COMPONENT_CONFLICT",
          `Source file '${fileName}' belongs to more than one source-package component.`,
        ));
        continue;
      }
      componentIdByFileName.set(normalized, sourcePackage.componentId);
    }
  }

  const sourceFileNamesByComponent = new Map<string, Set<string>>();
  const activeComponentIds = new Set<string>([rootPackage.componentId]);
  for (const sourceFile of context.sourceFiles) {
    const fileName = context.ast.getFileName(sourceFile);
    const componentId = componentIdByFileName.get(normalizePath(fileName));
    if (componentId === undefined) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_IDENTITY_MISSING",
        `Source file '${fileName}' has no exact source-package component identity.`,
      ));
      continue;
    }
    activeComponentIds.add(componentId);
    const names = sourceFileNamesByComponent.get(componentId) ?? new Set<string>();
    names.add(fileName);
    sourceFileNamesByComponent.set(componentId, names);
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }

  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (componentId: string): void => {
    if (visited.has(componentId) || diagnostics.length > 0) {
      return;
    }
    if (visiting.has(componentId)) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_GRAPH_CYCLE",
        `Source-package component '${componentId}' participates in a cycle outside one compiler-owned component.`,
      ));
      return;
    }
    const component = componentById.get(componentId);
    if (component === undefined) {
      diagnostics.push(componentDiagnostic(
        "RUST_SOURCE_PACKAGE_COMPONENT_DEPENDENCY_MISSING",
        `Source-package component '${componentId}' is referenced but absent from the checked component graph.`,
      ));
      return;
    }
    visiting.add(componentId);
    for (const dependency of [...component.dependencies]
      .filter((candidate) => activeComponentIds.has(candidate))
      .sort(compareNames)) {
      visit(dependency);
    }
    visiting.delete(componentId);
    visited.add(componentId);
    order.push(componentId);
  };
  visit(rootPackage.componentId);
  for (const componentId of [...activeComponentIds].sort(compareNames)) {
    visit(componentId);
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }

  const errorComponents = new Set<string>();
  for (const definition of context.projectTypes.programErrorDefinitions) {
    const componentId = componentIdByFileName.get(
      normalizePath(definition.fileName),
    );
    if (componentId === undefined || !activeComponentIds.has(componentId)) {
      diagnostics.push(componentDiagnostic(
        "RUST_PROJECT_ERROR_SOURCE_PACKAGE_MISSING",
        `Project error '${definition.sourceName}' has no exact source-package component identity.`,
      ));
      continue;
    }
    errorComponents.add(componentId);
  }
  if (diagnostics.length > 0) {
    return { kind: "rejected", diagnostics: Object.freeze(diagnostics) };
  }

  const reachesError = new Map<string, boolean>();
  const componentReachesError = (componentId: string): boolean => {
    const existing = reachesError.get(componentId);
    if (existing !== undefined) {
      return existing;
    }
    const component = componentById.get(componentId)!;
    const value = errorComponents.has(componentId) ||
      component.dependencies
        .filter((dependency) => activeComponentIds.has(dependency))
        .some(componentReachesError);
    reachesError.set(componentId, value);
    return value;
  };
  const components = Object.freeze(order.map(
    (componentId): RustSourcePackageComponentSemantics => {
      const component = componentById.get(componentId)!;
      const root = componentId === rootPackage.componentId;
      return Object.freeze({
        componentId,
        sourceFileNames: Object.freeze([
          ...(sourceFileNamesByComponent.get(componentId) ?? []),
        ].sort(compareNames)),
        dependencyComponentIds: Object.freeze([...component.dependencies]
          .filter((candidate) => activeComponentIds.has(candidate))
          .sort(compareNames)),
        publishesImplementationAbi: !root || outputType === "lib",
        errorDomain: componentReachesError(componentId)
          ? "project"
          : "runtime",
        root,
      });
    },
  ));
  const byComponentId = new Map(components.map((component) =>
    [component.componentId, component] as const));
  const byFileName = new Map(components.flatMap((component) =>
    component.sourceFileNames.map((fileName) =>
      [normalizePath(fileName), component] as const)));
  const plan: RustSourcePackageComponentClassifications = {
    components,
    rootComponentId: rootPackage.componentId,
    forComponent(componentId: string) {
      return byComponentId.get(componentId);
    },
    componentForFile(fileName: string) {
      return byFileName.get(normalizePath(fileName));
    },
  };
  return {
    kind: "resolved",
    plan: Object.freeze(plan),
  };
}

function rejected(
  code: string,
  message: string,
): AnalyzeRustSourcePackageComponentsResult {
  return {
    kind: "rejected",
    diagnostics: Object.freeze([componentDiagnostic(code, message)]),
  };
}

function componentDiagnostic(code: string, message: string): TargetDiagnostic {
  return {
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.analysis.source-package-components"],
  };
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
