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
} from "@tsonic/target-api";
import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import type { RustNamePlan } from "../../common/rust-name-plan.js";
import {
  rustScreamingSnakeIdentifier,
  rustSnakeCaseIdentifier,
} from "../../common/rust-identifiers.js";
import {
  allocateRustGeneratedName as allocateGeneratedName,
  rustGeneratedNameComponent,
} from "../../common/rust-generated-names.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  substituteRustTargetTypeParameters,
} from "../rust-target-types.js";
import type {
  RustExternalProjectBase,
  RustExternalProjectField,
} from "./external-project-types.js";

export interface RustProjectTypeIssue {
  readonly node: Node;
  readonly code: string;
  readonly message: string;
}

type RustProjectMemberSlotRole = "read" | "write" | "virtual" | "exact" | "static";

interface RustProjectMemberSlotCandidate {
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
}

export function createRustProjectTypePolicyRegistry(): RustProjectTypePolicyRegistry {
  let current: RustProjectTypePolicy | undefined;
  const requireCurrent = (): RustProjectTypePolicy => {
    if (current === undefined) {
      throw new Error("Rust project type policy was read before source analysis initialized it.");
    }
    return current;
  };
  const registry: RustProjectTypePolicyRegistry = {
    get definitions() {
      return requireCurrent().definitions;
    },
    get issues() {
      return requireCurrent().issues;
    },
    initialize(host) {
      if (current !== undefined) {
        throw new Error("Rust project type policy can be initialized only once.");
      }
      current = createRustProjectTypePolicy(host);
      return current;
    },
    isInitialized() {
      return current !== undefined;
    },
    definitionForDeclaration(declaration) {
      return requireCurrent().definitionForDeclaration(declaration);
    },
    definitionContainingDeclaration(declaration) {
      return requireCurrent().definitionContainingDeclaration(declaration);
    },
    definitionForCarrier(carrier) {
      return requireCurrent().definitionForCarrier(carrier);
    },
    openCarrier(definition) {
      return requireCurrent().openCarrier(definition);
    },
    heritageForDefinition(definition) {
      return requireCurrent().heritageForDefinition(definition);
    },
    externalBaseForDefinition(definition) {
      return requireCurrent().externalBaseForDefinition(definition);
    },
    externalFieldForReceiver(declaration, receiver) {
      return requireCurrent().externalFieldForReceiver(declaration, receiver);
    },
    get programErrorDefinitions() {
      return requireCurrent().programErrorDefinitions;
    },
    programErrorVariant(definition) {
      return requireCurrent().programErrorVariant(definition);
    },
    directSupertypes(carrier) {
      return requireCurrent().directSupertypes(carrier);
    },
    commonSupertype(carriers) {
      return requireCurrent().commonSupertype(carriers);
    },
    relationship(source, target) {
      return requireCurrent().relationship(source, target);
    },
    instantiateMemberCarrier(member, receiver, declaredCarrier) {
      return requireCurrent().instantiateMemberCarrier(member, receiver, declaredCarrier);
    },
    isPolymorphic(definition) {
      return requireCurrent().isPolymorphic(definition);
    },
    classLineage(definition) {
      return requireCurrent().classLineage(definition);
    },
    interfacesForClass(definition) {
      return requireCurrent().interfacesForClass(definition);
    },
    concreteClassesFor(definition) {
      return requireCurrent().concreteClassesFor(definition);
    },
    downcastRoutesFor(definition) {
      return requireCurrent().downcastRoutesFor(definition);
    },
    downcastRoute(source, targetCarrier) {
      return requireCurrent().downcastRoute(source, targetCarrier);
    },
    constructorsForDefinition(definition) {
      return requireCurrent().constructorsForDefinition(definition);
    },
    constructorForSignature(definition, signature) {
      return requireCurrent().constructorForSignature(definition, signature);
    },
    constructorForTargetName(definition, targetName) {
      return requireCurrent().constructorForTargetName(definition, targetName);
    },
    fieldStorageName(definition, declaration) {
      return requireCurrent().fieldStorageName(definition, declaration);
    },
    baseStateFieldName(definition) {
      return requireCurrent().baseStateFieldName(definition);
    },
    stateMarkerFieldName(definition) {
      return requireCurrent().stateMarkerFieldName(definition);
    },
    memberSlotName(declaration, role) {
      return requireCurrent().memberSlotName(declaration, role);
    },
    memberImplementation(concreteClass, contractMember) {
      return requireCurrent().memberImplementation(concreteClass, contractMember);
    },
  };
  return Object.freeze(registry);
}

export function createRustProjectTypePolicy(
  host: RustProjectTypePolicyHost,
): RustProjectTypePolicy {
  const definitions: RustProjectTypeDefinition[] = [];
  const issues: RustProjectTypeIssue[] = [];
  const byDeclaration = new WeakMap<Node, RustProjectTypeDefinition>();
  const byKey = new Map<string, RustProjectTypeDefinition>();
  const usedModuleNamesBySourceFile = new WeakMap<SourceFile, Set<string>>();

  for (const sourceFile of host.sourceFiles) {
    const usedNames = sourceFileIdentifierNames(sourceFile, host.ast, host.names);
    usedModuleNamesBySourceFile.set(sourceFile, usedNames);
    for (const statement of denseNodes(host.ast.statements(sourceFile)) ?? []) {
      const definition = projectDefinition(statement, sourceFile, host.ast, host.names, usedNames);
      if (definition === undefined) {
        continue;
      }
      const key = definitionKey(definition.fileName, definition.sourceName);
      const existing = byKey.get(key);
      if (existing !== undefined) {
        issues.push({
          node: statement,
          code: "RUST_PROJECT_TYPE_IDENTITY_CONFLICT",
          message: `Project declarations '${existing.sourceName}' and '${definition.sourceName}' have the same Rust source identity '${key}'.`,
        });
        continue;
      }
      definitions.push(definition);
      byDeclaration.set(statement, definition);
      byKey.set(key, definition);
    }
  }

  const heritageByDeclaration = new WeakMap<Node, readonly RustProjectHeritageEdge[]>();
  const externalBaseByDeclaration = new WeakMap<Node, RustExternalProjectBase>();
  for (const definition of definitions) {
    const selected = host.navigation.declaredHeritage(definition.declaration);
    if (selected.kind === "unresolved") {
      issues.push({
        node: selected.heritage,
        code: "RUST_PROJECT_HERITAGE_SOURCE_UNRESOLVED",
        message: selected.reason,
      });
      heritageByDeclaration.set(definition.declaration, Object.freeze([]));
      continue;
    }
    const edges: RustProjectHeritageEdge[] = [];
    for (const edge of selected.edges) {
      const target = byDeclaration.get(edge.target.declaration);
      if (target === undefined) {
        const externalBase = host.resolveExternalHeritage(edge);
        if (externalBase !== undefined && definition.kind === "class" &&
          definition.typeParameterNames.length === 0 &&
          externalBaseByDeclaration.get(definition.declaration) === undefined) {
          externalBaseByDeclaration.set(definition.declaration, externalBase);
          continue;
        }
        issues.push({
          node: edge.heritage,
          code: "RUST_PROJECT_HERITAGE_TARGET_UNSUPPORTED",
          message: `Project ${definition.kind} '${definition.sourceName}' has heritage outside the closed project type model.`,
        });
        continue;
      }
      const kindIssue = heritageKindIssue(definition, edge.kind, target);
      if (kindIssue !== undefined) {
        issues.push({
          node: edge.heritage,
          code: "RUST_PROJECT_HERITAGE_KIND_UNSUPPORTED",
          message: kindIssue,
        });
        continue;
      }
      if (edge.selectedTypeArguments.length !== target.typeParameterNames.length ||
        edge.typeArguments.length > edge.selectedTypeArguments.length) {
        issues.push({
          node: edge.heritage,
          code: "RUST_PROJECT_HERITAGE_ARITY_UNRESOLVED",
          message: `Project heritage '${definition.sourceName}' -> '${target.sourceName}' has no exact selected type-argument arity.`,
        });
        continue;
      }
      const arguments_ = edge.selectedTypeArguments.map((selectedType, index) =>
        host.resolveSelectedType(edge.typeArguments[index], selectedType, edge.heritage));
      if (arguments_.some((argument) => argument === undefined)) {
        issues.push({
          node: edge.heritage,
          code: "RUST_PROJECT_HERITAGE_CARRIER_UNRESOLVED",
          message: `Project heritage '${definition.sourceName}' -> '${target.sourceName}' has no closed Rust target type.`,
        });
        continue;
      }
      edges.push(Object.freeze({
        kind: edge.kind,
        source: definition,
        target,
        heritage: edge.heritage,
        targetType: rustSourceTypeCarrier(
          target.fileName,
          target.sourceName,
          "object",
          arguments_ as readonly TargetTypeRef[],
        ),
      }));
    }
    heritageByDeclaration.set(definition.declaration, Object.freeze(edges));
  }

  const directSupertypes = (carrier: TargetTypeRef): readonly TargetTypeRef[] | undefined => {
    const value = rustSourceTypeCarrierValue(carrier);
    const definition = value === undefined
      ? undefined
      : byKey.get(definitionKey(value.fileName, value.typeName));
    if (value === undefined || definition === undefined || value.typeArguments.length !== definition.typeParameterNames.length) {
      return undefined;
    }
    const substitutions = new Map(
      definition.typeParameterNames.map((name, index) => [name, value.typeArguments[index]!] as const),
    );
    const project = (heritageByDeclaration.get(definition.declaration) ?? []).map((edge) =>
      substituteRustTargetTypeParameters(edge.targetType, substitutions));
    const external = externalBaseByDeclaration.get(definition.declaration);
    return Object.freeze(external === undefined
      ? project
      : [...project, external.targetType]);
  };

  const openCarrier = (definition: RustProjectTypeDefinition): TargetTypeRef =>
    rustSourceTypeCarrier(
      definition.fileName,
      definition.sourceName,
      "object",
      definition.typeParameterNames.map((name) => ({ kind: "type-parameter", name })),
    );

  const relationship = (
    source: TargetTypeRef,
    target: RustProjectTypeDefinition,
  ): RustProjectTypeRelationship => {
    const pending: TargetTypeRef[] = [source];
    const visited: TargetTypeRef[] = [];
    const matches: TargetTypeRef[] = [];
    while (pending.length > 0) {
      const candidate = pending.shift()!;
      if (visited.some((entry) => rustTargetTypeRefEquals(entry, candidate))) {
        continue;
      }
      visited.push(candidate);
      const definition = definitionForCarrier(candidate);
      if (definition === target) {
        if (!matches.some((entry) => rustTargetTypeRefEquals(entry, candidate))) {
          matches.push(candidate);
        }
        continue;
      }
      pending.push(...(directSupertypes(candidate) ?? []));
    }
    return matches.length === 0
      ? { kind: "unrelated" }
      : matches.length === 1
        ? { kind: "related", targetType: matches[0]! }
        : { kind: "ambiguous", targetTypes: Object.freeze(matches) };
  };

  function definitionForCarrier(
    carrier: TargetTypeRef | undefined,
  ): RustProjectTypeDefinition | undefined {
    const value = rustSourceTypeCarrierValue(carrier);
    return value === undefined
      ? undefined
      : byKey.get(definitionKey(value.fileName, value.typeName));
  }

  function definitionContainingDeclaration(
    declaration: Node | undefined,
  ): RustProjectTypeDefinition | undefined {
    let current = declaration;
    while (current !== undefined) {
      const definition = byDeclaration.get(current);
      if (definition !== undefined) {
        return definition;
      }
      current = host.ast.parent(current);
    }
    return undefined;
  }

  const polymorphic = new Set<RustProjectTypeDefinition>();
  for (const definition of definitions) {
    if (definition.kind === "interface" &&
      (denseNodes(host.ast.members(definition.declaration)) ?? []).some((member) =>
        host.ast.kindName(member) === "KindMethodSignature")) {
      polymorphic.add(definition);
    }
  }
  for (const definition of definitions) {
    const edges = heritageByDeclaration.get(definition.declaration) ?? [];
    for (const edge of edges) {
      polymorphic.add(edge.target);
      polymorphic.add(definition);
    }
  }
  for (const definition of definitions) {
    if (externalBaseByDeclaration.get(definition.declaration) !== undefined) {
      polymorphic.add(definition);
    }
  }

  const externalAncestor = (
    definition: RustProjectTypeDefinition,
    seen: Set<RustProjectTypeDefinition> = new Set(),
  ): RustProjectTypeDefinition | undefined => {
    if (seen.has(definition)) {
      return undefined;
    }
    seen.add(definition);
    if (externalBaseByDeclaration.get(definition.declaration) !== undefined) {
      return definition;
    }
    const bases = (heritageByDeclaration.get(definition.declaration) ?? []).filter((edge) =>
      edge.kind === "extends" && edge.target.kind === "class");
    return bases.length === 1 ? externalAncestor(bases[0]!.target, seen) : undefined;
  };
  for (const definition of definitions) {
    const ancestor = externalAncestor(definition);
    if (ancestor !== undefined && ancestor !== definition) {
      issues.push({
        node: definition.declaration,
        code: "RUST_PROJECT_EXTERNAL_HERITAGE_TRANSITIVE_UNSUPPORTED",
        message: `Project class '${definition.sourceName}' transitively extends an external source-profile class; closed Rust program-error variants currently require one direct non-generic project subtype.`,
      });
    }
  }

  const programErrorDefinitions = Object.freeze(definitions
    .filter((definition) => externalBaseByDeclaration.get(definition.declaration)?.programError === true)
    .sort((left, right) => {
      const fileOrder = left.fileName.localeCompare(right.fileName, "en");
      return fileOrder === 0 ? left.sourceName.localeCompare(right.sourceName, "en") : fileOrder;
    }));
  const programErrorVariantByDefinition = new WeakMap<RustProjectTypeDefinition, string>();
  programErrorDefinitions.forEach((definition, index) => {
    programErrorVariantByDefinition.set(definition, `Project${index}`);
  });

  const classLineage = (
    definition: RustProjectTypeDefinition,
  ): readonly RustProjectTypeDefinition[] | undefined => {
    if (definition.kind !== "class") {
      return undefined;
    }
    const lineage: RustProjectTypeDefinition[] = [];
    const seen = new Set<RustProjectTypeDefinition>();
    let current: RustProjectTypeDefinition | undefined = definition;
    while (current !== undefined) {
      if (seen.has(current)) {
        return undefined;
      }
      seen.add(current);
      lineage.unshift(current);
      const bases: readonly RustProjectHeritageEdge[] = (
        heritageByDeclaration.get(current.declaration) ?? []
      ).filter((edge) =>
        edge.kind === "extends" && edge.target.kind === "class");
      if (bases.length > 1) {
        return undefined;
      }
      current = bases[0]?.target;
    }
    return Object.freeze(lineage);
  };

  const interfacesForClass = (
    definition: RustProjectTypeDefinition,
  ): readonly RustProjectTypeDefinition[] | undefined => {
    const lineage = classLineage(definition);
    if (lineage === undefined) {
      return undefined;
    }
    const result: RustProjectTypeDefinition[] = [];
    const visit = (candidate: RustProjectTypeDefinition): boolean => {
      if (result.includes(candidate)) {
        return true;
      }
      result.push(candidate);
      for (const edge of heritageByDeclaration.get(candidate.declaration) ?? []) {
        if (edge.target.kind === "interface" && !visit(edge.target)) {
          return false;
        }
      }
      return true;
    };
    for (const classDefinition of lineage) {
      for (const edge of heritageByDeclaration.get(classDefinition.declaration) ?? []) {
        if (edge.kind === "implements" && !visit(edge.target)) {
          return undefined;
        }
      }
    }
    return Object.freeze(result);
  };

  const constructorsByDefinition = new WeakMap<
    RustProjectTypeDefinition,
    readonly RustProjectConstructorSignature[]
  >();
  const constructorsBySignature = new WeakMap<Signature, RustProjectConstructorSignature>();
  for (const definition of definitions) {
    if (definition.kind !== "class") {
      constructorsByDefinition.set(definition, Object.freeze([]));
      continue;
    }
    const selected = host.navigation.classConstructors(definition.declaration);
    if (selected.kind === "unresolved") {
      issues.push({
        node: selected.declaration,
        code: "RUST_PROJECT_CONSTRUCTOR_SOURCE_UNRESOLVED",
        message: selected.reason,
      });
      constructorsByDefinition.set(definition, Object.freeze([]));
      continue;
    }
    const usedNames = projectMemberNames(definition.declaration, host.ast, host.names);
    const targetName = allocateGeneratedName(
      usedNames,
      "new",
    );
    const initializeName = allocateGeneratedName(
      usedNames,
      "initialize_state",
    );
    const signatures = selected.signatures.map((signature) => {
      const plan: RustProjectConstructorSignature = Object.freeze({
        signature: signature.signature,
        ...(signature.declaration === undefined ? {} : { declaration: signature.declaration }),
        parameters: signature.parameters,
        implicit: selected.implicit,
        targetName,
        initializeName,
      });
      constructorsBySignature.set(signature.signature, plan);
      return plan;
    });
    constructorsByDefinition.set(definition, Object.freeze(signatures));
  }

  const fieldStorageNamesByDefinition = new WeakMap<
    RustProjectTypeDefinition,
    ReadonlyMap<Node, string>
  >();
  const baseStateFieldNamesByDefinition = new WeakMap<RustProjectTypeDefinition, string>();
  const stateMarkerFieldNamesByDefinition = new WeakMap<RustProjectTypeDefinition, string>();
  for (const definition of definitions) {
    const names = new Map<Node, string>();
    const usedNames = new Set<string>();
    const externalBase = externalBaseByDeclaration.get(definition.declaration);
    for (const field of externalBase?.fields ?? []) {
      names.set(
        field.declaration,
        allocateGeneratedName(usedNames, rustSnakeCaseIdentifier(field.sourceName)),
      );
    }
    for (const member of denseNodes(host.ast.members(definition.declaration)) ?? []) {
      const kind = host.ast.kindName(member);
      const isField = definition.kind === "class"
        ? kind === "KindPropertyDeclaration" && !host.ast.hasModifierKind(member, "static")
        : kind === "KindPropertySignature";
      if (!isField) {
        continue;
      }
      const targetName = host.names.nameForDeclaration(member);
      if (targetName !== undefined) {
        names.set(member, allocateGeneratedName(usedNames, targetName));
      }
    }
    fieldStorageNamesByDefinition.set(definition, names);
    baseStateFieldNamesByDefinition.set(definition, allocateGeneratedName(usedNames, "base"));
    stateMarkerFieldNamesByDefinition.set(
      definition,
      allocateGeneratedName(usedNames, "type_marker"),
    );
  }

  const memberSlotNames = new WeakMap<Node, Map<RustProjectMemberSlotRole, string>>();
  const canonicalSlotNames = new WeakMap<Node, Map<RustProjectMemberSlotRole, string>>();
  const dispatchUsedNamesByDefinition = new WeakMap<RustProjectTypeDefinition, Set<string>>();
  const setMemberSlotName = (
    declaration: Node,
    role: RustProjectMemberSlotRole,
    name: string,
  ): void => {
    const names = memberSlotNames.get(declaration) ?? new Map<RustProjectMemberSlotRole, string>();
    names.set(role, name);
    memberSlotNames.set(declaration, names);
  };
  const canonicalCallable = (declaration: Node): Node => {
    const implementation = host.navigation.callableImplementation(declaration);
    return implementation.kind === "resolved"
      ? implementation.implementation.declaration
      : declaration;
  };
  for (const definition of definitions) {
    const dispatchUsedNames = projectMemberNames(definition.declaration, host.ast, host.names);
    for (const constructor of constructorsByDefinition.get(definition) ?? []) {
      dispatchUsedNames.add(constructor.targetName);
      dispatchUsedNames.add(constructor.initializeName);
    }
    dispatchUsedNamesByDefinition.set(definition, dispatchUsedNames);
    const moduleUsedNames = usedModuleNamesBySourceFile.get(definition.sourceFile);
    if (moduleUsedNames === undefined) {
      throw new Error("Rust project definition has no module name scope.");
    }
    const candidates: RustProjectMemberSlotCandidate[] = [
      ...(externalBaseByDeclaration.get(definition.declaration)?.fields ?? []).map((field) => ({
        declaration: field.declaration,
        targetName: rustSnakeCaseIdentifier(field.sourceName),
        roles: ["read", "write"] as readonly RustProjectMemberSlotRole[],
      })),
    ];
    for (const member of denseNodes(host.ast.members(definition.declaration)) ?? []) {
      const kind = host.ast.kindName(member);
      const targetName = host.names.nameForDeclaration(member);
      if (targetName === undefined) {
        continue;
      }
      if (kind === "KindPropertyDeclaration" && host.ast.hasModifierKind(member, "static")) {
        const staticName = allocateGeneratedName(
          moduleUsedNames,
          rustScreamingSnakeIdentifier(
            `${rustGeneratedNameComponent(definition.targetName)}_${rustGeneratedNameComponent(targetName)}`,
          ),
        );
        setMemberSlotName(member, "static", staticName);
        continue;
      }
      if (kind === "KindPropertyDeclaration" || kind === "KindPropertySignature") {
        candidates.push({ declaration: member, targetName, roles: ["read", "write"] });
      } else if (kind === "KindGetAccessor") {
        candidates.push({ declaration: member, targetName, roles: ["read"] });
      } else if (kind === "KindSetAccessor") {
        candidates.push({ declaration: member, targetName, roles: ["write"] });
      } else if ((kind === "KindMethodDeclaration" || kind === "KindMethodSignature") &&
        !host.ast.hasModifierKind(member, "static")) {
        candidates.push({ declaration: member, targetName, roles: ["virtual", "exact"] });
      }
    }
    for (const candidate of candidates) {
      const canonical = candidate.roles.some((role) => role === "virtual" || role === "exact")
        ? canonicalCallable(candidate.declaration)
        : candidate.declaration;
      const canonicalNames = canonicalSlotNames.get(canonical) ??
        new Map<RustProjectMemberSlotRole, string>();
      for (const role of candidate.roles) {
        const existing = canonicalNames.get(role);
        const preferredRole = role === "virtual" ? "dispatch" : role;
        const name = existing ?? allocateGeneratedName(
          dispatchUsedNames,
          `${preferredRole}_${rustGeneratedNameComponent(definition.targetName)}_${rustGeneratedNameComponent(candidate.targetName)}`,
        );
        canonicalNames.set(role, name);
        setMemberSlotName(candidate.declaration, role, name);
        setMemberSlotName(canonical, role, name);
      }
      canonicalSlotNames.set(canonical, canonicalNames);
    }
  }

  const frozenDefinitions = Object.freeze(definitions);
  const frozenIssues = Object.freeze(issues);
  const orderedDefinitions = [...frozenDefinitions].sort(compareProjectDefinitions);
  const downcastRoutesByDefinition = new WeakMap<
    RustProjectTypeDefinition,
    readonly RustProjectDowncastRoute[]
  >();
  for (const source of frozenDefinitions) {
    const usedNames = dispatchUsedNamesByDefinition.get(source);
    if (usedNames === undefined) {
      throw new Error("Rust project definition has no dispatch name scope.");
    }
    const targets = orderedDefinitions
      .filter((target) => target.kind === "class" && target.typeParameterNames.length === 0)
      .filter((target) => relationship(openCarrier(target), source).kind === "related");
    downcastRoutesByDefinition.set(source, Object.freeze(targets.map((target) => Object.freeze({
      source,
      target,
      targetCarrier: openCarrier(target),
      slot: allocateGeneratedName(
        usedNames,
        `downcast_${rustGeneratedNameComponent(source.targetName)}_to_${rustGeneratedNameComponent(target.targetName)}`,
      ),
    }))));
  }
  const policy: RustProjectTypePolicy = {
    definitions: frozenDefinitions,
    issues: frozenIssues,
    programErrorDefinitions,
    definitionForDeclaration(declaration) {
      return declaration === undefined ? undefined : byDeclaration.get(declaration);
    },
    definitionContainingDeclaration,
    definitionForCarrier,
    openCarrier,
    heritageForDefinition(definition) {
      return heritageByDeclaration.get(definition.declaration) ?? Object.freeze([]);
    },
    externalBaseForDefinition(definition) {
      return externalBaseByDeclaration.get(definition.declaration);
    },
    externalFieldForReceiver(declaration, receiver) {
      if (declaration === undefined || receiver === undefined) {
        return undefined;
      }
      const matches = programErrorDefinitions.flatMap((owner) => {
        const base = externalBaseByDeclaration.get(owner.declaration);
        const field = base?.fields.find((candidate) => candidate.declaration === declaration);
        const selected = field === undefined ? undefined : relationship(receiver, owner);
        return base !== undefined && field !== undefined && selected?.kind === "related"
          ? [{ owner, base, field, ownerCarrier: selected.targetType }]
          : [];
      });
      return matches.length === 1 ? matches[0] : undefined;
    },
    programErrorVariant(definition) {
      return programErrorVariantByDefinition.get(definition);
    },
    directSupertypes,
    commonSupertype(carriers) {
      if (carriers.length < 2) {
        return undefined;
      }
      const common = frozenDefinitions.flatMap((definition) => {
        const relationships = carriers.map((carrier) => relationship(carrier, definition));
        if (relationships.some((selected) => selected.kind !== "related")) {
          return [];
        }
        const targetTypes = relationships.map((selected) =>
          selected.kind === "related" ? selected.targetType : undefined);
        const first = targetTypes[0];
        return first !== undefined && targetTypes.every((target) =>
          target !== undefined && rustTargetTypeRefEquals(target, first))
          ? [{ definition, targetType: first }]
          : [];
      });
      const mostSpecific = common.filter((candidate) => !common.some((other) =>
        other !== candidate && relationship(
          policy.openCarrier(other.definition),
          candidate.definition,
        ).kind === "related"));
      return mostSpecific.length === 1 ? mostSpecific[0]!.targetType : undefined;
    },
    relationship,
    instantiateMemberCarrier(member, receiver, declaredCarrier) {
      const owner = definitionContainingDeclaration(member);
      if (owner === undefined) {
        return undefined;
      }
      const selected = relationship(receiver, owner);
      if (selected.kind !== "related") {
        return undefined;
      }
      const value = rustSourceTypeCarrierValue(selected.targetType);
      if (value === undefined || value.typeArguments.length !== owner.typeParameterNames.length) {
        return undefined;
      }
      return substituteRustTargetTypeParameters(
        declaredCarrier,
        new Map(owner.typeParameterNames.map((name, index) => [name, value.typeArguments[index]!] as const)),
      );
    },
    isPolymorphic(definition) {
      return polymorphic.has(definition);
    },
    classLineage,
    interfacesForClass,
    concreteClassesFor(definition) {
      return Object.freeze(definitions.filter((candidate) => {
        if (candidate.kind !== "class") {
          return false;
        }
        const relation = relationship(policy.openCarrier(candidate), definition);
        return relation.kind === "related";
      }));
    },
    downcastRoutesFor(definition) {
      return downcastRoutesByDefinition.get(definition) ?? Object.freeze([]);
    },
    downcastRoute(source, targetCarrier) {
      const matches = (downcastRoutesByDefinition.get(source) ?? []).filter((route) =>
        rustTargetTypeRefEquals(route.targetCarrier, targetCarrier));
      return matches.length === 1 ? matches[0] : undefined;
    },
    constructorsForDefinition(definition) {
      return constructorsByDefinition.get(definition) ?? Object.freeze([]);
    },
    constructorForSignature(definition, signature) {
      if (signature === undefined) {
        return undefined;
      }
      const selected = constructorsBySignature.get(signature);
      return selected !== undefined &&
          (constructorsByDefinition.get(definition) ?? []).includes(selected)
        ? selected
        : undefined;
    },
    constructorForTargetName(definition, targetName) {
      return (constructorsByDefinition.get(definition) ?? []).find((signature) =>
        signature.targetName === targetName);
    },
    fieldStorageName(definition, declaration) {
      return fieldStorageNamesByDefinition.get(definition)?.get(declaration);
    },
    baseStateFieldName(definition) {
      const name = baseStateFieldNamesByDefinition.get(definition);
      if (name === undefined) {
        throw new Error("Rust project definition has no deterministic base-state field name.");
      }
      return name;
    },
    memberSlotName(declaration, role) {
      return memberSlotNames.get(declaration)?.get(role);
    },
    stateMarkerFieldName(definition) {
      const name = stateMarkerFieldNamesByDefinition.get(definition);
      if (name === undefined) {
        throw new Error("Rust project definition has no deterministic state-marker field name.");
      }
      return name;
    },
    memberImplementation(concreteClass, contractMember) {
      return host.navigation.memberImplementation(
        concreteClass.declaration,
        contractMember,
      );
    },
  };
  return Object.freeze(policy);
}

function projectDefinition(
  declaration: Node,
  sourceFile: SourceFile,
  ast: AstReader,
  namePlan: RustNamePlan,
  usedNames: Set<string>,
): RustProjectTypeDefinition | undefined {
  const kindName = ast.kindName(declaration);
  const kind = kindName === "KindClassDeclaration"
    ? "class" as const
    : kindName === "KindInterfaceDeclaration"
      ? "interface" as const
      : undefined;
  if (kind === undefined) {
    return undefined;
  }
  const nameNode = ast.name(declaration);
  const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
  const targetName = namePlan.nameForDeclaration(declaration);
  const fileName = ast.getFileName(sourceFile);
  const rawParameters = ast.typeParameters(declaration);
  const parameters = denseNodes(rawParameters);
  const sourceTypeParameterNames = parameters?.map((parameter) => {
    const name = ast.name(parameter);
    return name === undefined ? "" : ast.text(name);
  });
  const targetParameterNames = parameters?.map((parameter) =>
    namePlan.nameForDeclaration(parameter));
  return sourceName.length === 0 || targetName === undefined || fileName.length === 0 ||
      parameters === undefined || sourceTypeParameterNames === undefined ||
      sourceTypeParameterNames.some((name) => name.length === 0) ||
      targetParameterNames === undefined || targetParameterNames.some((name) => name === undefined)
    ? undefined
    : (() => {
        const stateName = allocateGeneratedName(
          usedNames,
          `${targetName}State`,
        );
        const dispatchName = allocateGeneratedName(
          usedNames,
          `${targetName}Dispatch`,
        );
        const rootName = kind === "class"
          ? allocateGeneratedName(usedNames, `${targetName}Root`)
          : undefined;
        return Object.freeze({
        declaration,
        sourceFile,
        fileName,
        sourceName,
        targetName,
        kind,
        typeParameterNames: Object.freeze(sourceTypeParameterNames),
        targetTypeParameterNames: Object.freeze(targetParameterNames as string[]),
        stateName,
        dispatchName,
        ...(rootName === undefined ? {} : { rootName }),
      });
      })();
}

function sourceFileIdentifierNames(
  sourceFile: SourceFile,
  ast: AstReader,
  namePlan: RustNamePlan,
): Set<string> {
  const result = new Set<string>();
  const visit = (node: Node | undefined): void => {
    if (node === undefined) {
      return;
    }
    const targetName = namePlan.nameForDeclaration(node);
    if (targetName !== undefined) {
      result.add(targetName);
    }
    ast.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function projectMemberNames(
  declaration: Node,
  ast: AstReader,
  namePlan: RustNamePlan,
): Set<string> {
  const result = new Set<string>();
  for (const member of denseNodes(ast.members(declaration)) ?? []) {
    const targetName = namePlan.nameForDeclaration(member);
    if (targetName !== undefined) {
      result.add(targetName);
    }
  }
  return result;
}

function heritageKindIssue(
  source: RustProjectTypeDefinition,
  relation: "extends" | "implements",
  target: RustProjectTypeDefinition,
): string | undefined {
  if (source.kind === "interface") {
    return relation !== "extends" || target.kind !== "interface"
      ? `Project interface '${source.sourceName}' can extend only another project interface.`
      : undefined;
  }
  return relation === "extends"
    ? target.kind === "class"
      ? undefined
      : `Project class '${source.sourceName}' can extend only another project class.`
    : target.kind === "interface"
      ? undefined
      : `Project class '${source.sourceName}' can implement only a project interface.`;
}

function definitionKey(fileName: string, sourceName: string): string {
  return `${fileName}::${sourceName}`;
}

function compareProjectDefinitions(
  left: RustProjectTypeDefinition,
  right: RustProjectTypeDefinition,
): number {
  const fileOrder = left.fileName.localeCompare(right.fileName, "en");
  return fileOrder !== 0
    ? fileOrder
    : left.sourceName.localeCompare(right.sourceName, "en");
}

function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly Node[]
    : undefined;
}
