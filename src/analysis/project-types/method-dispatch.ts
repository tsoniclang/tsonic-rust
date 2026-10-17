import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
} from "./type-policy.js";
import { rustTargetTypeParameterIdentities } from "../../target-model/types/index.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustTargetGenericBindings } from "../../target-model/types/carriers/generic-inference.js";
import type { RustTargetGenericArgument } from "../../target-model/types/model.js";
import { rustSourceTypeCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustGenericCallablePhysicalBindings, snapshotRustCallableBindings } from "../callables/generic-bindings.js";

export interface RustProjectMethodDispatchVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterIdentities: readonly string[];
  readonly targetTypeArguments: readonly TargetTypeRef[];
  readonly virtualSlot: string;
  readonly exactSlot: string;
}

export interface RustProjectMethodBodySelection {
  readonly concrete: RustProjectTypeDefinition;
  readonly declaration: Node;
  readonly owner: RustProjectTypeDefinition;
  readonly ownerCarrier: TargetTypeRef;
  readonly contractVariant: RustProjectMethodDispatchVariant | undefined;
  readonly variant: RustProjectMethodDispatchVariant | undefined;
  readonly targetName: string;
  readonly targetTypeArguments: readonly TargetTypeRef[];
  readonly bindings: RustTargetGenericBindings;
  readonly contractBindings: RustTargetGenericBindings;
  readonly contractMethodBindings: ReadonlyMap<string, TargetTypeRef> | undefined;
}

export type RustProjectMethodDispatchRegistration =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustProjectMethodDispatchPlan {
  readonly bodies: readonly RustProjectMethodBodySelection[];
  readonly bodyIssues: readonly { readonly node: Node; readonly reason: string }[];
  bodyFor(concrete: RustProjectTypeDefinition, declaration: Node,
    variant: RustProjectMethodDispatchVariant | undefined): RustProjectMethodBodySelection | undefined;
  implementationFor(concrete: RustProjectTypeDefinition, variant: RustProjectMethodDispatchVariant,
    role: "virtual" | "exact"): RustProjectMethodBodySelection | undefined;
  variantsForMember(declaration: Node): readonly RustProjectMethodDispatchVariant[];
  variantForMember(
    declaration: Node,
    targetTypeArguments: readonly TargetTypeRef[],
    receiverCarrier?: TargetTypeRef,
  ): RustProjectMethodDispatchVariant | undefined;
}

export interface RustProjectMethodDispatchPlanRegistry extends RustProjectMethodDispatchPlan {
  record(
    declaration: Node,
    targetTypeArguments: readonly TargetTypeRef[],
    ast: AstReader,
    projectTypes: RustProjectTypePolicy,
    sourceLifetimes: RustLifetimeIndex,
  ): RustProjectMethodDispatchRegistration;
  initialize(input: {
    readonly ast: AstReader;
    readonly names: RustNamePlan;
    readonly projectTypes: RustProjectTypePolicy;
    readonly sourceLifetimes: RustLifetimeIndex;
  }): RustProjectMethodDispatchPlan;
  seal(): RustProjectMethodDispatchPlan;
}

interface PendingVariant {
  readonly declaration: Node;
  readonly sourceTypeParameterIdentities: readonly string[];
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
    get bodies() { return requireCurrent().bodies; },
    get bodyIssues() { return requireCurrent().bodyIssues; },
    bodyFor(concrete, declaration, variant) { return requireCurrent().bodyFor(concrete, declaration, variant); },
    implementationFor(concrete, variant, role) { return requireCurrent().implementationFor(concrete, variant, role); },
    record(declaration, targetTypeArguments, ast, projectTypes, sourceLifetimes) {
      if (current !== undefined) {
        throw new Error("Rust project method dispatch requests cannot be recorded after initialization.");
      }
      const owner = projectTypes.definitionContainingDeclaration(declaration);
      const parameters = denseNodes(ast.typeParameters(declaration));
      if (owner === undefined || parameters === undefined) {
        return { kind: "rejected", reason: "Selected project method has no exact owner or dense type-parameter list." };
      }
      const sourceTypeParameterIdentities = parameters
        .filter((parameter) =>
          sourceLifetimes.parameterFor(parameter)?.kind !== "lifetime")
        .map((parameter) => {
          const selected = sourceLifetimes.parameterFor(parameter);
          return selected?.kind === "type" ? selected.identity : "";
        });
      if (sourceTypeParameterIdentities.some((name) => name.length === 0) ||
        sourceTypeParameterIdentities.length !== targetTypeArguments.length) {
        return { kind: "rejected", reason: "Selected project method type arguments do not match its exact declaration arity." };
      }
      const openNames = new Set(targetTypeArguments.flatMap((argument) =>
        rustTargetTypeParameterIdentities(argument)));
      if ([...openNames].some((name) => !owner.typeParameterIdentities.includes(name))) {
        return {
          kind: "rejected",
          reason: "Rust dynamic dispatch requires a finite method specialization; this call retains a type parameter outside the receiver contract.",
        };
      }
      addPending(pending, {
        declaration,
        sourceTypeParameterIdentities: Object.freeze(sourceTypeParameterIdentities),
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
    variantForMember(declaration, targetTypeArguments, receiverCarrier) {
      return requireCurrent().variantForMember(declaration, targetTypeArguments, receiverCarrier);
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
    readonly sourceLifetimes: RustLifetimeIndex;
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
      const names = parameters
        ?.filter((parameter) =>
          input.sourceLifetimes.parameterFor(parameter)?.kind !== "lifetime")
        .map((parameter) => {
          const selected = input.sourceLifetimes.parameterFor(parameter);
          return selected?.kind === "type" ? selected.identity : "";
        });
      if (names === undefined || names.some((name) => name.length === 0) ||
        names.length !== variant.targetTypeArguments.length) {
        continue;
      }
      const targetTypeArguments = instantiateRustProjectMethodDispatchArguments(
        variant.declaration, variant.targetTypeArguments, input.projectTypes.openCarrier(concrete), input.projectTypes,
      );
      if (targetTypeArguments === undefined) continue;
      addPending(pending, {
        declaration: implementation,
        sourceTypeParameterIdentities: Object.freeze(names),
        targetTypeArguments,
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
      if (kind === "KindMethodDeclaration" && input.ast.body(member) === undefined &&
        !input.ast.hasModifierKind(member, "abstract")) {
        const implementation = input.projectTypes.memberImplementation(definition, member);
        if (implementation.kind === "resolved" && implementation.implementation.declaration !== member &&
          input.ast.body(implementation.implementation.declaration) !== undefined &&
          input.projectTypes.definitionContainingDeclaration(implementation.implementation.declaration) === definition) {
          continue;
        }
      }
      const sourceParameters = denseNodes(input.ast.typeParameters(member))?.filter((parameter) =>
        input.sourceLifetimes.parameterFor(parameter)?.kind !== "lifetime");
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
          sourceTypeParameterIdentities: Object.freeze([]),
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
          sourceTypeParameterIdentities: candidate.sourceTypeParameterIdentities,
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
  const variantForMember: RustProjectMethodDispatchPlan["variantForMember"] = (declaration, targetTypeArguments, receiverCarrier) => {
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    if (owner === undefined) return undefined;
    const receiver = receiverCarrier ?? input.projectTypes.openCarrier(owner);
    const matches = (byMember.get(declaration) ?? []).filter(variant => {
      const instantiated = instantiateRustProjectMethodDispatchArguments(
        declaration, variant.targetTypeArguments, receiver, input.projectTypes);
      return instantiated !== undefined && targetTypeRefListsEqual(instantiated, targetTypeArguments);
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
  const bodies: RustProjectMethodBodySelection[] = [];
  const bodyIssues: { readonly node: Node; readonly reason: string }[] = [];
  const bodyIndex = new Map<RustProjectTypeDefinition,
    Map<Node, Map<RustProjectMethodDispatchVariant | undefined, RustProjectMethodBodySelection>>>();
  const dispatchBodies = new Map<RustProjectTypeDefinition,
    Map<RustProjectMethodDispatchVariant, { readonly virtual: Node; readonly exact: Node | undefined }>>();
  const ownerBindings = (owner: RustProjectTypeDefinition, carrier: TargetTypeRef): RustTargetGenericBindings | undefined => {
    const arguments_ = rustSourceTypeCarrierValue(carrier)?.genericArguments;
    const parameters: RustTargetGenericArgument[] = owner.genericParameters.map(parameter => parameter.kind === "type"
      ? { kind: "type", type: { kind: "type-parameter", identity: parameter.identity, name: parameter.targetName } }
      : { kind: "lifetime", lifetime: parameter.lifetime });
    return arguments_ === undefined ? undefined : rustGenericCallablePhysicalBindings(parameters, arguments_);
  };
  const prepareBody = (concrete: RustProjectTypeDefinition, declaration: Node,
    contractVariant: RustProjectMethodDispatchVariant | undefined): void => {
    const members = bodyIndex.get(concrete) ?? new Map<Node, Map<RustProjectMethodDispatchVariant | undefined, RustProjectMethodBodySelection>>();
    const variants = members.get(declaration) ?? new Map<RustProjectMethodDispatchVariant | undefined, RustProjectMethodBodySelection>();
    if (variants.has(contractVariant)) return;
    const reject = (reason: string): void => { bodyIssues.push({ node: declaration, reason }); };
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    const root = input.projectTypes.openCarrier(concrete);
    const relation = owner === undefined ? undefined : input.projectTypes.relationship(root, owner);
    if (owner === undefined || relation?.kind !== "related" || input.ast.body(declaration) === undefined) {
      reject("A concrete native body requires its selected source implementation and exact owner relation.");
      return;
    }
    const inherited = ownerBindings(owner, relation.targetType);
    const contractOwner = contractVariant === undefined ? owner
      : input.projectTypes.definitionContainingDeclaration(contractVariant.declaration);
    const contractRelation = contractOwner === undefined ? undefined : input.projectTypes.relationship(root, contractOwner);
    const contractBindings = contractOwner === undefined || contractRelation?.kind !== "related" ? undefined
      : ownerBindings(contractOwner, contractRelation.targetType);
    const targetTypeArguments = contractVariant === undefined ? Object.freeze([])
      : instantiateRustProjectMethodDispatchArguments(contractVariant.declaration, contractVariant.targetTypeArguments, root, input.projectTypes);
    const variant = contractVariant === undefined || targetTypeArguments === undefined ? undefined
      : variantForMember(declaration, targetTypeArguments, root);
    const role = input.ast.kindName(declaration) === "KindGetAccessor" ? "read" : "write";
    const targetName = contractVariant === undefined ? input.projectTypes.memberSlotName(declaration, role) : variant?.exactSlot;
    if (inherited === undefined || contractBindings === undefined || targetTypeArguments === undefined || targetName === undefined ||
      contractVariant !== undefined && variant === undefined) {
      reject("A concrete native body requires its unique selected dispatch variant and exact declared binding vector.");
      return;
    }
    const methodBindings = variant === undefined ? undefined : new Map(variant.sourceTypeParameterIdentities.map((identity, index) =>
      [identity, targetTypeArguments[index]!] as const));
    const contractMethodBindings = contractVariant === undefined ? undefined
      : new Map(contractVariant.sourceTypeParameterIdentities.map((identity, index) => [identity, targetTypeArguments[index]!] as const));
    if (variant !== undefined && (variant.sourceTypeParameterIdentities.length !== targetTypeArguments.length ||
      methodBindings?.size !== targetTypeArguments.length) || contractVariant !== undefined &&
      (contractVariant.sourceTypeParameterIdentities.length !== targetTypeArguments.length ||
        contractMethodBindings?.size !== targetTypeArguments.length)) {
      reject("A concrete dispatch body requires each original method binder exactly once.");
      return;
    }
    const bindings = snapshotRustCallableBindings({ types: new Map([...inherited.types, ...methodBindings ?? []]),
      lifetimes: inherited.lifetimes, consts: inherited.consts });
    const selectedContractBindings = snapshotRustCallableBindings({
      types: new Map([...contractBindings.types, ...contractMethodBindings ?? []]),
      lifetimes: contractBindings.lifetimes, consts: contractBindings.consts });
    const body = Object.freeze({ concrete, declaration, owner, ownerCarrier: relation.targetType, contractVariant, variant, targetName,
      targetTypeArguments, bindings,
      contractBindings: selectedContractBindings,
      contractMethodBindings: contractMethodBindings === undefined ? undefined : snapshotRustCallableBindings({ types: contractMethodBindings,
        lifetimes: contractBindings.lifetimes, consts: contractBindings.consts }).types });
    variants.set(contractVariant, body);
    members.set(declaration, variants);
    bodyIndex.set(concrete, members);
    bodies.push(body);
  };
  for (const concrete of new Set(input.projectTypes.definitions.flatMap(definition => input.projectTypes.concreteClassesFor(definition)))) {
    if (concrete.kind !== "class" || !input.projectTypes.isPolymorphic(concrete) || input.ast.hasModifierKind(concrete.declaration, "abstract")) continue;
    const contracts = input.projectTypes.contractsForClass(concrete);
    if (contracts === undefined) {
      bodyIssues.push({ node: concrete.declaration, reason: "A concrete native root requires its completed instance contract set." });
      continue;
    }
    for (const contract of contracts) {
      const contractMembers = denseNodes(input.ast.members(contract.declaration));
      if (contractMembers === undefined) {
        bodyIssues.push({ node: contract.declaration, reason: "A concrete body requires its complete dense original contract-member vector." });
        continue;
      }
      for (const member of contractMembers) {
        if (input.ast.hasModifierKind(member, "static")) continue;
        const kind = input.ast.kindName(member);
        if (kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature" && kind !== "KindGetAccessor" && kind !== "KindSetAccessor") continue;
        const variants = byMember.get(member);
        if ((kind === "KindMethodDeclaration" || kind === "KindMethodSignature") && (variants === undefined || variants.length === 0)) continue;
        const selected = input.projectTypes.memberImplementation(concrete, member);
        if (selected.kind !== "resolved") {
          bodyIssues.push({ node: member, reason: selected.kind === "unresolved" ? selected.reason : "A concrete root requires its exact selected member implementation." });
          continue;
        }
        if (kind === "KindGetAccessor" || kind === "KindSetAccessor") {
          prepareBody(concrete, selected.implementation.declaration, undefined);
          continue;
        }
        for (const variant of variants ?? []) {
          prepareBody(concrete, selected.implementation.declaration, variant);
          let exactDeclaration: Node | undefined;
          if (contract.kind === "class" && !input.ast.hasModifierKind(member, "abstract") && input.projectTypes.classLineage(concrete)?.includes(contract) === true) {
            const exact = input.projectTypes.memberImplementation(contract, member);
            if (exact.kind === "resolved") {
              exactDeclaration = exact.implementation.declaration;
              prepareBody(concrete, exactDeclaration, variant);
            } else bodyIssues.push({ node: member, reason: "An inherited exact body requires its original selected member implementation." });
          } else if (contract.kind === "class" && !input.ast.hasModifierKind(member, "abstract")) {
            exactDeclaration = selected.implementation.declaration;
          }
          const selectedBodies = dispatchBodies.get(concrete) ?? new Map<RustProjectMethodDispatchVariant,
            { readonly virtual: Node; readonly exact: Node | undefined }>();
          selectedBodies.set(variant, Object.freeze({ virtual: selected.implementation.declaration, exact: exactDeclaration }));
          dispatchBodies.set(concrete, selectedBodies);
        }
      }
    }
  }
  const plan: RustProjectMethodDispatchPlan = {
    bodies: Object.freeze(bodies), bodyIssues: Object.freeze(bodyIssues.map(issue => Object.freeze(issue))),
    bodyFor: (concrete, declaration, variant) => bodyIndex.get(concrete)?.get(declaration)?.get(variant),
    implementationFor(concrete, variant, role) {
      const declaration = dispatchBodies.get(concrete)?.get(variant)?.[role];
      return declaration === undefined ? undefined : bodyIndex.get(concrete)?.get(declaration)?.get(variant);
    },
    variantsForMember(declaration) {
      return byMember.get(declaration) ?? Object.freeze([]);
    },
    variantForMember,
  };
  return Object.freeze(plan);
}

export function instantiateRustProjectMethodDispatchArguments(
  declaration: Node,
  targetTypeArguments: readonly TargetTypeRef[],
  receiverCarrier: TargetTypeRef,
  projectTypes: RustProjectTypePolicy,
): readonly TargetTypeRef[] | undefined {
  const owner = projectTypes.definitionContainingDeclaration(declaration);
  if (owner === undefined || projectTypes.relationship(receiverCarrier, owner).kind !== "related" ||
    !isDenseDataArray(targetTypeArguments)) return undefined;
  const arguments_ = targetTypeArguments.map(argument =>
    projectTypes.instantiateMemberCarrier(declaration, receiverCarrier, argument));
  return arguments_.some(argument => argument === undefined)
    ? undefined : Object.freeze(arguments_ as TargetTypeRef[]);
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
