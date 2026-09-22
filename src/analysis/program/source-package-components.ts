import type {
  TargetDiagnostic,
} from "@tsonic/target-api/artifacts";
import type {
  RustErrorDomain,
} from "../../target-model/operations/error-boundary.js";
import type {
  RustAnalysisContext,
} from "./context.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey, rustTypeAliasDeclarationFactKey } from "../facts/keys.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustSourcePackageComponentSemantics {
  readonly componentId: string;
  readonly sourceFileNames: readonly string[];
  readonly dependencyComponentIds: readonly string[];
  readonly publishesImplementationAbi: boolean;
  readonly errorDomain: RustErrorDomain;
  readonly errorOwnerComponentId: string | undefined;
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

  for (const definition of context.callableValues.generic.definitions) {
    const components = new Set(definition.implementations.map(implementation =>
      componentIdByFileName.get(normalizePath(implementation.sourceFileName))));
    if (components.size !== 1 || components.has(undefined)) {
      diagnostics.push(componentDiagnostic(
        "RUST_GENERIC_CALLABLE_COMPONENT_NOT_CLOSED",
        "One generic callable environment requires implementations from different source-package components; a backward native dependency cannot be invented.",
      ));
    }
  }
  const dependencies = new Map<string, ReadonlySet<string>>();
  const reachable = (componentId: string): ReadonlySet<string> => {
    const previous = dependencies.get(componentId);
    if (previous !== undefined) return previous;
    const result = new Set<string>();
    const pending = [componentId];
    for (let index = 0; index < pending.length; index++) {
      const current = pending[index]!;
      if (result.has(current)) continue;
      result.add(current);
      pending.push(...componentById.get(current)?.dependencies ?? []);
    }
    dependencies.set(componentId, result);
    return result;
  };
  for (const file of context.sourceFiles) {
    const component = componentIdByFileName.get(normalizePath(context.ast.getFileName(file)));
    if (component === undefined) continue;
    const visited = new Set<TargetTypeRef>();
    const inspected = new Set<string>();
    const inspect = (carrier: TargetTypeRef): void => {
      if (visited.has(carrier)) return;
      visited.add(carrier);
      const definition = context.callableValues.generic.definitionFor(carrier);
      if (definition !== undefined && !inspected.has(definition.identity)) {
        inspected.add(definition.identity);
        const owner = componentIdByFileName.get(normalizePath(definition.ownerFileName));
        if (owner === undefined || !reachable(component).has(owner)) diagnostics.push(componentDiagnostic(
          "RUST_GENERIC_CALLABLE_COMPONENT_NOT_CLOSED",
          "A generic callable's native implementation is not owned by this source package or a declared dependency; an upstream package cannot name a downstream environment.",
        ));
      }
      rustTargetTypeChildren(carrier).forEach(inspect);
    };
    const visit = (node: import("@tsonic/tsts").Node): void => {
      if (context.facts.getFact(node, rustTypeAliasDeclarationFactKey)?.kind === "erased") return;
      for (const carrier of [context.facts.getFact(node, rustRuntimeCarrierKey)?.carrier,
        context.facts.getFact(node, rustSourceCallableReturnFactKey)?.returnCarrier,
        context.facts.getFact(node, rustSourceParameterAbiFactKey)?.parameterCarrier]) {
        if (carrier !== undefined) inspect(carrier);
      }
      context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
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

  const errorOwners = new Map<string, string | undefined>();
  for (const componentId of order) {
    const component = componentById.get(componentId)!;
    const dependencyOwners = new Set(component.dependencies.flatMap((dependency) => {
      const owner = errorOwners.get(dependency);
      return owner === undefined ? [] : [owner];
    }));
    errorOwners.set(componentId, errorComponents.has(componentId) || dependencyOwners.size > 1
      ? componentId : [...dependencyOwners][0]);
  }
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
        errorDomain: errorOwners.get(componentId) !== undefined
          ? "project"
          : "runtime",
        errorOwnerComponentId: errorOwners.get(componentId),
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
