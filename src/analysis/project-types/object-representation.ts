import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  sourceNodesEqual,
  sourceObjectMemberDeclarations,
  type SourceDeclarationUse,
  type SourceExpressionValueFlowSummary,
  type SourceProgramNavigation,
  type SourceProgramSemantics,
} from "@tsonic/target-api/source";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
} from "./type-policy.js";
import {
  rustLifetimeOutlives,
  rustStaticLifetime,
} from "../../target-model/lifetimes/index.js";
import type { RustLifetimeRef } from "../../target-model/lifetimes/index.js";

export type RustObjectRepresentationKind =
  | "value"
  | "shared-immutable"
  | "shared-mutable"
  | "closed-hierarchy"
  | "open-hierarchy";

export interface RustObjectRepresentation {
  readonly definition: RustProjectTypeDefinition;
  readonly kind: RustObjectRepresentationKind;
  readonly mutable: boolean;
  readonly identityObserved: boolean;
  readonly escapes: boolean;
  readonly constructionCount: number;
  readonly dispatchObjectLifetime: RustLifetimeRef | undefined;
}

export interface RustObjectRepresentationPlan {
  readonly representations: readonly RustObjectRepresentation[];
  representationFor(
    definition: RustProjectTypeDefinition | undefined,
  ): RustObjectRepresentation | undefined;
  methodSelfMode(member: Node): "ref" | "mut-ref";
}

export interface RustObjectRepresentationAnalysisInput {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly semantics: SourceProgramSemantics;
  readonly projectTypes: RustProjectTypePolicy;
  readonly sourceFiles: readonly SourceFile[];
  readonly valueWrites: ReadonlySet<Node>;
  readonly hasPromotedStorage: (declaration: Node) => boolean;
  readonly hasMutableStorageUse: (declaration: Node) => boolean;
}

export interface RustObjectRepresentationPlanRegistry
  extends RustObjectRepresentationPlan {
  initialize(input: RustObjectRepresentationAnalysisInput): RustObjectRepresentationPlan;
  seal(): RustObjectRepresentationPlan;
}

export function createRustObjectRepresentationPlanRegistry(): RustObjectRepresentationPlanRegistry {
  let current: RustObjectRepresentationPlan | undefined;
  const requireCurrent = (): RustObjectRepresentationPlan => {
    if (current === undefined) {
      throw new Error("Rust object representation plan was read before source analysis initialized it.");
    }
    return current;
  };
  return Object.freeze({
    initialize(input: RustObjectRepresentationAnalysisInput) {
      if (current !== undefined) {
        throw new Error("Rust object representation plan can be initialized only once.");
      }
      current = createRustObjectRepresentationPlan(input);
      return current;
    },
    seal() {
      return requireCurrent();
    },
    get representations() {
      return requireCurrent().representations;
    },
    representationFor(definition: RustProjectTypeDefinition | undefined) {
      return requireCurrent().representationFor(definition);
    },
    methodSelfMode(member: Node) {
      return requireCurrent().methodSelfMode(member);
    },
  });
}

export function createRustObjectRepresentationPlan(
  input: RustObjectRepresentationAnalysisInput,
): RustObjectRepresentationPlan {
  const origins = collectProjectObjectOrigins(input);
  const mutatingMethods = collectMutatingProjectMethods(input);
  const representations = input.projectTypes.definitions.map((definition) => {
    const creationFlows = origins.get(definition) ?? [];
    const promotedStorage = creationFlows.some((flow) =>
      flow.aliasDeclarations.some(input.hasPromotedStorage));
    const mutable = promotedStorage || projectDefinitionIsMutable(
      definition,
      mutatingMethods,
      input,
    );
    const identityObserved = creationFlows.some((flow) => flow.identityCompared);
    const escapes = creationFlows.some((flow) => flow.escapes) ||
      projectReceiverEscapes(definition, input);
    const exported = input.navigation.declarationUseSummary(
      definition.declaration,
    ).exported;
    const hasIncompleteFlow = creationFlows.some((flow) =>
      flow.hasUnclassifiedUse || flow.storedOutsideBinding);
    const aliasedMutableValue = mutable && creationFlows.some((flow) =>
      flow.bindingAliased);
    const kind: RustObjectRepresentationKind = input.projectTypes.isPolymorphic(definition)
      ? "open-hierarchy"
      : creationFlows.length > 0 &&
            (definition.kind === "class" || interfaceHasOnlyLocalLiteralBindings(definition, creationFlows, input)) &&
            !exported &&
            !identityObserved &&
            !escapes &&
            !hasIncompleteFlow &&
            !promotedStorage &&
            !aliasedMutableValue
          ? "value"
          : mutable || definition.kind !== "class"
            ? "shared-mutable"
            : "shared-immutable";
    return Object.freeze({
      definition,
      kind,
      mutable,
      identityObserved,
      escapes,
      constructionCount: creationFlows.length,
      dispatchObjectLifetime: selectDispatchObjectLifetime(definition, kind),
    });
  });
  const byDefinition = new Map(representations.map((representation) =>
    [representation.definition, representation] as const));
  return Object.freeze({
    representations: Object.freeze(representations),
    representationFor(definition: RustProjectTypeDefinition | undefined) {
      return definition === undefined ? undefined : byDefinition.get(definition);
    },
    methodSelfMode(member: Node) {
      const owner = input.projectTypes.definitionContainingDeclaration(member);
      const representation = owner === undefined ? undefined : byDefinition.get(owner);
      return representation?.kind === "value" && mutatingMethods.has(member)
        ? "mut-ref"
        : "ref";
    },
  });
}

function selectDispatchObjectLifetime(
  definition: RustProjectTypeDefinition,
  kind: RustObjectRepresentationKind,
): RustLifetimeRef | undefined {
  if (kind !== "open-hierarchy") return undefined;
  const lifetimes = definition.genericParameters.flatMap((parameter) =>
    parameter.kind === "lifetime" ? [parameter.lifetime] : []);
  if (lifetimes.length === 0) return rustStaticLifetime;
  const contract = Object.freeze({
    declaration: definition.declaration,
    parameters: definition.genericParameters,
  });
  return lifetimes.find((candidate) =>
    lifetimes.every((source) => rustLifetimeOutlives(source, candidate, contract)));
}

function projectReceiverEscapes(
  definition: RustProjectTypeDefinition,
  input: RustObjectRepresentationAnalysisInput,
): boolean {
  let escapes = false;
  const visit = (node: Node, nestedCallable: boolean): void => {
    if (escapes) return;
    const kind = input.ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      const flow = input.navigation.expressionValueFlow(node);
      escapes = nestedCallable || flow.escapes || flow.hasUnclassifiedUse || flow.identityCompared;
      return;
    }
    const nested = nestedCallable || input.ast.is.IsArrowFunction(node) ||
      input.ast.is.IsFunctionExpression(node) || input.ast.is.IsFunctionDeclaration(node);
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child, nested); });
  };
  for (const member of input.ast.members(definition.declaration)) {
    if (member !== undefined && !input.ast.hasModifierKind(member, "static")) visit(member, false);
  }
  return escapes;
}

function collectProjectObjectOrigins(input: RustObjectRepresentationAnalysisInput): ReadonlyMap<RustProjectTypeDefinition, readonly SourceExpressionValueFlowSummary[]> {
  const origins = new Map<RustProjectTypeDefinition, SourceExpressionValueFlowSummary[]>();
  const visit = (node: Node): void => {
    if (input.ast.is.IsNewExpression(node) || input.ast.is.IsObjectLiteralExpression(node)) {
      const semantics = input.semantics.forNode(node);
      const contextual = input.ast.is.IsObjectLiteralExpression(node)
        ? semantics.types.contextualValueSelection(node)
        : undefined;
      const symbol = contextual?.kind === "selected"
        ? semantics.declarations.typeSymbol(contextual.type)
        : undefined;
      const declarations = symbol === undefined
        ? [input.navigation.declarationFor(node)]
        : semantics.declarations.symbolDeclarations(symbol);
      const candidates = new Set(declarations.map(declaration =>
        input.projectTypes.definitionForDeclaration(declaration)).filter(definition => definition !== undefined));
      const definition = candidates.size === 1 ? candidates.values().next().value : undefined;
      if (definition !== undefined) {
        const flows = origins.get(definition) ?? [];
        flows.push(input.navigation.expressionValueFlow(node));
        origins.set(definition, flows);
      }
    }
    input.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  for (const sourceFile of input.sourceFiles) {
    visit(sourceFile);
  }
  return origins;
}

function interfaceHasOnlyLocalLiteralBindings(
  definition: RustProjectTypeDefinition,
  flows: readonly SourceExpressionValueFlowSummary[],
  input: RustObjectRepresentationAnalysisInput,
): boolean {
  const uses = input.navigation.declarationUses(definition.declaration);
  return uses.length > 0 && uses.every(use => {
    const type = input.ast.parent(use.reference);
    const binding = input.ast.parent(type);
    if (use.kind !== "type-only" || type === undefined || binding === undefined ||
      !input.ast.is.IsTypeReferenceNode(type) || !input.ast.is.IsVariableDeclaration(binding)) return false;
    const declaration = input.ast.as.AsVariableDeclaration(binding);
    const initializer = declaration?.Initializer;
    return declaration?.Type === type && initializer !== undefined &&
      input.ast.is.IsObjectLiteralExpression(initializer) &&
      !input.navigation.declarationUseSummary(binding).bindingWritten &&
      flows.some(flow => flow.expression === initializer && flow.aliasDeclarations.includes(binding));
  });
}

function collectMutatingProjectMethods(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly projectTypes: RustProjectTypePolicy;
  readonly valueWrites: ReadonlySet<Node>;
}): ReadonlySet<Node> {
  const methods = input.projectTypes.definitions.flatMap((definition) =>
    input.ast.members(definition.declaration).filter((member): member is Node =>
      member !== undefined && isInstanceCallable(member, input.ast)));
  const methodSet = new Set(methods);
  const mutating = new Set<Node>();
  for (const write of input.valueWrites) {
    const caller = enclosingProjectMethod(write, input.ast, methodSet);
    if (caller !== undefined) mutating.add(caller);
  }
  const calls = new Map<Node, Set<Node>>();
  for (const definition of input.projectTypes.definitions) {
    for (const member of input.ast.members(definition.declaration)) {
      if (member === undefined || input.ast.hasModifierKind(member, "static")) {
        continue;
      }
      const summary = input.navigation.declarationUseSummary(member);
      for (const use of summary.uses) {
        const caller = enclosingProjectMethod(use.reference, input.ast, methodSet);
        if (caller === undefined) {
          continue;
        }
        if (use.role === "write") {
          mutating.add(caller);
        }
        if (isInstanceCallable(member, input.ast) && use.kind === "direct-call" &&
          sourceUseReceiverIsThis(use, input.ast)) {
          const callees = calls.get(caller) ?? new Set<Node>();
          callees.add(member);
          calls.set(caller, callees);
        }
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [caller, callees] of calls) {
      if (!mutating.has(caller) && [...callees].some((callee) => mutating.has(callee))) {
        mutating.add(caller);
        changed = true;
      }
    }
  }
  return mutating;
}

function projectDefinitionIsMutable(
  definition: RustProjectTypeDefinition,
  mutatingMethods: ReadonlySet<Node>,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
    readonly hasMutableStorageUse: (declaration: Node) => boolean;
  },
): boolean {
  return sourceObjectMemberDeclarations(input.ast, definition.declaration).some((member) =>
    member !== undefined && !input.ast.hasModifierKind(member, "static") &&
    (mutatingMethods.has(member) ||
      input.hasMutableStorageUse(member) ||
      input.navigation.declarationUseSummary(member).mutatedAfterInitialization));
}

function isInstanceCallable(node: Node, ast: AstReader): boolean {
  const kind = ast.kindName(node);
  return !ast.hasModifierKind(node, "static") &&
    (kind === "KindMethodDeclaration" ||
      kind === "KindGetAccessor" ||
      kind === "KindSetAccessor");
}

function enclosingProjectMethod(
  node: Node,
  ast: AstReader,
  methods: ReadonlySet<Node>,
): Node | undefined {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (methods.has(current)) {
      return current;
    }
    if (ast.is.IsFunctionDeclaration(current) ||
      ast.is.IsFunctionExpression(current) ||
      ast.is.IsArrowFunction(current) ||
      ast.is.IsConstructorDeclaration(current)) {
      return undefined;
    }
    current = ast.parent(current);
  }
  return undefined;
}

function sourceUseReceiverIsThis(
  use: SourceDeclarationUse,
  ast: AstReader,
): boolean {
  let current = use.memberReceiver;
  if (current === undefined) {
    return false;
  }
  let parent = ast.parent(current);
  while (parent !== undefined && sourceTransparentWrapperContains(ast, parent, current)) {
    current = parent;
    parent = ast.parent(current);
  }
  const kind = ast.kindName(current);
  return kind === "KindThisExpression" || kind === "KindThisKeyword";
}

function sourceTransparentWrapperContains(
  ast: AstReader,
  wrapper: Node,
  expression: Node,
): boolean {
  if (ast.is.IsParenthesizedExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsParenthesizedExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsAsExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsAsExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsSatisfiesExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsSatisfiesExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsNonNullExpression(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsNonNullExpression(wrapper)?.Expression, expression);
  }
  if (ast.is.IsTypeAssertion(wrapper)) {
    return sourceNodesEqual(ast, ast.as.AsTypeAssertion(wrapper)?.Expression, expression);
  }
  return false;
}
