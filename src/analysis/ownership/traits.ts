import type {
  RustTraitProof,
  RustTraitRef,
  RustTypeRef,
  RustValueReadDisposition,
} from "../../target-model/semantics/index.js";
import {
  rustSemanticIdentityKey,
  rustTypeSemanticKey,
} from "../../target-model/semantics/index.js";
import {
  rustCloneTrait,
  rustCopyTrait,
  rustDefaultTrait,
  rustDropTrait,
  rustSendTrait,
  rustSyncTrait,
  rustToOwnedTrait,
  rustUnpinTrait,
} from "../../target-model/types/index.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import type { RustOwnershipOperationInventory } from "./operations.js";
import { rustOwnershipTraitProof } from "./operations.js";

export interface RustOwnershipTraitIndex {
  traitProofFor(type: RustTypeRef, trait: RustTraitRef): RustTraitProof | undefined;
  ownedReadForCarrier(type: RustTypeRef): Extract<
    RustValueReadDisposition,
    { readonly kind: "copy" | "clone" }
  > | undefined;
}

export function createRustOwnershipTraitIndex(
  inventory: RustOwnershipNodeInventory,
  operations: RustOwnershipOperationInventory,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
): RustOwnershipTraitIndex {
  const types = new Map<string, RustTypeRef>();
  const add = (type: RustTypeRef | undefined): void => {
    if (type === undefined) return;
    const key = rustTypeSemanticKey(type);
    if (types.has(key)) return;
    types.set(key, type);
    for (const child of childTypes(type)) add(child);
  };
  for (const node of inventory.nodes) add(input.facts.getRuntimeCarrierFact(node)?.carrier);
  for (const operation of operations.records) add(operation.carrier);
  for (const row of input.providerTypes) add(row.targetCarrier);
  const traits = [
    rustCopyTrait,
    rustCloneTrait,
    rustDefaultTrait,
    rustDropTrait,
    rustToOwnedTrait,
    rustSendTrait,
    rustSyncTrait,
    rustUnpinTrait,
  ];
  const proofs = new Map<string, RustTraitProof>();
  for (const [typeKey, type] of types) {
    for (const trait of traits) {
      if (!environment.supportsTrait(type, trait)) continue;
      proofs.set(
        proofKey(typeKey, trait),
        rustOwnershipTraitProof(trait, type, `sealed-carrier\0${typeKey}`),
      );
    }
  }
  return Object.freeze<RustOwnershipTraitIndex>({
    traitProofFor(type, trait) {
      return proofs.get(proofKey(rustTypeSemanticKey(type), trait));
    },
    ownedReadForCarrier(type) {
      const typeKey = rustTypeSemanticKey(type);
      const copy = proofs.get(proofKey(typeKey, rustCopyTrait));
      if (copy !== undefined) return Object.freeze({ kind: "copy", proof: copy });
      const clone = proofs.get(proofKey(typeKey, rustCloneTrait));
      return clone === undefined ? undefined : Object.freeze({ kind: "clone", proof: clone });
    },
  });
}

function proofKey(typeKey: string, trait: RustTraitRef): string {
  return `${typeKey}\0${rustSemanticIdentityKey(trait.identity)}`;
}

function childTypes(type: RustTypeRef): readonly RustTypeRef[] {
  switch (type.kind) {
    case "reference":
    case "raw-pointer":
      return Object.freeze([type.target]);
    case "tuple":
      return type.elements;
    case "array":
    case "sequence":
    case "slice":
      return Object.freeze([type.element]);
    case "path":
      return Object.freeze(type.arguments.flatMap((argument) =>
        argument.kind === "type" ? [argument.value] : []));
    case "function-pointer":
      return Object.freeze([...type.parameters, type.result]);
    case "closure":
      return Object.freeze([...type.parameters, type.result]);
    case "trait-object":
      return Object.freeze([
        ...type.principal.associatedConstraints.flatMap(associatedConstraintTypes),
        ...type.principal.arguments.flatMap(genericArgumentTypes),
      ]);
    case "opaque":
      return Object.freeze(type.bounds.flatMap(boundTypes));
    case "associated-type":
      return Object.freeze([type.owner, ...type.arguments.flatMap((argument) =>
        argument.kind === "type" ? [argument.value] : [])]);
    default:
      return Object.freeze([]);
  }
}

function genericArgumentTypes(
  argument: import("../../target-model/semantics/index.js").RustGenericArgument,
): readonly RustTypeRef[] {
  return argument.kind === "type" ? Object.freeze([argument.value]) : Object.freeze([]);
}

function associatedConstraintTypes(
  constraint: import("../../target-model/semantics/index.js").RustAssociatedConstraint,
): readonly RustTypeRef[] {
  return constraint.kind === "equality"
    ? Object.freeze([constraint.type, ...constraint.arguments.flatMap(genericArgumentTypes)])
    : Object.freeze(constraint.arguments.flatMap(genericArgumentTypes));
}

function boundTypes(
  bound: import("../../target-model/semantics/index.js").RustBound,
): readonly RustTypeRef[] {
  switch (bound.kind) {
    case "type-outlives":
      return Object.freeze([bound.type]);
    case "associated-equality":
      return Object.freeze([bound.projection, bound.value]);
    case "trait":
      return Object.freeze([
        ...bound.trait.arguments.flatMap(genericArgumentTypes),
        ...bound.trait.associatedConstraints.flatMap(associatedConstraintTypes),
      ]);
    default:
      return Object.freeze([]);
  }
}
