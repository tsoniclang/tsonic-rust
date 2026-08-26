import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustSourceGenericIndex } from "../../policy/types/source-generics.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustProviderTypeRow } from "../../providers/packages/model.js";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustDeclarationContractIndex } from "../declarations/declaration-applications.js";
import { rustSourceOwnershipOperationFactKey } from "../../source/semantics/facts.js";
import type {
  RustBound,
  RustDropImplementationProof,
  RustLifetimeRef,
  RustTraitRef,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import {
  rustSemanticIdentitiesEqual,
  rustSemanticIdentityKey,
  rustTypeSemanticKey,
} from "../../target-model/semantics/index.js";
import {
  isRustNullishSourceCarrier,
  rustDropTrait,
  rustSendTrait,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustStructuralObjectCarrierValue,
  rustSyncTrait,
  type RustTypeParameterTraitResolver,
  type RustTraitSupportQueries,
} from "../../target-model/types/index.js";
import { rustTraitReferenceEquals } from "../../target-model/types/equality.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type { RustSourceValueInventory } from "./source-values.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustStructuralShapePlan } from "../objects/structural-shape-plan.js";
import type { RustProjectFieldDispatchQueries } from "../project-types/field-dispatch.js";
import { requireDenseRustOwnershipNodes } from "./source-shape.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";

export interface RustOwnershipAnalysisInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly navigation: SourceProgramNavigation;
  readonly facts: RustPlanQueries;
  readonly sourceGenerics: RustSourceGenericIndex;
  readonly providerTypes: readonly RustProviderTypeRow[];
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: RustObjectRepresentationPlan;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly projectFieldDispatch: RustProjectFieldDispatchQueries;
  readonly declarationContracts: RustDeclarationContractIndex;
  readonly traits: RustTraitSupportQueries;
}

export interface RustOwnershipEnvironment {
  supportsTrait(type: RustTypeRef, trait: RustTraitRef): boolean;
  supportsTraitBound(
    type: RustTypeRef,
    bound: Extract<RustBound, { readonly kind: "trait" }>,
  ): boolean;
  lifetimeOutlives(longer: RustLifetimeRef, shorter: RustLifetimeRef): boolean;
  typeOutlives(type: RustTypeRef, lifetime: RustLifetimeRef): boolean;
  pinPointerCarrier(type: RustTypeRef): RustTypeRef | undefined;
  customDropProof(type: RustTypeRef): RustDropImplementationProof | undefined;
}

export function createRustOwnershipEnvironment(
  input: RustOwnershipAnalysisInput,
  inventory: RustOwnershipNodeInventory,
  sourceValues: RustSourceValueInventory,
): RustOwnershipEnvironment {
  const typeParameterSupports = createTypeParameterTraitResolver(input.sourceGenerics);
  const lifetimeEdges = collectLifetimeEdges(input.sourceGenerics);
  const typeOutlivesEdges = collectTypeOutlivesEdges(input.sourceGenerics);
  const lifetimeRegionEdges = collectLifetimeRegionEdges(inventory, sourceValues, input);
  const pinRoles = input.providerTypes.flatMap((row) =>
    (row.semanticRoles ?? []).filter((role) => role.kind === "pin-wrapper").map((role) => Object.freeze({
      role,
      identity: row.targetCarrier.kind === "path"
        ? row.targetCarrier.identity
        : undefined,
    }))).filter((entry) => entry.identity !== undefined);
  const projectAutoTraitMemo = new Map<string, boolean>();
  const projectAutoTraitVisiting = new Set<string>();
  const environment: RustOwnershipEnvironment = Object.freeze<RustOwnershipEnvironment>({
    supportsTrait(type, trait) {
      const project = input.projectTypes.definitionForCarrier(type);
      if (project !== undefined &&
        (rustSemanticIdentitiesEqual(trait.identity, rustSendTrait.identity) ||
          rustSemanticIdentitiesEqual(trait.identity, rustSyncTrait.identity))) {
        return projectDefinitionSupportsAutoTrait(project, type, trait);
      }
      return input.traits.supportsTrait(type, trait, typeParameterSupports);
    },
    supportsTraitBound(type, bound) {
      if (bound.polarity === "maybe") return true;
      if (bound.polarity !== "required") return false;
      if (bound.binder === undefined) {
        return environment.supportsTrait(type, bound.trait);
      }
      return input.traits.supportsTraitBound(type, bound, typeParameterSupports);
    },
    lifetimeOutlives(longer, shorter) {
      if (lifetimesEqual(longer, shorter) || longer.kind === "static") return true;
      if (shorter.kind === "inferred-region") {
        if (longer.kind === "inferred-region" &&
          inventory.lexicalRegions.contains(longer.regionId, shorter.regionId)) return true;
        const pending = [lifetimeIdentity(longer)].filter((entry): entry is string =>
          entry !== undefined);
        const seen = new Set<string>();
        while (pending.length > 0) {
          const selected = pending.pop()!;
          if (seen.has(selected)) continue;
          seen.add(selected);
          if ([...(lifetimeRegionEdges.get(selected) ?? [])].some((regionId) =>
            inventory.lexicalRegions.contains(regionId, shorter.regionId))) return true;
          pending.push(...(lifetimeEdges.get(selected) ?? []));
        }
        return false;
      }
      const start = lifetimeIdentity(longer);
      const target = lifetimeIdentity(shorter);
      if (start === undefined || target === undefined) return false;
      const pending = [...(lifetimeEdges.get(start) ?? [])];
      const seen = new Set<string>();
      while (pending.length > 0) {
        const selected = pending.pop()!;
        if (selected === target) return true;
        if (seen.has(selected)) continue;
        seen.add(selected);
        pending.push(...(lifetimeEdges.get(selected) ?? []));
      }
      return false;
    },
    typeOutlives(type, lifetime) {
      switch (type.kind) {
        case "source-primitive":
        case "primitive":
        case "never":
        case "unit":
        case "str":
        case "function-pointer":
        case "raw-pointer":
          return true;
        case "reference":
          return environment.lifetimeOutlives(type.lifetime, lifetime) &&
            environment.typeOutlives(type.target, lifetime);
        case "tuple":
          return type.elements.every((element) =>
            environment.typeOutlives(element, lifetime));
        case "array":
        case "sequence":
        case "slice":
          return environment.typeOutlives(type.element, lifetime);
        case "path":
          return type.arguments.every((argument) => argument.kind !== "lifetime" ||
            environment.lifetimeOutlives(argument.value, lifetime)) &&
            type.arguments.every((argument) => argument.kind !== "type" ||
              environment.typeOutlives(argument.value, lifetime));
        case "type-parameter": {
          const declared = typeOutlivesEdges.get(rustSemanticIdentityKey(type.identity));
          return declared !== undefined && declared.some((candidate) =>
            environment.lifetimeOutlives(candidate, lifetime));
        }
        case "trait-object":
          return environment.lifetimeOutlives(type.lifetime, lifetime);
        case "opaque":
          return type.captures.every((capture) => {
            switch (capture.kind) {
              case "const": return true;
              case "lifetime":
                return environment.lifetimeOutlives(capture.value, lifetime);
              case "type":
                return typeParameterIdentityOutlives(
                  capture.identity,
                  lifetime,
                  typeOutlivesEdges,
                  environment,
                );
            }
            return false;
          });
        case "source-carrier": {
          if (isRustNullishSourceCarrier(type)) return true;
          const sourceType = rustSourceTypeCarrierValue(type);
          if (sourceType !== undefined) {
            return sourceType.genericArguments.every((argument) => {
              if (argument.kind === "const") return true;
              if (argument.kind === "lifetime") {
                return environment.lifetimeOutlives(argument.value, lifetime);
              }
              return environment.typeOutlives(argument.value, lifetime);
            });
          }
          const structuralObject = rustStructuralObjectCarrierValue(type);
          if (structuralObject !== undefined) {
            return structuralObject.fields.every((field) =>
              environment.typeOutlives(field.type, lifetime));
          }
          const sourceUnion = rustSourceUnionCarrierValue(type);
          return sourceUnion !== undefined && sourceUnion.variants.every((variant) =>
            environment.typeOutlives(variant.carrier, lifetime));
        }
        case "closure":
        case "associated-type":
        case "self":
        case "inference-variable":
          return false;
      }
    },
    pinPointerCarrier(type) {
      if (type.kind !== "path") return undefined;
      for (const entry of pinRoles) {
        if (entry.identity !== undefined &&
          rustSemanticIdentitiesEqual(entry.identity, type.identity)) {
          const selected = type.arguments[entry.role.pointerArgumentIndex];
          return selected?.kind === "type" ? selected.value : undefined;
        }
      }
      return undefined;
    },
    customDropProof(type) {
      if (environment.supportsTrait(type, rustDropTrait)) {
        return Object.freeze({
          kind: "trait" as const,
          proof: Object.freeze({
            trait: rustDropTrait.identity,
            type,
            evidenceId: `provider-drop\0${rustTypeSemanticKey(type)}`,
          }),
        });
      }
      const definition = input.projectTypes.definitionForCarrier(type);
      const definitionMembers = definition === undefined
        ? Object.freeze([])
        : requireDenseRustOwnershipNodes(
            input.ast.members(definition.declaration),
            "Project declaration contains an undefined member slot during Drop analysis.",
            definition.declaration,
          );
      const declaration = definition === undefined
        ? undefined
        : definitionMembers.find((member) =>
            input.declarationContracts.forDeclaration(member)?.nativeDrop === true);
      if (declaration === undefined) return undefined;
      const sourceFile = input.ast.getSourceFile(declaration);
      return Object.freeze({
        kind: "declaration" as const,
        declaration: Object.freeze({
          kind: "project" as const,
          packageId: "source-program",
          sourceFileId: input.ast.getPath(sourceFile),
          declarationId: `drop:${requireRustOwnershipSourceIdentity(input.ast, declaration)}`,
        }),
      });
    },
  });
  return environment;

  function projectDefinitionSupportsAutoTrait(
    definition: import("../../policy/types/project-types.js").RustProjectTypeDefinition,
    carrier: RustTypeRef,
    trait: RustTraitRef,
  ): boolean {
    const traitKey = rustSemanticIdentityKey(trait.identity);
    const key = `${definition.fileName}\0${definition.sourceName}\0${traitKey}\0${rustTypeSemanticKey(carrier)}`;
    const cached = projectAutoTraitMemo.get(key);
    if (cached !== undefined) return cached;
    const explicit = explicitProjectAutoTraitDecision(definition, trait);
    if (explicit !== undefined) {
      projectAutoTraitMemo.set(key, explicit);
      return explicit;
    }
    if (projectAutoTraitVisiting.has(key)) return true;
    projectAutoTraitVisiting.add(key);
    const representation = input.objectRepresentations.representationFor(definition);
    if (representation?.kind !== "value") {
      projectAutoTraitVisiting.delete(key);
      projectAutoTraitMemo.set(key, false);
      return false;
    }
    const requiredTrait = rustSemanticIdentitiesEqual(trait.identity, rustSyncTrait.identity)
      ? rustSyncTrait
      : rustSendTrait;
    const fields = requireDenseRustOwnershipNodes(
      input.ast.members(definition.declaration),
      "Project declaration contains an undefined member slot during auto-trait analysis.",
      definition.declaration,
    ).filter((member) =>
      !input.ast.hasModifierKind(member, "static") &&
      (input.ast.kindName(member) === "KindPropertyDeclaration" ||
        input.ast.kindName(member) === "KindPropertySignature"));
    const fieldTypes = fields.map((field) => {
      const declared = input.facts.getRuntimeCarrierFact(field)?.carrier;
      return declared === undefined
        ? undefined
        : input.projectTypes.instantiateMemberCarrier(field, carrier, declared);
    });
    const heritageTypes = input.projectTypes.heritageForDefinition(definition)
      .filter((edge) => edge.kind === "extends")
      .map((edge) => edge.targetType);
    const supported = fieldTypes.every((field) => field !== undefined &&
      environment.supportsTrait(field, requiredTrait)) &&
      heritageTypes.every((base) => environment.supportsTrait(base, requiredTrait));
    projectAutoTraitVisiting.delete(key);
    projectAutoTraitMemo.set(key, supported);
    return supported;
  }

  function explicitProjectAutoTraitDecision(
    definition: import("../../policy/types/project-types.js").RustProjectTypeDefinition,
    trait: RustTraitRef,
  ): boolean | undefined {
    const implementation = input.declarationContracts.forDeclaration(definition.declaration)
      ?.traitImpls.find((candidate) => candidate.trait.kind === "path" &&
        rustTraitReferenceEquals(Object.freeze({
          identity: candidate.trait.identity,
          displayPath: candidate.trait.displayPath,
          arguments: candidate.trait.arguments,
          associatedConstraints: Object.freeze([]),
        }), trait));
    return implementation === undefined
      ? undefined
      : implementation.polarity === "positive";
  }
}

function collectLifetimeRegionEdges(
  inventory: RustOwnershipNodeInventory,
  sourceValues: RustSourceValueInventory,
  input: RustOwnershipAnalysisInput,
): ReadonlyMap<string, ReadonlySet<string>> {
  const edges = new Map<string, Set<string>>();
  const append = (lifetime: RustLifetimeRef, regionId: string): void => {
    const identity = lifetimeIdentity(lifetime);
    if (identity === undefined) return;
    const selected = edges.get(identity) ?? new Set<string>();
    selected.add(regionId);
    edges.set(identity, selected);
  };
  for (const declaration of inventory.declarationByRoot.values()) {
    if (input.ast.kindName(declaration) !== "KindParameter") continue;
    const contract = sourceValues.contracts.get(declaration);
    if (contract?.kind !== "shared-reference" && contract?.kind !== "mutable-reference") continue;
    const region = inventory.regionByNode.get(declaration);
    if (region !== undefined) append(contract.lifetime, region.id);
  }
  for (const node of inventory.nodes) {
    const operation = input.facts.get(node, rustSourceOwnershipOperationFactKey);
    if (operation?.kind !== "shared-borrow" && operation?.kind !== "mutable-borrow") continue;
    const carrier = input.facts.getRuntimeCarrierFact(node)?.carrier;
    const region = inventory.regionByNode.get(node);
    if (carrier?.kind === "reference" && region !== undefined) {
      append(carrier.lifetime, region.id);
    }
  }
  return edges;
}

function typeParameterIdentityOutlives(
  identity: import("../../target-model/semantics/index.js").RustSemanticIdentity,
  lifetime: RustLifetimeRef,
  typeOutlivesEdges: ReadonlyMap<string, readonly RustLifetimeRef[]>,
  environment: RustOwnershipEnvironment,
): boolean {
  return (typeOutlivesEdges.get(rustSemanticIdentityKey(identity)) ?? []).some((candidate) =>
    environment.lifetimeOutlives(candidate, lifetime));
}

function createTypeParameterTraitResolver(
  sourceGenerics: RustSourceGenericIndex,
): RustTypeParameterTraitResolver {
  const bounds = new Map<string, readonly RustTraitRef[]>();
  for (const contract of sourceGenerics.allContracts()) {
    for (const parameter of contract.parameters) {
      if (parameter.parameter.kind !== "type") continue;
      bounds.set(
        rustSemanticIdentityKey(parameter.parameter.identity),
        Object.freeze(parameter.parameter.bounds.flatMap((bound) =>
          bound.kind === "trait" && bound.polarity === "required"
            ? [bound.trait]
            : [])),
      );
    }
  }
  return (identity, trait) => (bounds.get(rustSemanticIdentityKey(identity)) ?? []).some((bound) =>
    rustTraitReferenceEquals(bound, trait));
}

function collectLifetimeEdges(
  sourceGenerics: RustSourceGenericIndex,
): ReadonlyMap<string, ReadonlySet<string>> {
  const edges = new Map<string, Set<string>>();
  for (const contract of sourceGenerics.allContracts()) {
    for (const parameter of contract.parameters) {
      if (parameter.parameter.kind !== "lifetime") continue;
      const longer = lifetimeIdentity(parameter.parameter.identity);
      if (longer === undefined) continue;
      const selected = edges.get(longer) ?? new Set<string>();
      for (const shorter of parameter.parameter.bounds) {
        const identity = lifetimeIdentity(shorter);
        if (identity !== undefined) selected.add(identity);
      }
      edges.set(longer, selected);
    }
  }
  return edges;
}

function collectTypeOutlivesEdges(
  sourceGenerics: RustSourceGenericIndex,
): ReadonlyMap<string, readonly RustLifetimeRef[]> {
  const edges = new Map<string, RustLifetimeRef[]>();
  for (const contract of sourceGenerics.allContracts()) {
    for (const parameter of contract.parameters) {
      if (parameter.parameter.kind !== "type") continue;
      const identity = rustSemanticIdentityKey(parameter.parameter.identity);
      const selected = edges.get(identity) ?? [];
      for (const bound of parameter.parameter.bounds) {
        if (bound.kind === "type-outlives" && bound.type.kind === "type-parameter" &&
          rustSemanticIdentitiesEqual(bound.type.identity, parameter.parameter.identity)) {
          selected.push(bound.lifetime);
        }
      }
      edges.set(identity, selected);
    }
  }
  return edges;
}

function lifetimesEqual(left: RustLifetimeRef, right: RustLifetimeRef): boolean {
  const leftIdentity = lifetimeIdentity(left);
  const rightIdentity = lifetimeIdentity(right);
  return left.kind === right.kind && leftIdentity !== undefined && leftIdentity === rightIdentity;
}

function lifetimeIdentity(lifetime: RustLifetimeRef): string | undefined {
  switch (lifetime.kind) {
    case "static": return "static";
    case "parameter": return rustSemanticIdentityKey(lifetime.identity);
    case "bound": return `bound\0${lifetime.binderId}\0${lifetime.parameterId}`;
    case "inferred-region": return `region\0${lifetime.regionId}`;
  }
}
