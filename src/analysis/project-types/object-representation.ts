import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { snapshotTargetReadonlyMap } from "@tsonic/target-api/analysis";
import { selectRustObjectRepresentationKind, selectRustObjectNativeLifetimeContract, selectRustMethodSelfMode } from "../../policy/types/objects/representation.js";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceNodesEqual, Node_Expression, sourceObjectMemberDeclarations, type SourceDeclarationUse, type SourceExpressionValueFlowSummary, type SourceProgramNavigation, type SourceProgramSemantics } from "@tsonic/target-api/source";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "./index.js";

import type { RustReceiverFieldAliasQueries } from "./receiver-field-aliases.js";
import type { RustReceiverFieldCaptureQueries } from "./receiver-captures.js";
import type { RustReceiverStoragePlan } from "./receiver-storage.js";

import type { RustObjectRepresentation, RustObjectNativeLifetimeContract } from "../../target-model/records/object-representation.js";

export function prepareRustObjectNativeLifetimes(
  projectTypes: Pick<RustProjectTypePolicy, "definitions" | "isPolymorphic">,
): ReadonlyMap<RustProjectTypeDefinition, RustObjectNativeLifetimeContract> {
  return snapshotTargetReadonlyMap(projectTypes.definitions.map(definition => [definition,
    selectRustObjectNativeLifetimeContract(definition, projectTypes.isPolymorphic(definition))] as const));
}

export interface RustObjectRepresentationPlan extends RustReceiverFieldAliasQueries {
  readonly receiverCaptures: RustReceiverFieldCaptureQueries;
  readonly representations: readonly RustObjectRepresentation[];
  nativeLifetimeFor(definition: RustProjectTypeDefinition | undefined): RustObjectNativeLifetimeContract | undefined;
  representationFor(
    definition: RustProjectTypeDefinition | undefined,
  ): RustObjectRepresentation | undefined;
  methodSelfMode(member: Node): "ref" | "mut-ref";
}

export interface RustObjectRepresentationAnalysisInput {
  readonly receiverStorage: RustReceiverStoragePlan;
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly semantics: SourceProgramSemantics;
  readonly projectTypes: RustProjectTypePolicy;
  readonly sourceFiles: readonly SourceFile[];
  readonly isNativeNode: (node: Node) => boolean;
  readonly valueWrites: ReadonlySet<Node>;
  readonly hasPromotedStorage: (declaration: Node) => boolean;
  readonly hasMutableStorageUse: (declaration: Node) => boolean;
  readonly referenceDeclarations?: ReadonlySet<Node>;
  readonly nativeLifetimes: ReadonlyMap<RustProjectTypeDefinition, RustObjectNativeLifetimeContract>;
}

export interface RustObjectRepresentationPlanRegistry
  extends RustObjectRepresentationPlan {
  prepareNativeLifetimes(projectTypes: Pick<RustProjectTypePolicy, "definitions" | "isPolymorphic">): void;
  initialize(input: Omit<RustObjectRepresentationAnalysisInput, "nativeLifetimes">): RustObjectRepresentationPlan;
  seal(): RustObjectRepresentationPlan;
}

export function createRustObjectRepresentationPlanRegistry(): RustObjectRepresentationPlanRegistry {
  let current: RustObjectRepresentationPlan | undefined;
  let nativeLifetimes: ReadonlyMap<RustProjectTypeDefinition, RustObjectNativeLifetimeContract> | undefined;
  const requireCurrent = (): RustObjectRepresentationPlan => {
    if (current === undefined) {
      failTargetAnalysisInvariant("tsonic-rust", "Rust object representation plan was read before source analysis initialized it.");
    }
    return current;
  };
  return Object.freeze({
    prepareNativeLifetimes(projectTypes: Pick<RustProjectTypePolicy, "definitions" | "isPolymorphic">) {
      if (nativeLifetimes !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native object lifetime contracts prepare once before value storage selection.");
      nativeLifetimes = prepareRustObjectNativeLifetimes(projectTypes);
    },
    nativeLifetimeFor(definition: RustProjectTypeDefinition | undefined) {
      if (nativeLifetimes === undefined) failTargetAnalysisInvariant("tsonic-rust", "Native object lifetime contracts are required before construction lifetime selection.");
      return definition === undefined ? undefined : nativeLifetimes.get(definition);
    },
    initialize(input: Omit<RustObjectRepresentationAnalysisInput, "nativeLifetimes">) {
      if (current !== undefined) {
        failTargetAnalysisInvariant("tsonic-rust", "Rust object representation plan can be initialized only once.");
      }
      if (nativeLifetimes === undefined) failTargetAnalysisInvariant("tsonic-rust", "Object representation consumes its prepared native lifetime contracts.");
      current = createRustObjectRepresentationPlan({ ...input, nativeLifetimes });
      return current;
    },
    seal() {
      return requireCurrent();
    },
    get representations() {
      return requireCurrent().representations;
    },
    get aliases() {
      return requireCurrent().aliases;
    },
    get receiverCaptures() {
      return requireCurrent().receiverCaptures;
    },
    aliasFor(declaration: Node) {
      return requireCurrent().aliasFor(declaration);
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
  const receiverAliases = input.receiverStorage;
  const receiverCaptures = input.receiverStorage.captures;
  const { origins, escapingSuspendedMethods } = collectProjectObjectOrigins(input);
  const mutatingMethods = collectMutatingProjectMethods(input, receiverCaptures);
  const representations = input.projectTypes.definitions.map((definition) => {
    const nativeLifetime = input.nativeLifetimes.get(definition);
    if (nativeLifetime === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native object representation requires its exact original lifetime contract.", definition.declaration);
    const creationFlows = origins.get(definition) ?? [];
    const promotedStorage = creationFlows.some((flow) =>
      flow.aliasDeclarations.some(input.hasPromotedStorage));
    const mutable = promotedStorage || creationFlows.some(flow => flow.uses.some(use => use.role === "write" &&
      use.throughMember && !writesCapturedField(use.reference, input, receiverCaptures))) ||
      input.receiverStorage.publishedFieldWrites(definition).some(declaration => !receiverCaptures.isCaptured(declaration)) || projectDefinitionIsMutable(
      definition,
      mutatingMethods,
      input, receiverCaptures,
    );
    const identityObserved = creationFlows.some((flow) => flow.identityCompared);
    const escapes = creationFlows.some((flow) => flow.escapes) ||
      projectReceiverEscapes(definition, input, escapingSuspendedMethods, receiverCaptures);
    const exported = input.navigation.declarationUseSummary(
      definition.declaration,
    ).exported;
    const hasIncompleteFlow = creationFlows.some((flow) =>
      flow.hasUnclassifiedUse || flow.storedOutsideBinding ||
      flow.aliasDeclarations.some(declaration => !hasStableLocalBinding(declaration, input)));
    const aliasedMutableValue = mutable && creationFlows.some((flow) =>
      flow.bindingAliased);
    const kind = selectRustObjectRepresentationKind({
      polymorphic: input.projectTypes.isPolymorphic(definition),
      hasLocalConstructions: creationFlows.length > 0,
      localValueEligible: definition.kind === "class" || interfaceHasOnlyLocalLiteralBindings(definition, creationFlows, input),
      exported, identityObserved, escapes, hasIncompleteFlow, promotedStorage,
      referenceRequired: input.referenceDeclarations?.has(definition.declaration) === true,
      aliasedMutableValue, mutable, class: definition.kind === "class",
    });
    return Object.freeze({
      definition,
      kind,
      mutable,
      identityObserved,
      escapes,
      constructionCount: creationFlows.length,
      dispatchObjectLifetime: nativeLifetime.dispatchObjectLifetime,
    });
  });
  const byDefinition = new Map(representations.map((representation) =>
    [representation.definition, representation] as const));
  const selfModes = new Map<Node, "ref" | "mut-ref">();
  for (const definition of input.projectTypes.definitions) {
    const representation = byDefinition.get(definition);
    for (const member of sourceObjectMemberDeclarations(input.ast, definition.declaration)) {
      if (member !== undefined) selfModes.set(member,
        selectRustMethodSelfMode(representation?.kind, mutatingMethods.has(member)));
    }
  }
  return Object.freeze({
    receiverCaptures,
    aliases: receiverAliases.aliases,
    aliasFor: receiverAliases.aliasFor,
    representations: Object.freeze(representations),
    nativeLifetimeFor: (definition: RustProjectTypeDefinition | undefined) => definition === undefined ? undefined : input.nativeLifetimes.get(definition),
    representationFor(definition: RustProjectTypeDefinition | undefined) {
      return definition === undefined ? undefined : byDefinition.get(definition);
    },
    methodSelfMode: (member: Node) => selfModes.get(member) ?? "ref",
  });
}

function hasStableLocalBinding(
  declaration: Node,
  input: RustObjectRepresentationAnalysisInput,
): boolean {
  if (input.navigation.declarationUseSummary(declaration).bindingWritten) return false;
  let current = input.ast.parent(declaration);
  while (current !== undefined) {
    const kind = input.ast.kindName(current);
    if (input.ast.is.IsFunctionDeclaration(current) ||
      input.ast.is.IsFunctionExpression(current) ||
      input.ast.is.IsArrowFunction(current) ||
      input.ast.is.IsConstructorDeclaration(current) ||
      kind === "KindMethodDeclaration" ||
      kind === "KindGetAccessor" || kind === "KindSetAccessor") return true;
    current = input.ast.parent(current);
  }
  return false;
}

function projectReceiverEscapes(
  definition: RustProjectTypeDefinition,
  input: RustObjectRepresentationAnalysisInput,
  escapingSuspendedMethods: ReadonlySet<Node>,
  receiverCaptures: RustReceiverFieldCaptureQueries,
): boolean {
  let escapes = false;
  const visit = (node: Node, nestedCallable: boolean): void => {
    if (!input.isNativeNode(node)) return;
    if (escapes) return;
    const kind = input.ast.kindName(node);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      if (nestedCallable && receiverCaptures.capturesReceiver(node)) return;
      const flow = input.navigation.expressionValueFlow(node);
      escapes = nestedCallable || flow.escapes || flow.hasUnclassifiedUse || flow.identityCompared;
      return;
    }
    const nested = nestedCallable || input.ast.is.IsArrowFunction(node) ||
      input.ast.is.IsFunctionExpression(node) || input.ast.is.IsFunctionDeclaration(node);
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child, nested); });
  };
  for (const member of input.ast.members(definition.declaration)) {
    if (member !== undefined && !input.ast.hasModifierKind(member, "static")) {
      visit(member, escapingSuspendedMethods.has(member));
    }
  }
  return escapes;
}

function collectProjectObjectOrigins(input: RustObjectRepresentationAnalysisInput): {
  readonly origins: ReadonlyMap<RustProjectTypeDefinition, readonly SourceExpressionValueFlowSummary[]>;
  readonly escapingSuspendedMethods: ReadonlySet<Node>;
} {
  const origins = new Map<RustProjectTypeDefinition, SourceExpressionValueFlowSummary[]>();
  const escapingSuspendedMethods = new Set<Node>();
  const visit = (node: Node): void => {
    if (!input.isNativeNode(node)) return;
    if (input.ast.is.IsCallExpression(node)) {
      const semantics = input.semantics.forNode(node);
      const call = semantics.operations.call(node);
      const signature = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
      const selected = signature === undefined ? undefined : input.navigation.callableImplementation(signature);
      const method = selected?.kind === "resolved" ? selected.implementation.declaration : undefined;
      if (method !== undefined && input.ast.kindName(method) === "KindMethodDeclaration" &&
        !input.ast.hasModifierKind(method, "static") &&
        (input.ast.hasModifierKind(method, "async") || input.semantics.forNode(method).operations.generator(method) !== undefined) &&
        input.navigation.expressionValueFlow(node).escapes) escapingSuspendedMethods.add(method);
    }
    if (input.ast.is.IsNewExpression(node) || input.ast.is.IsObjectLiteralExpression(node)) {
      const semantics = input.semantics.forNode(node);
      const contextual = input.ast.is.IsObjectLiteralExpression(node)
        ? semantics.types.contextualValueSelection(node)
        : undefined;
      const symbol = contextual?.kind === "selected"
        ? semantics.declarations.typeSymbol(contextual.component.selectedType)
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
  return { origins, escapingSuspendedMethods };
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
  readonly semantics: SourceProgramSemantics;
}, receiverCaptures: RustReceiverFieldCaptureQueries): ReadonlySet<Node> {
  const methods = input.projectTypes.definitions.flatMap((definition) =>
    input.ast.members(definition.declaration).filter((member): member is Node =>
      member !== undefined && isInstanceCallable(member, input.ast)));
  const methodSet = new Set(methods);
  const mutating = new Set<Node>();
  for (const write of input.valueWrites) {
    if (writesCapturedField(write, input, receiverCaptures)) continue;
    const caller = enclosingProjectMethod(write, input.ast, methodSet);
    if (caller !== undefined) mutating.add(caller);
  }
  const calls = new Map<Node, Set<Node>>();
  for (const definition of input.projectTypes.definitions) {
    for (const member of sourceObjectMemberDeclarations(input.ast, definition.declaration)) {
      if (member === undefined || input.ast.hasModifierKind(member, "static")) {
        continue;
      }
      const summary = input.navigation.declarationUseSummary(member);
      for (const use of summary.uses) {
        const caller = enclosingProjectMethod(use.reference, input.ast, methodSet);
        if (caller === undefined) {
          continue;
        }
        if (use.role === "write" && !receiverCaptures.isCaptured(member)) {
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
  receiverCaptures: RustReceiverFieldCaptureQueries,
): boolean {
  return sourceObjectMemberDeclarations(input.ast, definition.declaration).some((member) =>
    member !== undefined && !input.ast.hasModifierKind(member, "static") && !receiverCaptures.isCaptured(member) &&
    (mutatingMethods.has(member) ||
      input.hasMutableStorageUse(member) ||
      input.navigation.declarationUseSummary(member).mutatedAfterInitialization));
}

function writesCapturedField(
  reference: Node, input: { readonly ast: AstReader; readonly semantics: SourceProgramSemantics },
  captures: RustReceiverFieldCaptureQueries,
): boolean {
  let current = reference;
  while (true) {
    const selection = input.ast.is.IsPropertyAccessExpression(current)
      ? input.semantics.forNode(current).operations.propertyAccess(current)
      : input.ast.is.IsElementAccessExpression(current) ? input.semantics.forNode(current).operations.elementAccess(current) : undefined;
    if (selection?.selectedDeclaration !== undefined) return captures.isCaptured(selection.selectedDeclaration);
    const parent = input.ast.parent(current);
    if (parent === undefined || Node_Expression(input.ast, parent) !== current && input.ast.name(parent) !== current) return false;
    current = parent;
  }
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
