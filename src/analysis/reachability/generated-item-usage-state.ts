import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";

import type { RustProjectTypeDefinition } from "../project-types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectProjectionSelection } from "../../target-model/types/project-projections.js";
import type { RustProjectUpcastFact } from "../../target-model/records/objects/value-projections.js";
import { rustOptionElementCarrier, rustSourceUnionCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustStructuralUsageKey } from "./generated-item-usage-helpers.js";
import type { RustStructuralUsageKey } from "./generated-item-usage-helpers.js";
import type { RustGeneratedItemUsageInput } from "./generated-item-usage-model.js";
import type { RustDispatchMemberRole, RustGeneratedItemUsage, RustGeneratedProjectFieldRole, RustStructuralReachability, RustVariantReachability } from "../../target-model/records/program/reachability.js";

export function createRustGeneratedItemUsageState(input: RustGeneratedItemUsageInput) {
  const storageKeys = new Map<TargetTypeRef, RustStructuralUsageKey>();
  const storageOwnerKey = (carrier: TargetTypeRef): RustStructuralUsageKey => {
    const existing = storageKeys.get(carrier);
    if (existing !== undefined) return existing;
    const key = rustStructuralUsageKey(carrier, input.structuralShapes);
    storageKeys.set(carrier, key);
    return key;
  };
  for (const definition of [...input.structuralShapes.definitions, ...input.structuralShapes.unionDefinitions]) {
    for (const carrier of definition.sourceCarriers) storageOwnerKey(carrier);
  }
  const carriersByDeclaration = new Map<Node, RustStructuralUsageKey>();
  for (const declaration of input.declarations) {
    const kind = input.ast.kindName(declaration);
    if (kind !== "KindEnumDeclaration" && kind !== "KindTypeAliasDeclaration") continue;
    if (kind === "KindTypeAliasDeclaration" &&
      input.records.typeAliasDeclaration.get(declaration)?.kind === "erased") {
      continue;
    }
    const carrier = input.records.runtimeCarrier.get(declaration)?.carrier;
    if (carrier === undefined) continue;
    carriersByDeclaration.set(declaration, storageOwnerKey(carrier));
  }

  const structuralFieldReads = new Map<RustStructuralUsageKey, Set<number>>();
  const structuralFieldWrites = new Map<RustStructuralUsageKey, Set<number>>();
  const readVariantsByCarrier = new Map<RustStructuralUsageKey, Set<string>>();
  const constructedVariantsByCarrier = new Map<RustStructuralUsageKey, Set<string>>();
  const usedProjectTypes = new Set<Node>();
  const constructedProjectTypes = new Set<Node>();
  const reifiedProjectTypes = new Set<Node>();
  const reifiedCarriers = new WeakSet<TargetTypeRef>();
  const invokedProjectConstructors = new Set<Node>();
  const readAuthoredFields = new Set<Node>();
  const usedProjectFields = new Map<Node, Set<RustGeneratedProjectFieldRole>>();
  const usedDispatchMembers = new Map<Node, Set<RustDispatchMemberRole>>();
  const usedDowncasts = new Map<Node, Set<Node>>();
  const usedCheckedProjections = new Set<Node>();
  const constructedStructuralShapes = new Set<RustStructuralUsageKey>();
  const accessedStructuralShapes = new Set<RustStructuralUsageKey>();
  const markProjectTypeUsed = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition !== undefined) usedProjectTypes.add(definition.declaration);
  };
  const markProjectTypeConstructed = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition === undefined) return;
    usedProjectTypes.add(definition.declaration);
    constructedProjectTypes.add(definition.declaration);
  };
  const markProjectTypeReified = (carrier: TargetTypeRef): void => {
    if (reifiedCarriers.has(carrier)) return;
    reifiedCarriers.add(carrier);
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition !== undefined) {
      usedProjectTypes.add(definition.declaration);
      reifiedProjectTypes.add(definition.declaration);
    }
    rustTargetTypeChildren(carrier).forEach(markProjectTypeReified);
  };
  const markProjectConstructorInvoked = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    if (definition?.kind !== "class") return;
    markProjectTypeConstructed(carrier);
    invokedProjectConstructors.add(definition.declaration);
  };
  const markProjectFieldUsed = (
    declaration: Node | undefined,
    role: RustGeneratedProjectFieldRole,
  ): void => {
    if (declaration === undefined) return;
    const roles = usedProjectFields.get(declaration) ?? new Set<RustGeneratedProjectFieldRole>();
    roles.add(role);
    usedProjectFields.set(declaration, roles);
  };
  const markProjectCarrierFieldUsed = (
    carrier: TargetTypeRef | undefined,
    role: RustGeneratedProjectFieldRole,
  ): void => {
    markProjectFieldUsed(input.projectTypes.definitionForCarrier(carrier)?.declaration, role);
  };
  const markDispatchMemberUsed = (
    declaration: Node | undefined,
    role: RustDispatchMemberRole,
  ): void => {
    if (declaration === undefined) return;
    const roles = usedDispatchMembers.get(declaration) ?? new Set<RustDispatchMemberRole>();
    roles.add(role);
    usedDispatchMembers.set(declaration, roles);
    const implementation = input.navigation.callableImplementation(declaration);
    if (implementation.kind === "resolved" &&
      implementation.implementation.declaration !== declaration) {
      const selected = implementation.implementation.declaration;
      const implementationRoles = usedDispatchMembers.get(selected) ??
        new Set<RustDispatchMemberRole>();
      implementationRoles.add(role);
      usedDispatchMembers.set(selected, implementationRoles);
    }
  };
  const markDowncastUsed = (source: TargetTypeRef, target: TargetTypeRef): void => {
    const sourceDefinition = input.projectTypes.definitionForCarrier(source);
    const targetDefinition = input.projectTypes.definitionForCarrier(target);
    if (sourceDefinition === undefined || targetDefinition === undefined) return;
    if (input.projectTypes.downcastRoute(sourceDefinition, target)?.kind === "checked") {
      usedCheckedProjections.add(sourceDefinition.declaration);
    }
    const targets = usedDowncasts.get(sourceDefinition.declaration) ?? new Set<Node>();
    targets.add(targetDefinition.declaration);
    usedDowncasts.set(sourceDefinition.declaration, targets);
  };
  const markProjectionUsed = (
    source: TargetTypeRef, target: TargetTypeRef, selection: RustProjectProjectionSelection,
  ): void => {
    markDowncastUsed(source, target);
    if (selection.kind !== "checked" && selection.kind !== "structural") return;
    const definition = input.projectTypes.definitionForCarrier(source);
    if (definition !== undefined) usedCheckedProjections.add(definition.declaration);
  };
  const markStructuralFieldRead = (carrier: TargetTypeRef, storageIndex: number): void => {
    if (Number.isSafeInteger(storageIndex) && storageIndex >= 0) {
      const key = storageOwnerKey(carrier);
      accessedStructuralShapes.add(key);
      const fields = structuralFieldReads.get(key) ?? new Set<number>();
      fields.add(storageIndex);
      structuralFieldReads.set(key, fields);
    }
  };
  const markStructuralFieldWritten = (carrier: TargetTypeRef, storageIndex: number): void => {
    if (Number.isSafeInteger(storageIndex) && storageIndex >= 0) {
      const key = storageOwnerKey(carrier);
      accessedStructuralShapes.add(key);
      const fields = structuralFieldWrites.get(key) ?? new Set<number>();
      fields.add(storageIndex);
      structuralFieldWrites.set(key, fields);
    }
  };
  const markVariantRead = (carrier: TargetTypeRef, variantName: string): void => {
    const key = storageOwnerKey(carrier);
    const variants = readVariantsByCarrier.get(key) ?? new Set<string>();
    variants.add(variantName);
    readVariantsByCarrier.set(key, variants);
  };
  const markVariantConstructed = (carrier: TargetTypeRef, variantName: string): void => {
    const key = storageOwnerKey(carrier);
    const variants = constructedVariantsByCarrier.get(key) ?? new Set<string>();
    variants.add(variantName);
    constructedVariantsByCarrier.set(key, variants);
    if (rustSourceUnionCarrierValue(carrier)?.origin === "generated") {
      constructedStructuralShapes.add(key);
    }
  };
  const markStructuralShapeConstructed = (carrier: TargetTypeRef | undefined): void => {
    if (carrier !== undefined) constructedStructuralShapes.add(storageOwnerKey(carrier));
  };
  const markProjectIdentityUsed = (carrier: TargetTypeRef | undefined): void => {
    const selected = carrier !== undefined &&
        input.projectTypes.definitionForCarrier(carrier) === undefined
      ? rustOptionElementCarrier(carrier)
      : carrier;
    markProjectCarrierFieldUsed(selected, "wrapper-identity");
  };
  const markProjectWrapperCloneUsed = (carrier: TargetTypeRef | undefined): void => {
    const definition = input.projectTypes.definitionForCarrier(carrier);
    const representation = input.objectRepresentations.representationFor(definition);
    if (definition === undefined || representation === undefined) return;
    if (representation.kind === "open-hierarchy" || representation.kind === "closed-hierarchy") {
      markProjectFieldUsed(definition.declaration, "wrapper-identity");
      markProjectFieldUsed(definition.declaration, "wrapper-dispatch");
      return;
    }
    if (representation.kind !== "value") {
      markProjectFieldUsed(definition.declaration, "wrapper-state");
    }
  };
  const markProjectStateOwnerUsed = (
    concrete: RustProjectTypeDefinition,
    storageOwner: RustProjectTypeDefinition,
  ): void => {
    const lineage = input.projectTypes.classLineage(concrete);
    const ownerIndex = lineage === undefined
      ? -1
      : lineage.indexOf(storageOwner);
    if (ownerIndex < 0 || lineage === undefined) return;
    for (let index = ownerIndex + 1; index < lineage.length; index += 1) {
      markProjectFieldUsed(lineage[index]!.declaration, "base-state");
    }
  };
  const markProjectStatePathUsed = (
    concrete: RustProjectTypeDefinition,
    implementation: Node,
  ): void => {
    const storageOwner = input.projectTypes.definitionContainingDeclaration(implementation);
    if (storageOwner !== undefined) markProjectStateOwnerUsed(concrete, storageOwner);
  };
  const markProjectMemberUsed = (
    receiverCarrier: TargetTypeRef,
    declaration: Node | undefined,
    role: RustDispatchMemberRole,
  ): void => {
    if (declaration === undefined) return;
    markDispatchMemberUsed(declaration, role);
    const receiver = input.projectTypes.definitionForCarrier(receiverCarrier) ??
      input.projectTypes.definitionContainingDeclaration(declaration);
    if (receiver === undefined) return;
    for (const concrete of input.projectTypes.concreteClassesFor(receiver)) {
      const selected = input.projectTypes.memberImplementation(concrete, declaration);
      const implementation = selected.kind === "resolved"
        ? selected.implementation.declaration
        : declaration;
      if (role === "read" || role === "write" || role === "content" || role === "capture") {
        markProjectStatePathUsed(concrete, implementation);
        if (role !== "write") readAuthoredFields.add(implementation);
        continue;
      }
      if (input.projectMethodProperties.usageFor(implementation)?.writable === true) {
        markProjectStatePathUsed(concrete, implementation);
      }
    }
  };

  const markProjectUpcastUsed = (upcast: RustProjectUpcastFact): void => {
    for (const carrier of upcast.sourceVariants?.map(variant => variant.carrier) ?? [upcast.sourceCarrier]) {
      markProjectTypeUsed(carrier);
      markProjectCarrierFieldUsed(carrier, "wrapper-identity");
      markProjectCarrierFieldUsed(carrier, "wrapper-dispatch");
    }
    markProjectTypeConstructed(upcast.targetCarrier);
  };
  const markAuthoredFieldRead = (declaration: Node): void => { readAuthoredFields.add(declaration); };

  for (const concrete of input.projectTypes.definitions) {
    for (const { sourceCarrier, route } of input.declarationGenericRequirements.projectionImplementationsFor(concrete)) {
      markProjectCarrierFieldUsed(sourceCarrier, "wrapper-identity");
      markProjectCarrierFieldUsed(sourceCarrier, "wrapper-dispatch");
      markProjectTypeConstructed(route.targetCarrier);
      markProjectionUsed(sourceCarrier, route.targetCarrier, route);
    }
    if (concrete.kind !== "class" || !input.projectTypes.isPolymorphic(concrete)) continue;
    const contracts = input.projectTypes.contractsForClass(concrete);
    if (contracts === undefined) continue;
    for (const contract of contracts) {
      const layout = input.projectTypes.objectLayoutForDefinition(contract);
      const contractFields = [
        ...(input.projectTypes.externalBaseForDefinition(contract)?.fields ?? []).map((field) => ({
          declaration: field.declaration,
          external: true,
        })),
        ...(layout?.fields ?? []).map((field) => ({
          declaration: field.declaration,
          external: false,
        })),
      ];
      for (const field of contractFields) {
        const implementation = field.external
          ? { kind: "stored" as const, declaration: field.declaration }
          : input.projectFieldDispatch.implementationFor(concrete, field.declaration);
        if (implementation?.kind === "stored") {
          const owner = input.projectTypes.definitionContainingDeclaration(
            implementation.declaration,
          ) ?? contract;
          markProjectStateOwnerUsed(concrete, owner);
        }
      }
      for (const member of input.ast.members(contract.declaration)) {
        if (member === undefined || input.ast.hasModifierKind(member, "static")) continue;
        const kind = input.ast.kindName(member);
        if (kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature" &&
          kind !== "KindGetAccessor" && kind !== "KindSetAccessor") {
          continue;
        }
        const selected = input.projectTypes.memberImplementation(concrete, member);
        if (selected.kind !== "resolved") continue;
        const implementation = selected.implementation.declaration;
        if ((kind === "KindMethodDeclaration" || kind === "KindMethodSignature") &&
          (input.projectMethodProperties.usageFor(member)?.writable === true ||
            input.projectMethodProperties.usageFor(implementation)?.writable === true)) {
          markProjectStatePathUsed(concrete, implementation);
        }
      }
    }
  }
  const seal = (): Omit<RustGeneratedItemUsage, "recordContributions" | "projectThisReferences"> => {
    const emptyStrings: ReadonlySet<string> = new Set();
    const emptyNumbers: ReadonlySet<number> = new Set();
    const byStorage = new Map<RustStructuralUsageKey, RustStructuralReachability>();
    const structuralCarriers = new Map<TargetTypeRef, RustStructuralReachability>();
    for (const [carrier, key] of storageKeys) {
      let selected = byStorage.get(key);
      if (selected === undefined) {
        selected = Object.freeze({
          constructed: constructedStructuralShapes.has(key),
          used: constructedStructuralShapes.has(key) || accessedStructuralShapes.has(key),
          fieldsRead: structuralFieldReads.get(key) ?? emptyNumbers,
          fieldsWritten: structuralFieldWrites.get(key) ?? emptyNumbers,
          variants: Object.freeze({
            used: new Set([...(readVariantsByCarrier.get(key) ?? emptyStrings),
              ...(constructedVariantsByCarrier.get(key) ?? emptyStrings)]),
            read: readVariantsByCarrier.get(key) ?? emptyStrings,
            constructed: constructedVariantsByCarrier.get(key) ?? emptyStrings,
          }),
        });
        byStorage.set(key, selected);
      }
      structuralCarriers.set(carrier, selected);
    }
    const declarationVariants = new Map<Node, RustVariantReachability>();
    for (const [declaration, key] of carriersByDeclaration) {
      const selected = byStorage.get(key);
      if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "A source declaration lost its sealed physical usage record.");
      declarationVariants.set(declaration, selected.variants);
    }
    return Object.freeze({
      usedProjectTypes, constructedProjectTypes, reifiedProjectTypes, invokedProjectConstructors,
      readAuthoredFields, usedProjectFields, usedDispatchMembers, usedDowncasts,
      usedCheckedProjections, structuralCarriers, declarationVariants,
    });
  };
  return Object.freeze({ seal, markProjectTypeUsed, markProjectTypeConstructed, markProjectTypeReified, markProjectConstructorInvoked, markProjectCarrierFieldUsed, markDowncastUsed, markProjectionUsed, markStructuralFieldRead, markStructuralFieldWritten, markVariantRead, markVariantConstructed, markStructuralShapeConstructed, markProjectIdentityUsed, markProjectWrapperCloneUsed, markProjectMemberUsed, markProjectUpcastUsed, markAuthoredFieldRead });
}
