import type { Node } from "@tsonic/tsts";
import { rustTypeAliasDeclarationFactKey } from "../../../analysis/facts/keys.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import type { RustProjectTypeDefinition } from "../../../analysis/project-types/type-policy.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectProjectionSelection } from "../../../target-model/types/project-projections.js";
import type { RustProjectUpcastFact } from "../../../target-model/types/value-projections.js";
import { rustOptionElementCarrier, rustSourceUnionCarrierValue } from "../../../target-model/types/index.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { rustStructuralUsageKey, structuralFieldKey } from "./generated-item-usage-helpers.js";
import type { RustDispatchMemberRole, RustGeneratedItemUsage, RustGeneratedItemUsageInput, RustGeneratedProjectFieldRole } from "./generated-item-usage-model.js";

export function createRustGeneratedItemUsageState(input: RustGeneratedItemUsageInput) {
  const storageOwnerKey = (carrier: TargetTypeRef): string => rustStructuralUsageKey(carrier, input.structuralShapes);
  const carriersByDeclaration = new Map<Node, string>();
  for (const declaration of input.declarations) {
    const kind = input.ast.kindName(declaration);
    if (kind !== "KindEnumDeclaration" && kind !== "KindTypeAliasDeclaration") continue;
    if (kind === "KindTypeAliasDeclaration" &&
      input.facts.getFact(declaration, rustTypeAliasDeclarationFactKey)?.kind === "erased") {
      continue;
    }
    const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
    if (carrier === undefined) continue;
    carriersByDeclaration.set(declaration, storageOwnerKey(carrier));
  }

  const structuralFieldReads = new Set<string>();
  const structuralFieldWrites = new Set<string>();
  const readVariantsByCarrier = new Map<string, Set<string>>();
  const constructedVariantsByCarrier = new Map<string, Set<string>>();
  const usedProjectTypes = new WeakSet<Node>();
  const constructedProjectTypes = new WeakSet<Node>();
  const reifiedProjectTypes = new WeakSet<Node>();
  const reifiedCarriers = new WeakSet<TargetTypeRef>();
  const invokedProjectConstructors = new WeakSet<Node>();
  const readAuthoredFields = new WeakSet<Node>();
  const usedProjectFields = new WeakMap<Node, Set<RustGeneratedProjectFieldRole>>();
  const usedDispatchMembers = new WeakMap<Node, Set<RustDispatchMemberRole>>();
  const usedDowncasts = new WeakMap<Node, WeakSet<Node>>();
  const usedCheckedProjections = new WeakSet<Node>();
  const constructedStructuralShapes = new Set<string>();
  const accessedStructuralShapes = new Set<string>();
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
    const targets = usedDowncasts.get(sourceDefinition.declaration) ?? new WeakSet<Node>();
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
      structuralFieldReads.add(structuralFieldKey(key, storageIndex));
    }
  };
  const markStructuralFieldWritten = (carrier: TargetTypeRef, storageIndex: number): void => {
    if (Number.isSafeInteger(storageIndex) && storageIndex >= 0) {
      const key = storageOwnerKey(carrier);
      accessedStructuralShapes.add(key);
      structuralFieldWrites.add(structuralFieldKey(key, storageIndex));
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
      const layout = rustProjectObjectLayout(contract.declaration, input.ast);
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
  const usage: RustGeneratedItemUsage = Object.freeze({
    isProjectTypeUsed: (declaration: Node) => usedProjectTypes.has(declaration),
    isProjectTypeConstructed: (declaration: Node) =>
      constructedProjectTypes.has(declaration),
    isProjectTypeReified: (declaration: Node) => reifiedProjectTypes.has(declaration),
    isProjectConstructorInvoked: (declaration: Node) =>
      invokedProjectConstructors.has(declaration),
    isAuthoredFieldRead: (declaration: Node) => readAuthoredFields.has(declaration),
    isProjectGeneratedFieldUsed: (
      declaration: Node,
      role: RustGeneratedProjectFieldRole,
    ) => usedProjectFields.get(declaration)?.has(role) === true,
    isDispatchMemberUsed: (declaration: Node, role: RustDispatchMemberRole) =>
      usedDispatchMembers.get(declaration)?.has(role) === true,
    isDowncastUsed: (source: Node, target: Node) =>
      usedDowncasts.get(source)?.has(target) === true,
    isCheckedProjectionUsed: (source: Node) => usedCheckedProjections.has(source),
    isStructuralFieldRead: (carrier: TargetTypeRef, storageIndex: number) =>
      structuralFieldReads.has(structuralFieldKey(storageOwnerKey(carrier), storageIndex)),
    isStructuralFieldWritten: (carrier: TargetTypeRef, storageIndex: number) =>
      structuralFieldWrites.has(structuralFieldKey(storageOwnerKey(carrier), storageIndex)),
    isStructuralShapeConstructed: (carrier: TargetTypeRef) =>
      constructedStructuralShapes.has(storageOwnerKey(carrier)),
    isStructuralShapeUsed: (carrier: TargetTypeRef) =>
      constructedStructuralShapes.has(storageOwnerKey(carrier)) || accessedStructuralShapes.has(storageOwnerKey(carrier)),
    isVariantUsed: (declaration: Node, variantName: string) =>
      readVariantsByCarrier.get(carriersByDeclaration.get(declaration) ?? "")?.has(variantName) === true ||
      constructedVariantsByCarrier.get(carriersByDeclaration.get(declaration) ?? "")?.has(variantName) === true,
    isUnionVariantUsed: (carrier: TargetTypeRef, variantName: string) =>
      readVariantsByCarrier.get(storageOwnerKey(carrier))?.has(variantName) === true ||
      constructedVariantsByCarrier.get(storageOwnerKey(carrier))?.has(variantName) === true,
    isUnionVariantConstructed: (carrier: TargetTypeRef, variantName: string) =>
      constructedVariantsByCarrier.get(storageOwnerKey(carrier))?.has(variantName) === true,
    isVariantPayloadRead: (declaration: Node, variantName: string) =>
      readVariantsByCarrier.get(carriersByDeclaration.get(declaration) ?? "")?.has(variantName) === true,
    isUnionVariantPayloadRead: (carrier: TargetTypeRef, variantName: string) =>
      readVariantsByCarrier.get(storageOwnerKey(carrier))?.has(variantName) === true,
  });
  return Object.freeze({ usage, markProjectTypeUsed, markProjectTypeConstructed, markProjectTypeReified, markProjectConstructorInvoked, markProjectCarrierFieldUsed, markDowncastUsed, markProjectionUsed, markStructuralFieldRead, markStructuralFieldWritten, markVariantRead, markVariantConstructed, markStructuralShapeConstructed, markProjectIdentityUsed, markProjectWrapperCloneUsed, markProjectMemberUsed, markProjectUpcastUsed, markAuthoredFieldRead });
}
