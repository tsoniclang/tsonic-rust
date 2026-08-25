import type { AstReader, Node } from "@tsonic/tsts";
import { closedMetadataKey, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
} from "./type-policy.js";
import {
  rustGenericArgumentOpenIdentityKeys,
  rustGenericSubstitutionsForArguments,
} from "../../target-model/types/index.js";
import { rustGenericArgumentSemanticKey } from "../../target-model/semantics/index.js";
import type { RustGenericArgument, RustGenerics } from "../../target-model/semantics/index.js";
import type { RustGenericSubstitutions } from "../../target-model/types/index.js";
import type { RustSourceGenericIndex } from "../../policy/types/source-generics.js";

export interface RustProjectMethodDispatchVariant {
  readonly declaration: Node;
  readonly sourceGenerics: RustGenerics;
  readonly targetGenericArguments: readonly RustGenericArgument[];
  readonly specialization: RustGenericSubstitutions;
  readonly virtualSlot: string;
  readonly exactSlot: string;
}

export type RustProjectMethodDispatchRegistration =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustProjectMethodDispatchPlan {
  variantsForMember(declaration: Node): readonly RustProjectMethodDispatchVariant[];
  variantForMember(
    declaration: Node,
    targetGenericArguments: readonly RustGenericArgument[],
  ): RustProjectMethodDispatchVariant | undefined;
}

export interface RustProjectMethodDispatchPlanRegistry extends RustProjectMethodDispatchPlan {
  record(
    declaration: Node,
    targetGenericArguments: readonly RustGenericArgument[],
    projectTypes: RustProjectTypePolicy,
    sourceGenerics: RustSourceGenericIndex,
  ): RustProjectMethodDispatchRegistration;
  initialize(input: {
    readonly ast: AstReader;
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceGenerics: RustSourceGenericIndex;
    readonly requiresDynamicDispatch: (
      definition: RustProjectTypeDefinition | undefined,
    ) => boolean;
  }): RustProjectMethodDispatchPlan;
  seal(): RustProjectMethodDispatchPlan;
}

interface PendingVariant {
  readonly declaration: Node;
  readonly sourceGenerics: RustGenerics;
  readonly targetGenericArguments: readonly RustGenericArgument[];
  readonly specialization: RustGenericSubstitutions;
}

export function createRustProjectMethodDispatchPlanRegistry(): RustProjectMethodDispatchPlanRegistry {
  const pending: PendingVariant[] = [];
  let current: RustProjectMethodDispatchPlan | undefined;
  const requireCurrent = (): RustProjectMethodDispatchPlan => {
    if (current === undefined) {
      throw new Error("Rust project method dispatch plan was read before source analysis initialized it.");
    }
    return current;
  };
  const registry: RustProjectMethodDispatchPlanRegistry = {
    record(declaration, targetGenericArguments, projectTypes, sourceGenerics) {
      if (current !== undefined) {
        throw new Error("Rust project method dispatch requests cannot be recorded after initialization.");
      }
      const owner = projectTypes.definitionContainingDeclaration(declaration);
      const contract = sourceGenerics.contractFor(declaration);
      const complete = contract === undefined
        ? undefined
        : rustGenericSubstitutionsForArguments(contract.generics, targetGenericArguments);
      if (owner === undefined || contract === undefined || complete === undefined) {
        return { kind: "rejected", reason: "Selected project method has no exact owner or matching mixed-generic contract." };
      }
      const openIdentities = new Set(targetGenericArguments
        .filter((argument) => argument.kind !== "lifetime")
        .flatMap(rustGenericArgumentOpenIdentityKeys));
      const ownerIdentities = new Set(owner.genericArguments.flatMap(
        rustGenericArgumentOpenIdentityKeys,
      ));
      if ([...openIdentities].some((identity) => !ownerIdentities.has(identity))) {
        return {
          kind: "rejected",
          reason: "Rust dynamic dispatch requires a finite method specialization; this call retains a type parameter outside the receiver contract.",
        };
      }
      addPending(pending, {
        declaration,
        sourceGenerics: contract.generics,
        targetGenericArguments: Object.freeze([...targetGenericArguments]),
        specialization: specializationOnly(complete),
      });
      return { kind: "accepted" };
    },
    initialize(input) {
      if (current !== undefined) {
        throw new Error("Rust project method dispatch plan can be initialized only once.");
      }
      current = createRustProjectMethodDispatchPlan(pending, input);
      return current;
    },
    seal() {
      return requireCurrent();
    },
    variantsForMember(declaration) {
      return requireCurrent().variantsForMember(declaration);
    },
    variantForMember(declaration, targetGenericArguments) {
      return requireCurrent().variantForMember(declaration, targetGenericArguments);
    },
  };
  return Object.freeze(registry);
}

function createRustProjectMethodDispatchPlan(
  recorded: readonly PendingVariant[],
  input: {
    readonly ast: AstReader;
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceGenerics: RustSourceGenericIndex;
    readonly requiresDynamicDispatch: (
      definition: RustProjectTypeDefinition | undefined,
    ) => boolean;
  },
): RustProjectMethodDispatchPlan {
  const pending: PendingVariant[] = recorded.map((variant) => ({ ...variant }));
  for (const variant of [...pending]) {
    const owner = input.projectTypes.definitionContainingDeclaration(variant.declaration);
    if (owner === undefined) {
      continue;
    }
    for (const concrete of input.projectTypes.concreteClassesFor(owner)) {
      const selected = input.projectTypes.memberImplementation(concrete, variant.declaration);
      if (selected.kind !== "resolved") {
        continue;
      }
      const implementation = selected.implementation.declaration;
      const contract = input.sourceGenerics.contractFor(implementation);
      const identity = input.sourceGenerics.identityContractFor(implementation);
      if (contract === undefined || identity === undefined ||
        contract.parameters.length !== variant.targetGenericArguments.length) {
        continue;
      }
      const arguments_ = contract.parameters.map((parameter, index) =>
        parameter.parameter.kind === "lifetime"
          ? identity.arguments[index]
          : variant.targetGenericArguments[index]);
      if (arguments_.some((argument) => argument === undefined) ||
        arguments_.some((argument, index) => argument!.kind !== contract.parameters[index]!.parameter.kind)) {
        continue;
      }
      const complete = rustGenericSubstitutionsForArguments(
        contract.generics,
        arguments_ as readonly RustGenericArgument[],
      );
      if (complete === undefined) continue;
      addPending(pending, {
        declaration: implementation,
        sourceGenerics: contract.generics,
        targetGenericArguments: Object.freeze(arguments_ as readonly RustGenericArgument[]),
        specialization: specializationOnly(complete),
      });
    }
  }

  const byMember = new WeakMap<Node, readonly RustProjectMethodDispatchVariant[]>();
  for (const definition of input.projectTypes.definitions) {
    if (!input.requiresDynamicDispatch(definition)) {
      continue;
    }
    const members = denseNodes(input.ast.members(definition.declaration)) ?? [];
    const usedNames = projectDispatchUsedNames(definition, members, input);
    for (const member of members) {
      const kind = input.ast.kindName(member);
      if ((kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature") ||
        input.ast.hasModifierKind(member, "static")) {
        continue;
      }
      const sourceParameters = denseNodes(input.ast.typeParameters(member));
      const sourceContract = input.sourceGenerics.contractFor(member);
      if (sourceParameters === undefined || sourceContract === undefined ||
        sourceParameters.length !== sourceContract.parameters.length) {
        continue;
      }
      const baseVirtual = input.projectTypes.memberSlotName(member, "virtual");
      const baseExact = input.projectTypes.memberSlotName(member, "exact");
      if (baseVirtual === undefined || baseExact === undefined) {
        continue;
      }
      const sourceIdentityContract = input.sourceGenerics.identityContractFor(member);
      if (sourceContract.parameters.every((parameter) => parameter.parameter.kind === "lifetime")) {
        if (sourceIdentityContract === undefined ||
          sourceIdentityContract.arguments.length !== sourceContract.parameters.length) continue;
        byMember.set(member, Object.freeze([Object.freeze({
          declaration: member,
          sourceGenerics: sourceContract.generics,
          targetGenericArguments: sourceIdentityContract.arguments,
          specialization: emptySpecialization(),
          virtualSlot: baseVirtual,
          exactSlot: baseExact,
        })]));
        continue;
      }
      const selected = pending
        .filter((candidate) => candidate.declaration === member)
        .sort((left, right) => variantKey(left).localeCompare(variantKey(right), "en"));
      const variants = selected.map((candidate, index): RustProjectMethodDispatchVariant => {
        const ordinal = index + 1;
        return Object.freeze({
          declaration: member,
          sourceGenerics: candidate.sourceGenerics,
          targetGenericArguments: candidate.targetGenericArguments,
          specialization: candidate.specialization,
          virtualSlot: allocateRustGeneratedName(
            usedNames,
            `${baseVirtual}_specialization_${ordinal}`,
          ),
          exactSlot: allocateRustGeneratedName(
            usedNames,
            `${baseExact}_specialization_${ordinal}`,
          ),
        });
      });
      byMember.set(member, Object.freeze(variants));
    }
  }
  const plan: RustProjectMethodDispatchPlan = {
    variantsForMember(declaration) {
      return byMember.get(declaration) ?? Object.freeze([]);
    },
    variantForMember(declaration, targetGenericArguments) {
      const matches = (byMember.get(declaration) ?? []).filter((variant) =>
        specializationArgumentsEqual(
          variant.targetGenericArguments,
          targetGenericArguments,
        ));
      return matches.length === 1 ? matches[0] : undefined;
    },
  };
  return Object.freeze(plan);
}

function projectDispatchUsedNames(
  definition: RustProjectTypeDefinition,
  members: readonly Node[],
  input: {
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
  },
): Set<string> {
  const used = new Set<string>();
  for (const member of members) {
    const targetName = input.names.nameForDeclaration(member);
    if (targetName !== undefined) {
      used.add(targetName);
    }
    for (const role of ["read", "write", "virtual", "exact", "method-write", "static"] as const) {
      const slot = input.projectTypes.memberSlotName(member, role);
      if (slot !== undefined) {
        used.add(slot);
      }
    }
  }
  used.add(definition.dispatchName);
  return used;
}

function addPending(pending: PendingVariant[], candidate: PendingVariant): void {
  if (pending.some((variant) => variant.declaration === candidate.declaration &&
    specializationArgumentsEqual(
      variant.targetGenericArguments,
      candidate.targetGenericArguments,
    ))) {
    return;
  }
  pending.push(candidate);
}

function variantKey(variant: PendingVariant): string {
  return closedMetadataKey(specializationArguments(variant.targetGenericArguments));
}

function specializationArgumentsEqual(
  left: readonly RustGenericArgument[],
  right: readonly RustGenericArgument[],
): boolean {
  const leftSpecialized = specializationArguments(left);
  const rightSpecialized = specializationArguments(right);
  return leftSpecialized.length === rightSpecialized.length && leftSpecialized.every((entry, index) =>
    rustGenericArgumentSemanticKey(entry) === rustGenericArgumentSemanticKey(rightSpecialized[index]!));
}

function specializationArguments(
  arguments_: readonly RustGenericArgument[],
): readonly RustGenericArgument[] {
  return arguments_.filter((argument) => argument.kind !== "lifetime");
}

function specializationOnly(
  substitutions: RustGenericSubstitutions,
): RustGenericSubstitutions {
  return Object.freeze({
    lifetimes: new Map(),
    types: substitutions.types,
    consts: substitutions.consts,
    associatedTypes: substitutions.associatedTypes,
  });
}

function emptySpecialization(): RustGenericSubstitutions {
  return Object.freeze({
    lifetimes: new Map(),
    types: new Map(),
    consts: new Map(),
    associatedTypes: new Map(),
  });
}

function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly Node[]
    : undefined;
}
