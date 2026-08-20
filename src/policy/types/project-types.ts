import { rustTargetTypeRefEquals } from "./equality.js";
import type {
  AstReader,
  Node,
  Signature,
  SourceFile,
  Type,
} from "@tsonic/tsts";
import type {
  SourceClassConstructorParameter,
  SourceDeclaredHeritageEdge,
  SourceProgramNavigation,
  SourceProjectMemberImplementationResult,
} from "@tsonic/target-api/source";
import type { RustExternalProjectBase, RustExternalProjectField } from "./external-project-types.js";
import type { RustNamePlan } from "../names/model.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustProjectTypeIssue {
  readonly node: Node;
  readonly code: string;
  readonly message: string;
}

export type RustProjectMemberSlotRole =
  | "read"
  | "write"
  | "virtual"
  | "exact"
  | "method-write"
  | "static";

export interface RustProjectMemberSlotCandidate {
  readonly declaration: Node;
  readonly targetName: string;
  readonly roles: readonly RustProjectMemberSlotRole[];
}

export interface RustProjectTypeDefinition {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly kind: "class" | "interface";
  readonly typeParameterNames: readonly string[];
  readonly targetTypeParameterNames: readonly string[];
  readonly stateName: string;
  readonly dispatchName: string;
  readonly rootName?: string;
}

export interface RustProjectInterfaceContract {
  readonly definition: RustProjectTypeDefinition;
  readonly carrier: TargetTypeRef;
}

export interface RustProjectConstructorSignature {
  readonly signature: Signature;
  readonly declaration?: Node;
  readonly parameters: readonly SourceClassConstructorParameter[];
  readonly implicit: boolean;
  readonly targetName: string;
  readonly initializeName: string;
}

export interface RustProjectHeritageEdge {
  readonly kind: "extends" | "implements";
  readonly source: RustProjectTypeDefinition;
  readonly target: RustProjectTypeDefinition;
  readonly heritage: Node;
  readonly targetType: TargetTypeRef;
}

export type RustProjectTypeRelationship =
  | { readonly kind: "related"; readonly targetType: TargetTypeRef }
  | { readonly kind: "unrelated" }
  | { readonly kind: "ambiguous"; readonly targetTypes: readonly TargetTypeRef[] };

export interface RustProjectDowncastRoute {
  readonly source: RustProjectTypeDefinition;
  readonly target: RustProjectTypeDefinition;
  readonly targetCarrier: TargetTypeRef;
  readonly slot: string;
}

export interface RustProjectTypePolicy {
  readonly definitions: readonly RustProjectTypeDefinition[];
  readonly issues: readonly RustProjectTypeIssue[];
  definitionForDeclaration(declaration: Node | undefined): RustProjectTypeDefinition | undefined;
  definitionContainingDeclaration(declaration: Node | undefined): RustProjectTypeDefinition | undefined;
  definitionForCarrier(carrier: TargetTypeRef | undefined): RustProjectTypeDefinition | undefined;
  openCarrier(definition: RustProjectTypeDefinition): TargetTypeRef;
  heritageForDefinition(definition: RustProjectTypeDefinition): readonly RustProjectHeritageEdge[];
  externalBaseForDefinition(definition: RustProjectTypeDefinition): RustExternalProjectBase | undefined;
  externalFieldForReceiver(
    declaration: Node | undefined,
    receiver: TargetTypeRef | undefined,
  ): {
    readonly owner: RustProjectTypeDefinition;
    readonly base: RustExternalProjectBase;
    readonly field: RustExternalProjectField;
    readonly ownerCarrier: TargetTypeRef;
  } | undefined;
  readonly programErrorDefinitions: readonly RustProjectTypeDefinition[];
  programErrorVariant(definition: RustProjectTypeDefinition): string | undefined;
  directSupertypes(carrier: TargetTypeRef): readonly TargetTypeRef[] | undefined;
  commonSupertype(carriers: readonly TargetTypeRef[]): TargetTypeRef | undefined;
  relationship(source: TargetTypeRef, target: RustProjectTypeDefinition): RustProjectTypeRelationship;
  instantiateMemberCarrier(
    member: Node,
    receiver: TargetTypeRef,
    declaredCarrier: TargetTypeRef,
  ): TargetTypeRef | undefined;
  isPolymorphic(definition: RustProjectTypeDefinition): boolean;
  classLineage(definition: RustProjectTypeDefinition): readonly RustProjectTypeDefinition[] | undefined;
  interfacesForClass(definition: RustProjectTypeDefinition): readonly RustProjectTypeDefinition[] | undefined;
  concreteClassesFor(definition: RustProjectTypeDefinition): readonly RustProjectTypeDefinition[];
  downcastRoutesFor(definition: RustProjectTypeDefinition): readonly RustProjectDowncastRoute[];
  downcastRoute(
    source: RustProjectTypeDefinition,
    targetCarrier: TargetTypeRef,
  ): RustProjectDowncastRoute | undefined;
  constructorsForDefinition(definition: RustProjectTypeDefinition): readonly RustProjectConstructorSignature[];
  constructorForSignature(
    definition: RustProjectTypeDefinition,
    signature: Signature | undefined,
  ): RustProjectConstructorSignature | undefined;
  constructorForTargetName(
    definition: RustProjectTypeDefinition,
    targetName: string,
  ): RustProjectConstructorSignature | undefined;
  fieldStorageName(
    definition: RustProjectTypeDefinition,
    declaration: Node,
  ): string | undefined;
  baseStateFieldName(definition: RustProjectTypeDefinition): string;
  stateMarkerFieldName(definition: RustProjectTypeDefinition): string;
  memberSlotName(
    declaration: Node,
    role: RustProjectMemberSlotRole,
  ): string | undefined;
  memberImplementation(
    concreteClass: RustProjectTypeDefinition,
    contractMember: Node,
  ): SourceProjectMemberImplementationResult;
}

export interface RustProjectTypePolicyHost {
  readonly ast: AstReader;
  readonly names: RustNamePlan;
  readonly navigation: SourceProgramNavigation;
  readonly sourceFiles: readonly SourceFile[];
  externallyExtensible(declaration: Node): boolean;
  targetNameForCallable(declaration: Node): string | undefined;
  sourcePackageComponentForFile(fileName: string): string | undefined;
  resolveSelectedType(
    authoredTypeNode: Node | undefined,
    selectedType: Type,
    heritage: Node,
  ): TargetTypeRef | undefined;
  resolveExternalHeritage(edge: SourceDeclaredHeritageEdge): RustExternalProjectBase | undefined;
}

export function rustProjectInterfaceContracts(
  policy: RustProjectTypePolicy,
  definition: RustProjectTypeDefinition,
  carrier: TargetTypeRef,
): readonly RustProjectInterfaceContract[] | undefined {
  const ordered: RustProjectInterfaceContract[] = [];
  const visiting = new Set<RustProjectTypeDefinition>();
  const visited = new Map<RustProjectTypeDefinition, TargetTypeRef>();
  const visit = (current: RustProjectTypeDefinition): boolean => {
    const relation = policy.relationship(carrier, current);
    if (current.kind !== "interface" || relation.kind !== "related") {
      return false;
    }
    const previous = visited.get(current);
    if (previous !== undefined) {
      return rustTargetTypeRefEquals(previous, relation.targetType);
    }
    if (visiting.has(current)) {
      return false;
    }
    visiting.add(current);
    for (const edge of policy.heritageForDefinition(current)) {
      if (edge.kind !== "extends" || !visit(edge.target)) {
        return false;
      }
    }
    visiting.delete(current);
    visited.set(current, relation.targetType);
    ordered.push(Object.freeze({
      definition: current,
      carrier: relation.targetType,
    }));
    return true;
  };
  return visit(definition) ? Object.freeze(ordered) : undefined;
}

export function rustInheritedProjectConstructor(
  policy: RustProjectTypePolicy,
  definition: RustProjectTypeDefinition,
  signature: RustProjectConstructorSignature,
): {
  readonly base: RustProjectTypeDefinition;
  readonly constructor: RustProjectConstructorSignature;
} | undefined {
  if (!signature.implicit) {
    return undefined;
  }
  const baseEdges = policy.heritageForDefinition(definition).filter((edge) =>
    edge.kind === "extends" && edge.target.kind === "class");
  if (baseEdges.length !== 1) {
    return undefined;
  }
  const base = baseEdges[0]!.target;
  const matches = policy.constructorsForDefinition(base).filter((candidate) =>
    candidate.parameters.length === signature.parameters.length &&
    candidate.parameters.every((parameter, index) => {
      const selected = signature.parameters[index];
      return selected !== undefined &&
        parameter.parameterDeclaration === selected.parameterDeclaration &&
        parameter.acceptsOmission === selected.acceptsOmission &&
        parameter.rest === selected.rest;
    }));
  return matches.length === 1 ? { base, constructor: matches[0]! } : undefined;
}

export interface RustProjectTypePolicyRegistry extends RustProjectTypePolicy {
  initialize(host: RustProjectTypePolicyHost): RustProjectTypePolicy;
  isInitialized(): boolean;
  seal(): RustProjectTypePolicy;
}
