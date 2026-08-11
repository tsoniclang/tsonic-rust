import type {
  AstReader,
  Node,
  SourceFile,
  Type,
} from "@tsonic/tsts";
import type {
  SourceProgramNavigation,
  SourceProjectMemberImplementationResult,
} from "@tsonic/target-api";
import type { TargetTypeRef } from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import {
  rustSourceTypeCarrier,
  rustSourceTypeCarrierValue,
  substituteRustTargetTypeParameters,
} from "../rust-target-types.js";

export interface RustProjectTypeIssue {
  readonly node: Node;
  readonly code: string;
  readonly message: string;
}

export interface RustProjectTypeDefinition {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly sourceName: string;
  readonly kind: "class" | "interface";
  readonly typeParameterNames: readonly string[];
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

export interface RustProjectTypePolicy {
  readonly definitions: readonly RustProjectTypeDefinition[];
  readonly issues: readonly RustProjectTypeIssue[];
  definitionForDeclaration(declaration: Node | undefined): RustProjectTypeDefinition | undefined;
  definitionContainingDeclaration(declaration: Node | undefined): RustProjectTypeDefinition | undefined;
  definitionForCarrier(carrier: TargetTypeRef | undefined): RustProjectTypeDefinition | undefined;
  openCarrier(definition: RustProjectTypeDefinition): TargetTypeRef;
  heritageForDefinition(definition: RustProjectTypeDefinition): readonly RustProjectHeritageEdge[];
  directSupertypes(carrier: TargetTypeRef): readonly TargetTypeRef[] | undefined;
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
  memberImplementation(
    concreteClass: RustProjectTypeDefinition,
    contractMember: Node,
  ): SourceProjectMemberImplementationResult;
}

export interface RustProjectTypePolicyHost {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly sourceFiles: readonly SourceFile[];
  resolveSelectedType(
    authoredTypeNode: Node | undefined,
    selectedType: Type,
    heritage: Node,
  ): TargetTypeRef | undefined;
}

export function rustProjectMemberSlotName(
  ast: AstReader,
  declaration: Node,
  role: "read" | "write" | "virtual" | "exact",
): string | undefined {
  const sourceFile = ast.getSourceFile(declaration);
  const fileName = ast.getFileName(sourceFile);
  const start = ast.pos(declaration);
  const end = ast.end(declaration);
  if (fileName.length === 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return undefined;
  }
  return `__tsonic_${role}_${start}_${end}`;
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
    directSupertypes(carrier) {
      return requireCurrent().directSupertypes(carrier);
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

  for (const sourceFile of host.sourceFiles) {
    for (const statement of denseNodes(host.ast.statements(sourceFile)) ?? []) {
      const definition = projectDefinition(statement, sourceFile, host.ast);
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
    return Object.freeze((heritageByDeclaration.get(definition.declaration) ?? []).map((edge) =>
      substituteRustTargetTypeParameters(edge.targetType, substitutions)));
  };

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
    const edges = heritageByDeclaration.get(definition.declaration) ?? [];
    for (const edge of edges) {
      polymorphic.add(edge.target);
      polymorphic.add(definition);
    }
  }

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

  const frozenDefinitions = Object.freeze(definitions);
  const frozenIssues = Object.freeze(issues);
  const policy: RustProjectTypePolicy = {
    definitions: frozenDefinitions,
    issues: frozenIssues,
    definitionForDeclaration(declaration) {
      return declaration === undefined ? undefined : byDeclaration.get(declaration);
    },
    definitionContainingDeclaration,
    definitionForCarrier,
    openCarrier(definition) {
      return rustSourceTypeCarrier(
        definition.fileName,
        definition.sourceName,
        "object",
        definition.typeParameterNames.map((name) => ({ kind: "type-parameter", name })),
      );
    },
    heritageForDefinition(definition) {
      return heritageByDeclaration.get(definition.declaration) ?? Object.freeze([]);
    },
    directSupertypes,
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
  const fileName = ast.getFileName(sourceFile);
  const rawParameters = ast.typeParameters(declaration);
  const parameters = denseNodes(rawParameters);
  const names = parameters?.map((parameter) => {
    const name = ast.name(parameter);
    return name === undefined ? "" : ast.text(name);
  });
  return sourceName.length === 0 || fileName.length === 0 ||
      parameters === undefined || names === undefined || names.some((name) => name.length === 0)
    ? undefined
    : Object.freeze({
        declaration,
        sourceFile,
        fileName,
        sourceName,
        kind,
        typeParameterNames: Object.freeze(names),
      });
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

function denseNodes(values: readonly (Node | undefined)[]): readonly Node[] | undefined {
  return isDenseDataArray(values) && values.every((value) => value !== undefined)
    ? values as readonly Node[]
    : undefined;
}
