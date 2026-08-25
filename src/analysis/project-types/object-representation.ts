import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  sourceNodesEqual,
  type SourceDeclarationUse,
  type SourceExpressionValueFlowSummary,
  type SourceProgramNavigation,
} from "@tsonic/target-api/source";
import type {
  RustProjectTypeDefinition,
  RustProjectTypePolicy,
} from "./type-policy.js";
import type { RustDeclarationContractIndex } from "../declarations/declaration-applications.js";

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
}

export interface RustObjectRepresentationPlan {
  readonly representations: readonly RustObjectRepresentation[];
  readonly issues: readonly RustObjectRepresentationIssue[];
  representationFor(
    definition: RustProjectTypeDefinition | undefined,
  ): RustObjectRepresentation | undefined;
  requiresDynamicDispatch(
    definition: RustProjectTypeDefinition | undefined,
  ): boolean;
  methodSelfMode(member: Node): "ref" | "mut-ref";
}

export interface RustObjectRepresentationIssue {
  readonly code: string;
  readonly message: string;
  readonly node: Node;
}

export interface RustObjectRepresentationAnalysisInput {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly projectTypes: RustProjectTypePolicy;
  readonly sourceFiles: readonly SourceFile[];
  readonly declarationContracts: RustDeclarationContractIndex;
  readonly hasPromotedStorage: (declaration: Node) => boolean;
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
    get issues() {
      return requireCurrent().issues;
    },
    representationFor(definition: RustProjectTypeDefinition | undefined) {
      return requireCurrent().representationFor(definition);
    },
    requiresDynamicDispatch(definition: RustProjectTypeDefinition | undefined) {
      return requireCurrent().requiresDynamicDispatch(definition);
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
  const issues: RustObjectRepresentationIssue[] = [];
  const representations: readonly RustObjectRepresentation[] = input.projectTypes.definitions.map((definition) => {
    const creationFlows = origins.get(definition) ?? [];
    const promotedStorage = creationFlows.some((flow) =>
      flow.aliasDeclarations.some(input.hasPromotedStorage));
    const mutable = promotedStorage || projectDefinitionIsMutable(
      definition,
      mutatingMethods,
      input,
    );
    const identityObserved = creationFlows.some((flow) => flow.identityCompared);
    const escapes = creationFlows.some((flow) => flow.escapes);
    const exported = input.navigation.declarationUseSummary(
      definition.declaration,
    ).exported;
    const hasIncompleteFlow = creationFlows.some((flow) =>
      flow.hasUnclassifiedUse || flow.storedOutsideBinding);
    const aliasedMutableValue = mutable && creationFlows.some((flow) =>
      flow.bindingAliased);
    const declarationContract = input.declarationContracts.forDeclaration(
      definition.declaration,
    );
    const explicitlyNativeValue = definition.kind === "class" && (
      declarationContract?.nativeUnion === true ||
      (declarationContract?.representations.length ?? 0) > 0 ||
      input.ast.members(definition.declaration).some((member) =>
        member !== undefined &&
        input.declarationContracts.forDeclaration(member)?.nativeDrop === true)
    );
    if (explicitlyNativeValue && (identityObserved || hasIncompleteFlow ||
      promotedStorage || aliasedMutableValue)) {
      issues.push(Object.freeze({
        code: "RUST_EXPLICIT_NATIVE_VALUE_ALIAS_CONFLICT",
        message:
          "An explicit Rust layout, union, or Drop contract requires by-value representation, but the exact source flow observes shared identity, unresolved aliasing, or promoted location storage.",
        node: definition.declaration,
      }));
    }
    const kind: RustObjectRepresentationKind = explicitlyNativeValue
      ? "value"
      : input.projectTypes.isPolymorphic(definition)
      ? "open-hierarchy"
      : definition.kind !== "class"
        ? "shared-mutable"
        : creationFlows.length > 0 &&
            !exported &&
            !identityObserved &&
            !escapes &&
            !hasIncompleteFlow &&
            !promotedStorage &&
            !aliasedMutableValue
          ? "value"
          : mutable
            ? "shared-mutable"
            : "shared-immutable";
    return Object.freeze({
      definition,
      kind,
      mutable,
      identityObserved,
      escapes,
      constructionCount: creationFlows.length,
    });
  });
  const byDefinition = new Map(representations.map((representation) =>
    [representation.definition, representation] as const));
  return Object.freeze({
    representations: Object.freeze(representations),
    issues: Object.freeze(issues),
    representationFor(definition: RustProjectTypeDefinition | undefined) {
      return definition === undefined ? undefined : byDefinition.get(definition);
    },
    requiresDynamicDispatch(definition: RustProjectTypeDefinition | undefined) {
      const kind = definition === undefined ? undefined : byDefinition.get(definition)?.kind;
      return kind === "open-hierarchy" || kind === "closed-hierarchy";
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

function collectProjectObjectOrigins(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly projectTypes: RustProjectTypePolicy;
  readonly sourceFiles: readonly SourceFile[];
}): ReadonlyMap<RustProjectTypeDefinition, readonly SourceExpressionValueFlowSummary[]> {
  const origins = new Map<RustProjectTypeDefinition, SourceExpressionValueFlowSummary[]>();
  const visit = (node: Node): void => {
    if (input.ast.is.IsNewExpression(node) || input.ast.is.IsObjectLiteralExpression(node)) {
      const declaration = input.navigation.declarationFor(node);
      const definition = input.projectTypes.definitionForDeclaration(declaration);
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

function collectMutatingProjectMethods(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly projectTypes: RustProjectTypePolicy;
}): ReadonlySet<Node> {
  const methods = input.projectTypes.definitions.flatMap((definition) =>
    input.ast.members(definition.declaration).filter((member): member is Node =>
      member !== undefined && isInstanceCallable(member, input.ast)));
  const methodSet = new Set(methods);
  const mutating = new Set<Node>();
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
  },
): boolean {
  return input.ast.members(definition.declaration).some((member) =>
    member !== undefined && !input.ast.hasModifierKind(member, "static") &&
    (mutatingMethods.has(member) ||
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
