import type { RustSourcePackageComponentSemantics, RustSourcePackageComponentClassifications, RustSourcePackageComponentIdentities } from "../../target-model/records/program/source-package-semantics.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";

import type { RustAnalysisContext } from "../program/context.js";

import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustClosedErrorTransportDemand } from "../errors/closed-errors.js";

import type { RustNativeStorageSelection } from "../../target-model/records/native/native-storage.js";
import type { RustErrorEffectsFact } from "../../target-model/records/errors/error-effects.js";
import { IsTypeSyntaxNode } from "@tsonic/target-api/source";

export type AnalyzeRustSourcePackageComponentsResult =
  | {
      readonly kind: "resolved";
      readonly plan: RustSourcePackageComponentClassifications;
    }
  | {
      readonly kind: "rejected";
      readonly diagnostics: readonly TargetDiagnostic[];
    };

export type SelectRustSourcePackageComponentIdentitiesResult =
  | { readonly kind: "resolved"; readonly identities: RustSourcePackageComponentIdentities }
  | Extract<AnalyzeRustSourcePackageComponentsResult, { readonly kind: "rejected" }>;

export function selectRustSourcePackageComponentIdentities(
  graph: TargetCompileInput["sourcePackages"],
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): SelectRustSourcePackageComponentIdentitiesResult {
  const diagnostics: TargetDiagnostic[] = [];
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
  for (const sourceFile of sourceFiles) {
    const fileName = ast.getFileName(sourceFile);
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
  return { kind: "resolved", identities: Object.freeze({
    rootComponentId: rootPackage.componentId,
    componentById,
    sourceFileNamesByComponent,
    activeComponentIds,
    componentOrder: Object.freeze(order),
    componentIdForFile(fileName: string) {
      return componentIdByFileName.get(normalizePath(fileName));
    },
  }) };
}

export function analyzeRustSourcePackageComponents(
  context: RustAnalysisContext,
  outputType: "bin" | "lib",
  effectsFor: (node: Node) => RustErrorEffectsFact | undefined,
): AnalyzeRustSourcePackageComponentsResult {
  const selected = context.sourcePackageComponentIdentities;
  if (selected.kind === "rejected") return selected;
  const identities = selected.identities;
  const { componentById, sourceFileNamesByComponent, activeComponentIds, rootComponentId, componentOrder: order } = identities;
  const diagnostics: TargetDiagnostic[] = [];

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
  const errorComponents = new Set<string>();
  const closedErrorsByComponent = new Map<string, { thrownCarriers: TargetTypeRef[]; retained: boolean; sourceView: boolean }>();
  for (const sourceFile of context.sourceFiles) {
    const demand = rustClosedErrorTransportDemand(sourceFile, context.ast, context.records, context.typeDefinitions, context.projectTypes,
      effectsFor, context.isNativeNode);
    const componentId = identities.componentIdForFile(context.ast.getFileName(sourceFile));
    if (demand === undefined) return rejected("RUST_CLOSED_ERROR_DEMAND_UNRESOLVED",
      "Closed Error demand exceeds its bounded exact source-tree contract.");
    if (componentId === undefined) return rejected("RUST_CLOSED_ERROR_SOURCE_PACKAGE_MISSING",
      "Closed Error demand has no exact source-package component identity.");
    const previous = closedErrorsByComponent.get(componentId) ?? { thrownCarriers: [], retained: false, sourceView: false };
    previous.retained ||= demand.retained;
    previous.sourceView ||= demand.sourceView;
    for (const carrier of demand.thrownCarriers) {
      if (!previous.thrownCarriers.some(candidate => rustTargetTypeRefEquals(candidate, carrier))) previous.thrownCarriers.push(carrier);
    }
    closedErrorsByComponent.set(componentId, previous);
    if (demand.retained || demand.sourceView) errorComponents.add(componentId);
  }
  for (const boundary of context.errorStorageDemands.retainedBoundaries) {
    const file = context.ast.getSourceFile(boundary);
    const componentId = file === undefined ? undefined : identities.componentIdForFile(context.ast.getFileName(file));
    if (componentId === undefined) diagnostics.push(componentDiagnostic("RUST_RETAINED_ERROR_SOURCE_PACKAGE_MISSING",
      "Selected native Error retention has no exact source-package component identity."));
    else errorComponents.add(componentId);
  }
  for (const constructor of context.errorStorageDemands.nativeConstructors) {
    if (context.errorStorageDemands.storageFor(constructor).kind !== "writable") continue;
    const file = context.ast.getSourceFile(constructor.node);
    const componentId = file === undefined ? undefined : identities.componentIdForFile(context.ast.getFileName(file));
    if (componentId === undefined) {
      diagnostics.push(componentDiagnostic("RUST_NATIVE_ERROR_SOURCE_PACKAGE_MISSING",
        "Demanded writable Error storage has no exact source-package component identity."));
    } else errorComponents.add(componentId);
  }
  for (const definition of context.projectTypes.programErrorDefinitions) {
    const componentId = identities.componentIdForFile(definition.fileName);
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
      const root = componentId === rootComponentId;
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
        closedErrorDemand: Object.freeze({ retained: closedErrorsByComponent.get(componentId)?.retained ?? false,
          sourceView: closedErrorsByComponent.get(componentId)?.sourceView ?? false,
          thrownCarriers: Object.freeze(closedErrorsByComponent.get(componentId)?.thrownCarriers ?? []) }),
        root,
      });
    },
  ));
  const byComponentId = new Map(components.map((component) =>
    [component.componentId, component] as const));
  for (const componentId of order) reachable(componentId);
  const plan: RustSourcePackageComponentClassifications = {
    components,
    rootComponentId,
    forComponent(componentId: string) {
      return byComponentId.get(componentId);
    },
    componentForFile(fileName: string) {
      const componentId = identities.componentIdForFile(fileName);
      return componentId === undefined ? undefined : byComponentId.get(componentId);
    },
    canReferenceFile(fromFileName: string, targetFileName: string) {
      const from = identities.componentIdForFile(fromFileName);
      const target = identities.componentIdForFile(targetFileName);
      return from !== undefined && target !== undefined && dependencies.get(from)?.has(target) === true;
    },
  };
  return {
    kind: "resolved",
    plan: Object.freeze(plan),
  };
}

export function validateRustGenericSourcePackageComponents(
  context: RustAnalysisContext,
  components: RustSourcePackageComponentClassifications,
): readonly TargetDiagnostic[] {
  const diagnostics: TargetDiagnostic[] = [];
  const { generic, nativeStorage } = context.callableValues;
  const genericCarriers = new Map<TargetTypeRef, boolean>();
  const containsGeneric = (carrier: TargetTypeRef): boolean => {
    const previous = genericCarriers.get(carrier);
    if (previous !== undefined) return previous;
    genericCarriers.set(carrier, false);
    const selected = generic.definitionFor(carrier) !== undefined || rustTargetTypeChildren(carrier).some(containsGeneric);
    genericCarriers.set(carrier, selected);
    return selected;
  };
  for (const file of context.sourceFiles) {
    const fileName = context.ast.getFileName(file);
    if (components.componentForFile(fileName) === undefined) continue;
    const visited = new Set<TargetTypeRef>();
    const inspected = new Set<string>();
    const inspect = (carrier: TargetTypeRef): void => {
      if (visited.has(carrier)) return;
      visited.add(carrier);
      const definition = generic.physical.existingSelectionFor(carrier)?.definition;
      if (definition !== undefined && !inspected.has(definition.identity)) {
        inspected.add(definition.identity);
        if (!components.canReferenceFile(fileName, definition.ownerFileName)) diagnostics.push(componentDiagnostic(
          "RUST_GENERIC_CALLABLE_COMPONENT_NOT_CLOSED",
          "A generic callable's native implementation is not owned by this source package or a declared dependency; an upstream package cannot name a downstream environment.",
        ));
      }
      rustTargetTypeChildren(carrier).forEach(inspect);
    };
    const inspectStorage = (node: import("@tsonic/tsts").Node, carrier: TargetTypeRef | undefined,
      select: () => RustNativeStorageSelection): void => {
      if (carrier === undefined) return;
      if (!containsGeneric(carrier)) { inspect(carrier); return; }
      const selected = select();
      if (selected.kind === "unresolved") diagnostics.push({ ...componentDiagnostic(
        "RUST_GENERIC_CALLABLE_COMPONENT_NOT_CLOSED",
        `A generic callable's physical component identity is unresolved: ${selected.reason}`,
      ), sourceNode: node });
      else inspect(selected.carrier);
    };
    const visit = (node: import("@tsonic/tsts").Node): void => {
      if (!context.isNativeNode(node)) return;
      if (IsTypeSyntaxNode(context.ast, node)) return;
      if (context.records.typeAliasDeclaration.get(node)?.kind === "erased") return;
      inspectStorage(node, context.records.runtimeCarrier.get(node)?.carrier, () => nativeStorage.valueFor(node));
      inspectStorage(node, context.records.sourceCallableReturn.get(node)?.returnCarrier, () => nativeStorage.prepareReturn(node));
      const parameter = context.ast.is.IsParameterDeclaration(node)
        ? context.records.sourceParameterAbi.get(node)?.parameterCarrier : undefined;
      inspectStorage(node, parameter, () => nativeStorage.parameterFor(node));
      context.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
  }
  for (const definition of generic.physical.definitions()) {
    if (components.componentForFile(definition.ownerFileName) === undefined || definition.implementations.some(implementation =>
      !components.canReferenceFile(definition.ownerFileName, implementation.sourceFileName))) diagnostics.push(componentDiagnostic(
      "RUST_GENERIC_CALLABLE_COMPONENT_NOT_CLOSED",
      "A physical generic callable environment has no component path to its exact producer implementation.",
    ));
  }
  return Object.freeze(diagnostics);
}

function rejected(
  code: string,
  message: string,
): Extract<AnalyzeRustSourcePackageComponentsResult, { readonly kind: "rejected" }> {
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
