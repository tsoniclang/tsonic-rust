import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../policy/types/model.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import { closedMetadataKey, isDenseDataArray } from "../../policy/model/closed-data.js";
import { allocateRustGeneratedName } from "../../policy/names/generated.js";
import type { RustNamePlan } from "../../policy/names/model.js";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
} from "./type-policy.js";
import { rustTargetTypeParameterNames } from "../../policy/types/target-types.js";

export interface RustProjectMethodDispatchVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterNames: readonly string[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
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
    targetTypeArguments: readonly TargetTypeRef[],
  ): RustProjectMethodDispatchVariant | undefined;
}

export interface RustProjectMethodDispatchPlanRegistry extends RustProjectMethodDispatchPlan {
  record(
    declaration: Node,
    targetTypeArguments: readonly TargetTypeRef[],
    ast: AstReader,
    projectTypes: RustProjectTypePolicy,
  ): RustProjectMethodDispatchRegistration;
  initialize(input: {
    readonly ast: AstReader;
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
  }): RustProjectMethodDispatchPlan;
  seal(): RustProjectMethodDispatchPlan;
}

interface PendingVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterNames: readonly string[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
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
    record(declaration, targetTypeArguments, ast, projectTypes) {
      if (current !== undefined) {
        throw new Error("Rust project method dispatch requests cannot be recorded after initialization.");
      }
      const owner = projectTypes.definitionContainingDeclaration(declaration);
      const parameters = denseNodes(ast.typeParameters(declaration));
      if (owner === undefined || parameters === undefined) {
        return { kind: "rejected", reason: "Selected project method has no exact owner or dense type-parameter list." };
      }
      const sourceTypeParameterNames = parameters.map((parameter) => {
        const name = ast.name(parameter);
        return name === undefined ? "" : ast.text(name);
      });
      if (sourceTypeParameterNames.some((name) => name.length === 0) ||
        sourceTypeParameterNames.length !== targetTypeArguments.length) {
        return { kind: "rejected", reason: "Selected project method type arguments do not match its exact declaration arity." };
      }
      const openNames = new Set(targetTypeArguments.flatMap((argument) =>
        rustTargetTypeParameterNames(argument)));
      if ([...openNames].some((name) => !owner.typeParameterNames.includes(name))) {
        return {
          kind: "rejected",
          reason: "Rust dynamic dispatch requires a finite method specialization; this call retains a type parameter outside the receiver contract.",
        };
      }
      addPending(pending, {
        declaration,
        sourceTypeParameterNames: Object.freeze(sourceTypeParameterNames),
        targetTypeArguments: Object.freeze([...targetTypeArguments]),
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
    variantForMember(declaration, targetTypeArguments) {
      return requireCurrent().variantForMember(declaration, targetTypeArguments);
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
      const parameters = denseNodes(input.ast.typeParameters(implementation));
      const names = parameters?.map((parameter) => {
        const name = input.ast.name(parameter);
        return name === undefined ? "" : input.ast.text(name);
      });
      if (names === undefined || names.some((name) => name.length === 0) ||
        names.length !== variant.targetTypeArguments.length) {
        continue;
      }
      addPending(pending, {
        declaration: implementation,
        sourceTypeParameterNames: Object.freeze(names),
        targetTypeArguments: variant.targetTypeArguments,
      });
    }
  }

  const byMember = new WeakMap<Node, readonly RustProjectMethodDispatchVariant[]>();
  for (const definition of input.projectTypes.definitions) {
    if (!input.projectTypes.isPolymorphic(definition)) {
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
      if (sourceParameters === undefined) {
        continue;
      }
      const baseVirtual = input.projectTypes.memberSlotName(member, "virtual");
      const baseExact = input.projectTypes.memberSlotName(member, "exact");
      if (baseVirtual === undefined || baseExact === undefined) {
        continue;
      }
      if (sourceParameters.length === 0) {
        byMember.set(member, Object.freeze([Object.freeze({
          declaration: member,
          sourceTypeParameterNames: Object.freeze([]),
          targetTypeArguments: Object.freeze([]),
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
          sourceTypeParameterNames: candidate.sourceTypeParameterNames,
          targetTypeArguments: candidate.targetTypeArguments,
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
    variantForMember(declaration, targetTypeArguments) {
      const matches = (byMember.get(declaration) ?? []).filter((variant) =>
        targetTypeRefListsEqual(variant.targetTypeArguments, targetTypeArguments));
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
    targetTypeRefListsEqual(variant.targetTypeArguments, candidate.targetTypeArguments))) {
    return;
  }
  pending.push(candidate);
}

function variantKey(variant: PendingVariant): string {
  return closedMetadataKey(variant.targetTypeArguments);
}

function targetTypeRefListsEqual(
  left: readonly TargetTypeRef[],
  right: readonly TargetTypeRef[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    rustTargetTypeRefEquals(entry, right[index]));
}

function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly Node[]
    : undefined;
}
