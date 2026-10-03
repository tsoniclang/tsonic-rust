import type { Node, SourceFile } from "@tsonic/tsts";
import { forEachSourceImmediateEvaluationChild, IsTypeSyntaxNode, Node_Expression, Node_Initializer, VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList, type TargetSourceProgram } from "@tsonic/target-api/source";
import { resolveRustSourceErrorDeclaration } from "../../policy/types/external-project-types.js";
import type { RustSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { rustSourceErrorConstructors } from "../../target-model/identities/source-errors.js";
import { createRustErrorExecutionRegions } from "./error-execution-regions.js";
import { createRustErrorStorageSubjects, type RustErrorStorageSubject } from "./error-storage-subjects.js";
import { createRustErrorInvalidationBindings, type RustErrorInvalidationBindings } from "./error-invalidation-bindings.js";

export type RustErrorStorageDemand =
  | { readonly kind: "immutable" }
  | { readonly kind: "writable"; readonly writes: readonly Node[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustErrorStorageDemandQueries {
  readonly nativeConstructors: readonly Node[];
  readonly fieldWrites: readonly Node[];
  storageFor(subject: Node): RustErrorStorageDemand;
  receivesWritableNative(subject: Node): boolean;
  storageOriginsFor(subject: Node): { readonly kind: "resolved"; readonly origins: readonly Node[] }
    | { readonly kind: "unresolved"; readonly reason: string };
  invalidationFor(owner: Node, expression: Node, pureInvocations: ReadonlySet<Node>):
    { readonly kind: "preserved" | "invalidated" } | { readonly kind: "unresolved"; readonly reason: string };
}

const immutableDemand: RustErrorStorageDemand = Object.freeze({ kind: "immutable" });
const maximumDemandNodes = 1_048_576;
const maximumDemandEdges = 262_144;
const maximumDemandRows = 1_048_576;
const maximumDemandSteps = 4_194_304;

export function createRustErrorStorageDemandQuery(
  source: TargetSourceProgram,
  profiles: RustSourceProfileRegistry,
  sourceFiles: readonly SourceFile[],
): RustErrorStorageDemandQueries {
  const { ast, navigation, semantics } = source;
  const fields = new Set<Node>();
  const constructors = new Set<Node>();
  for (const file of source.sourceFiles) {
    for (const statement of ast.statements(file)) {
      if (statement === undefined || profiles.profileForNode(statement, ast) === undefined) continue;
      if (ast.is.IsInterfaceDeclaration(statement) && rustSourceErrorConstructors.some(constructor =>
        constructor.ownerName === ast.text(ast.name(statement)))) {
        for (const member of ast.members(statement)) {
          if (member !== undefined && (ast.is.IsConstructSignatureDeclaration(member) || ast.is.IsCallSignatureDeclaration(member))) constructors.add(member);
        }
      }
      for (const declaration of VariableDeclarationList_Declarations(ast,
        VariableStatement_DeclarationList(ast, statement)) ?? []) {
        if (declaration === undefined) continue;
        const root = resolveRustSourceErrorDeclaration(declaration, ast, profiles);
        if (root === undefined) continue;
        for (const field of root.fields) fields.add(field.declaration);
        for (const declaration of root.constructorDeclarations) constructors.add(declaration);
      }
    }
  }
  const subject = createRustErrorStorageSubjects();
  const incoming = new Map<RustErrorStorageSubject, Set<RustErrorStorageSubject>>();
  const subjects = new Map<Node, RustErrorStorageSubject>();
  const mutationOwners = new Map<Node, RustErrorStorageSubject>();
  const invocations = new Set<Node>();
  const invocationTargets = new Map<Node, RustErrorStorageSubject>();
  const invocationArguments = new Map<Node, readonly Node[]>();
  const accessorTargets = new Map<Node, readonly Node[]>();
  const memberImplementations = new Map<Node, Set<Node>>();
  const capturedStackTargets = new Map<Node, RustErrorStorageSubject>();
  const writes = new Map<RustErrorStorageSubject, Set<Node>>();
  const nativeConstructors: Node[] = [];
  const fieldWrites: Node[] = [];
  const thrownOrigins = new Map<Node, Set<RustErrorStorageSubject>>();
  const unresolvedSubjects = new Map<RustErrorStorageSubject, string>();
  let visitedNodes = 0;
  let edgeCount = 0;
  let demandRows = 0;
  let steps = 0;
  let failure: string | undefined;

  const step = (): boolean => {
    if (++steps > maximumDemandSteps) {
      failure = "Error storage demand exceeds its finite analysis-work budget.";
      return false;
    }
    return failure === undefined;
  };

  const enclosingCallable = (node: Node): Node | undefined => {
    for (let current = ast.parent(node); current !== undefined && step(); current = ast.parent(current)) {
      if (ast.is.IsFunctionDeclaration(current) || ast.is.IsFunctionExpression(current) ||
        ast.is.IsArrowFunction(current) || ast.is.IsMethodDeclaration(current) ||
        ast.is.IsGetAccessorDeclaration(current) || ast.is.IsSetAccessorDeclaration(current) ||
        ast.is.IsConstructorDeclaration(current)) return current;
    }
    return undefined;
  };
  const receiverFor = (node: Node): RustErrorStorageSubject | undefined => {
    for (let parent = ast.parent(node); parent !== undefined && step(); parent = ast.parent(parent)) {
      if (ast.is.IsClassDeclaration(parent) || ast.is.IsClassExpression(parent)) return subject(parent, "receiver");
      if (ast.is.IsFunctionDeclaration(parent) || ast.is.IsFunctionExpression(parent) ||
        ast.is.IsMethodDeclaration(parent) || ast.is.IsConstructorDeclaration(parent) ||
        ast.is.IsGetAccessorDeclaration(parent) || ast.is.IsSetAccessorDeclaration(parent)) return subject(parent, "receiver");
    }
    return undefined;
  };
  const catchDestination = (node: Node): Node | undefined => {
    let child = node;
    for (let parent = ast.parent(node); parent !== undefined && step(); child = parent, parent = ast.parent(parent)) {
      if (ast.is.IsFunctionDeclaration(parent) || ast.is.IsFunctionExpression(parent) || ast.is.IsArrowFunction(parent) ||
        ast.is.IsMethodDeclaration(parent) || ast.is.IsConstructorDeclaration(parent) ||
        ast.is.IsGetAccessorDeclaration(parent) || ast.is.IsSetAccessorDeclaration(parent)) return undefined;
      const selected = ast.as.AsTryStatement(parent);
      if (selected !== undefined && selected.TryBlock === child) {
        const caught = selected.CatchClause === undefined ? undefined : ast.as.AsCatchClause(selected.CatchClause)?.VariableDeclaration;
        if (caught !== undefined) return caught;
      }
    }
    return undefined;
  };
  const subjectFor = (node: Node | undefined): RustErrorStorageSubject | undefined => {
    if (node === undefined) return undefined;
    const original = node;
    while (step()) {
      const cached = subjects.get(node);
      if (cached !== undefined) return cached;
      if (!ast.is.IsParenthesizedExpression(node) && !ast.is.IsAsExpression(node) &&
        !ast.is.IsSatisfiesExpression(node) && !ast.is.IsNonNullExpression(node) && !ast.is.IsTypeAssertion(node)) break;
      const expression = Node_Expression(ast, node);
      if (expression === undefined) return undefined;
      node = expression;
    }
    if (failure !== undefined) return undefined;
    if (ast.kindName(node) === "KindThisKeyword") {
      const receiver = receiverFor(node);
      if (receiver !== undefined) subjects.set(node, receiver);
      return receiver;
    }
    const selected = ast.is.IsElementAccessExpression(node) || ast.is.IsCallExpression(node) ? node
      : ast.is.IsPropertyAccessExpression(node)
        ? semantics.forNode(node).operations.propertyAccess(node)?.selectedReadDeclaration
          ?? semantics.forNode(node).operations.propertyAccess(node)?.selectedDeclaration
      : navigation.sourceReferenceFor(node)?.declaration;
    const target = selected !== undefined && !ast.is.IsGetAccessorDeclaration(selected) ? selected : node;
    const value = subject(target)!;
    subjects.set(node, value);
    subjects.set(original, value);
    return value;
  };
  const connect = (origin: RustErrorStorageSubject | undefined, destination: RustErrorStorageSubject | undefined): void => {
    if (origin === undefined || destination === undefined || origin === destination || failure !== undefined) return;
    const origins = incoming.get(destination) ?? new Set<RustErrorStorageSubject>();
    if (origins.has(origin)) return;
    if (++edgeCount > maximumDemandEdges) {
      failure = "Error storage transport exceeds its finite edge budget.";
      return;
    }
    origins.add(origin);
    incoming.set(destination, origins);
  };
  const recordWrite = (subject: RustErrorStorageSubject | undefined, write: Node): void => {
    if (subject === undefined) {
      failure = "An admitted Error write has no exact source storage subject.";
      return;
    }
    const selected = writes.get(subject) ?? new Set<Node>();
    selected.add(write);
    writes.set(subject, selected);
    fieldWrites.push(write);
    if (++demandRows > maximumDemandRows) failure = "Error storage demand exceeds its finite selected-write budget.";
    if (ast.is.IsElementAccessExpression(subject.node) || ast.is.IsBindingElement(subject.node)) {
      unresolvedSubjects.set(subject, "An admitted Error write has no exact selected scalar storage transport.");
    }
  };
  const connectValueFlow = (expression: Node | undefined): void => {
    if (expression === undefined) return;
    const subject = subjectFor(expression);
    for (const declaration of navigation.expressionValueFlow(expression).aliasDeclarations) {
      if (!step()) return;
      connect(subject, subjectFor(declaration));
    }
  };
  const visit = (node: Node): void => {
    if (failure !== undefined) return;
    if (++visitedNodes > maximumDemandNodes) {
      failure = "Error storage demand exceeds its finite source-node budget.";
      return;
    }
    if (ast.is.IsIdentifier(node) || ast.is.IsVariableDeclaration(node) || ast.is.IsParameterDeclaration(node) ||
      ast.is.IsPropertyDeclaration(node) || ast.is.IsFunctionDeclaration(node) || ast.is.IsArrowFunction(node)) subjectFor(node);
    if ((ast.is.IsMethodDeclaration(node) || ast.is.IsGetAccessorDeclaration(node) ||
      ast.is.IsSetAccessorDeclaration(node)) && ast.body(node) !== undefined) {
      const contracts = navigation.memberContracts(node);
      if (contracts.kind === "resolved") {
        for (const contract of contracts.contracts) {
          if (!step()) return;
          const implementations = memberImplementations.get(contract) ?? new Set<Node>();
          implementations.add(node);
          memberImplementations.set(contract, implementations);
        }
      }
    }
    if (ast.is.IsVariableDeclaration(node)) {
      connectValueFlow(Node_Initializer(ast, node));
    }
    if (ast.is.IsPropertyDeclaration(node) || ast.is.IsParameterDeclaration(node)) {
      connect(subjectFor(Node_Initializer(ast, node)), subject(node));
    }
    if (ast.is.IsArrowFunction(node)) {
      const body = ast.as.AsArrowFunction(node)?.Body;
      if (body !== undefined && !ast.is.IsBlock(body)) connect(subjectFor(body), subject(node, "return"));
    }
    if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindEqualsToken") {
      const binary = ast.as.AsBinaryExpression(node);
      connectValueFlow(binary?.Right);
      if (binary?.Left !== undefined && !ast.is.IsIdentifier(binary.Left)) {
        connect(subjectFor(binary.Right), subjectFor(binary.Left));
      }
    }
    if (ast.is.IsPropertyAccessExpression(node)) {
      const selected = semantics.forNode(node).operations.propertyAccess(node);
      const declaration = selected?.selectedWriteDeclaration ?? selected?.selectedDeclaration;
      const targets = [
        ...(selected?.accessMode === "write" ? [] : [selected?.selectedReadDeclaration ?? selected?.selectedDeclaration]),
        ...(selected?.accessMode === "read" ? [] : [selected?.selectedWriteDeclaration ?? selected?.selectedDeclaration]),
      ].filter((target): target is Node => target !== undefined &&
        (ast.is.IsGetAccessorDeclaration(target) || ast.is.IsSetAccessorDeclaration(target)));
      if (targets.length !== 0) accessorTargets.set(node, Object.freeze(targets));
      if (selected !== undefined && selected.accessMode !== "read") {
        const owner = subjectFor(selected.receiver.expression);
        if (owner !== undefined) mutationOwners.set(node, owner);
      }
      if (selected !== undefined && selected.accessMode !== "read" && declaration !== undefined && fields.has(declaration)) {
        recordWrite(subjectFor(selected.receiver.expression), node);
      }
    }
    if (ast.is.IsReturnStatement(node)) {
      connect(subjectFor(Node_Expression(ast, node)), subject(enclosingCallable(node), "return"));
    }
    if (ast.is.IsThrowStatement(node)) {
      const origin = subjectFor(Node_Expression(ast, node));
      const caught = catchDestination(node);
      if (caught !== undefined) connect(origin, subject(caught));
      else {
        const region = regions.enclosing(node);
        if (region !== undefined && origin !== undefined) {
          const origins = thrownOrigins.get(region) ?? new Set<RustErrorStorageSubject>();
          origins.add(origin);
          thrownOrigins.set(region, origins);
        }
      }
    }
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
      invocations.add(node);
      const selected = semantics.forNode(node).operations.call(node);
      const signature = selected === undefined ? undefined
        : semantics.forNode(node).declarations.signatureDeclaration(selected.selectedSignature);
      if (selected !== undefined && signature !== undefined) {
        const implementation = navigation.callableImplementation(signature);
        const callee = Node_Expression(ast, node);
        const target = implementation.kind === "resolved" && ast.body(implementation.implementation.declaration) !== undefined
          ? subject(implementation.implementation.declaration) : subjectFor(callee);
        if (target !== undefined) invocationTargets.set(node, target);
        invocationArguments.set(node, Object.freeze([
          ...selected.sourceArguments.map(argument => argument.expression),
          ...(selected.sourceReceiver === undefined ? [] : [selected.sourceReceiver.expression]),
        ]));
        const signatureOwner = ast.parent(signature);
        if (profiles.profileForNode(signature, ast) !== undefined && signatureOwner !== undefined &&
          ast.is.IsInterfaceDeclaration(signatureOwner) && ast.text(ast.name(signatureOwner)) === "ErrorConstructor" &&
          ast.text(ast.name(signature)) === "captureStackTrace" && selected.sourceArguments.length === 1) {
          const owner = subjectFor(selected.sourceArguments[0]!.expression);
          if (owner !== undefined) capturedStackTargets.set(node, owner);
        }
        if (constructors.has(signature) && ast.kindName(callee) !== "KindSuperKeyword") {
          nativeConstructors.push(node);
          connectValueFlow(node);
        }
      }
    }
  };
  const regions = createRustErrorExecutionRegions(source, step);
  const nodes: Node[] = [...sourceFiles];
  while (nodes.length !== 0 && failure === undefined) {
    const node = nodes.pop()!;
    visit(node);
    const children: Node[] = [];
    ast.forEachChild(node, child => { if (child !== undefined) children.push(child); });
    nodes.push(...children.reverse());
  }
  const ancestorSubjects = (selected: RustErrorStorageSubject): ReadonlySet<RustErrorStorageSubject> | undefined => {
    const pending = [selected];
    const visited = new Set<RustErrorStorageSubject>();
    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index]!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (!step()) return undefined;
      pending.push(...incoming.get(current) ?? []);
    }
    return visited;
  };
  const implementationsFor = (declaration: Node, invocation: Node,
    originsFor = ancestorSubjects): ReadonlySet<Node> => {
    const selected = new Set<Node>();
    const implementation = navigation.callableImplementation(declaration);
    if (implementation.kind === "resolved") selected.add(implementation.implementation.declaration);
    if (ast.hasModifierKind(declaration, "static") || ast.hasModifierKind(declaration, "private") ||
      !ast.is.IsMethodDeclaration(declaration) && ast.kindName(declaration) !== "KindMethodSignature" &&
      !ast.is.IsGetAccessorDeclaration(declaration) && !ast.is.IsSetAccessorDeclaration(declaration)) return selected;
    const call = semantics.forNode(invocation).operations.call(invocation);
    const receiver = call?.sourceReceiver?.expression ?? call?.sourceCalleeAccess?.receiver.expression
      ?? semantics.forNode(invocation).operations.propertyAccess(invocation)?.receiver.expression;
    if (ast.kindName(receiver) === "KindSuperKeyword") return selected;
    const receiverSubject = subjectFor(receiver);
    const origins = receiverSubject === undefined ? undefined : originsFor(receiverSubject);
    const exact = new Set<Node>();
    let complete = origins !== undefined && origins.size !== 0;
    for (const origin of origins ?? []) {
      if (!step()) return selected;
      if (ast.is.IsParameterDeclaration(origin.node)) complete = false;
      if ((incoming.get(origin)?.size ?? 0) !== 0) continue;
      const callee = ast.is.IsNewExpression(origin.node) ? Node_Expression(ast, origin.node) : undefined;
      const concrete = callee === undefined ? undefined : navigation.sourceReferenceFor(callee)?.declaration;
      const target = concrete === undefined ? undefined : navigation.memberImplementation(concrete, declaration);
      if (target?.kind === "resolved") exact.add(target.implementation.declaration);
      else complete = false;
    }
    if (complete && exact.size !== 0) return exact;
    for (const target of memberImplementations.get(declaration) ?? []) {
      if (!step()) break;
      selected.add(target);
    }
    return selected;
  };
  const invocationImplementations = (invocation: Node, originsFor = ancestorSubjects): ReadonlySet<Node> => {
    const implementations = new Set<Node>();
    const target = invocationTargets.get(invocation);
    for (const candidate of target === undefined ? [] : originsFor(target) ?? []) {
      if (!step()) break;
      if (candidate.kind !== "value") continue;
      for (const implementation of implementationsFor(candidate.node, invocation, originsFor)) implementations.add(implementation);
    }
    for (const accessor of accessorTargets.get(invocation) ?? []) {
      for (const implementation of implementationsFor(accessor, invocation, originsFor)) implementations.add(implementation);
    }
    return implementations;
  };
  const invocationOrigins = (origin: RustErrorStorageSubject, candidate: Node, invocation: Node): ReadonlySet<RustErrorStorageSubject> => {
    const origins = new Set<RustErrorStorageSubject>();
    const pending = [origin];
    const visited = new Set<RustErrorStorageSubject>();
    const selected = semantics.forNode(invocation).operations.call(invocation);
    while (pending.length !== 0 && step()) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (current.kind === "value" && ast.is.IsParameterDeclaration(current.node)) {
        const index = ast.parameters(candidate).indexOf(current.node);
        if (index === -1) origins.add(current);
        else {
          const bindings = selected?.sourceArgumentBindings.filter(binding => binding.sourceParameterIndex === index) ?? [];
          for (const binding of bindings) {
            const argument = subjectFor(selected?.sourceArguments[binding.sourceArgumentIndex]?.expression);
            if (argument !== undefined) origins.add(argument);
          }
          if (bindings.length === 0) {
            const access = accessorTargets.has(invocation) ? ast.parent(invocation) : undefined;
            const assignment = access === undefined ? undefined : ast.as.AsBinaryExpression(access);
            const argument = subjectFor(assignment?.Left === invocation && ast.operatorKindName(access) === "KindEqualsToken"
              ? assignment.Right : Node_Initializer(ast, current.node));
            origins.add(argument ?? current);
          }
        }
      } else if (current.kind === "receiver") {
        const receiver = current.node !== candidate ? current : ast.is.IsNewExpression(invocation) ? subject(invocation)
          : subjectFor(selected?.sourceReceiver?.expression ?? selected?.sourceCalleeAccess?.receiver.expression
            ?? semantics.forNode(invocation).operations.propertyAccess(invocation)?.receiver.expression);
        if (receiver !== undefined) origins.add(receiver);
      } else {
        const incomingOrigins = incoming.get(current);
        if (incomingOrigins === undefined || incomingOrigins.size === 0) origins.add(current);
        else pending.push(...incomingOrigins);
      }
    }
    return origins;
  };
  if (failure === undefined) {
    let previousEdges = -1;
    while (previousEdges !== edgeCount && step()) {
      previousEdges = edgeCount;
      for (const invocation of invocationTargets.keys()) {
        for (const candidate of invocationImplementations(invocation)) {
          if (ast.is.IsCallExpression(invocation)) connect(subject(candidate, "return"), subject(invocation));
          const selected = semantics.forNode(invocation).operations.call(invocation);
          connect(ast.is.IsNewExpression(invocation) ? subject(invocation)
            : subjectFor(selected?.sourceReceiver?.expression ?? selected?.sourceCalleeAccess?.receiver.expression),
          subject(candidate, "receiver"));
          for (const binding of selected?.sourceArgumentBindings ?? []) {
            if (!step()) break;
            if (binding.sourceForm !== "value" || binding.sourceParameterForm !== "parameter") continue;
            const parameter = ast.parameters(candidate)[binding.sourceParameterIndex];
            const contract = selected?.sourceSelectedSignatureParameters.find(parameter =>
              parameter.parameterIndex === binding.sourceParameterIndex)?.parameterDeclaration;
            connect(subjectFor(selected?.sourceArguments[binding.sourceArgumentIndex]?.expression), subject(parameter));
            connect(subject(contract), subject(parameter));
          }
        }
      }
      for (const [access, accessors] of accessorTargets) {
        for (const accessor of accessors) {
          for (const candidate of implementationsFor(accessor, access)) {
            const receiver = semantics.forNode(access).operations.propertyAccess(access)?.receiver.expression;
            connect(subjectFor(receiver), subject(candidate, "receiver"));
            if (ast.is.IsGetAccessorDeclaration(accessor)) connect(subject(candidate, "return"), subjectFor(access));
            else {
              const parent = ast.parent(access);
              const assignment = parent === undefined ? undefined : ast.as.AsBinaryExpression(parent);
              if (assignment?.Left === access && ast.operatorKindName(parent) === "KindEqualsToken") {
                connect(subjectFor(assignment.Right), subject(ast.parameters(candidate)[0]));
              }
            }
          }
        }
      }
    }
    let previousRows = -1;
    while (previousRows !== demandRows && step()) {
      previousRows = demandRows;
      for (const invocation of new Set([...invocations, ...accessorTargets.keys()])) {
        const destination = catchDestination(invocation);
        const enclosing = destination === undefined ? regions.enclosing(invocation) : undefined;
        const targets = [...invocationImplementations(invocation)].map(candidate => ({ candidate,
          regions: regions.callable(candidate, accessorTargets.has(invocation) ? undefined : invocation) }));
        if (ast.is.IsNewExpression(invocation)) {
          for (const region of regions.instance(invocation)) targets.push({ candidate: region.owner, regions: [region.node] });
        }
        for (const target of targets) {
          for (const region of target.regions) {
            for (const origin of thrownOrigins.get(region) ?? []) {
              for (const actual of invocationOrigins(origin, target.candidate, invocation)) {
                if (destination !== undefined) connect(actual, subject(destination));
                else if (enclosing !== undefined) {
                  const origins = thrownOrigins.get(enclosing) ?? new Set<RustErrorStorageSubject>();
                  if (!origins.has(actual)) {
                    origins.add(actual);
                    if (++demandRows > maximumDemandRows) failure = "Error throw transport exceeds its finite row budget.";
                  }
                  thrownOrigins.set(enclosing, origins);
                }
              }
            }
          }
        }
      }
    }
    const pending = [...writes.keys()];
    const queued = new Set(pending);
    for (let index = 0; index < pending.length && failure === undefined; index += 1) {
      const destination = pending[index]!;
      queued.delete(destination);
      const destinationWrites = writes.get(destination)!;
      for (const origin of incoming.get(destination) ?? []) {
        const originWrites = writes.get(origin) ?? new Set<Node>();
        const previous = originWrites.size;
        for (const write of destinationWrites) {
          if (!step()) break;
          if (originWrites.has(write)) continue;
          if (++demandRows > maximumDemandRows) {
            failure = "Error storage demand exceeds its finite transported-write budget.";
            break;
          }
          originWrites.add(write);
        }
        writes.set(origin, originWrites);
        if (originWrites.size !== previous && !queued.has(origin)) {
          queued.add(origin);
          pending.push(origin);
        }
      }
    }
  }
  const selections = new Map<RustErrorStorageSubject, RustErrorStorageDemand>();
  const storageSubject = (node: Node): RustErrorStorageSubject | undefined => {
    for (let remaining = 2_048; IsTypeSyntaxNode(ast, node); remaining -= 1) {
      if (remaining === 0) return undefined;
      const parent = ast.parent(node);
      if (parent === undefined) break;
      node = parent;
    }
    return ast.body(node) === undefined ? subjects.get(node) ?? subject(node) : subject(node, "return");
  };
  const storageFor = (subject: Node): RustErrorStorageDemand => {
    if (failure !== undefined) return Object.freeze({ kind: "unresolved", reason: failure });
    const node = storageSubject(subject);
    if (node === undefined) return Object.freeze({ kind: "unresolved", reason: "Error storage type ancestry exceeds its finite owner-query budget." });
    const unresolved = unresolvedSubjects.get(node);
    if (unresolved !== undefined) return Object.freeze({ kind: "unresolved", reason: unresolved });
    const cached = selections.get(node);
    if (cached !== undefined) return cached;
    const selected = writes.get(node);
    const demand = selected === undefined || selected.size === 0 ? immutableDemand
      : Object.freeze({ kind: "writable" as const, writes: Object.freeze([...selected]) });
    selections.set(node, demand);
    return demand;
  };
  const nativeSubjects = new Set(nativeConstructors.map(node => subject(node)!));
  const receivesWritableNative = (subject: Node): boolean => {
    const selected = storageSubject(subject);
    if (selected === undefined || failure !== undefined) return false;
    const pending = [selected];
    const visited = new Set<RustErrorStorageSubject>();
    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index]!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (!step()) return false;
      if (nativeSubjects.has(current) && storageFor(current.node).kind === "writable") return true;
      pending.push(...incoming.get(current) ?? []);
    }
    return false;
  };
  const ancestors = (subject: Node): ReadonlySet<RustErrorStorageSubject> | undefined => {
    const selected = storageSubject(subject);
    return selected === undefined ? undefined : ancestorSubjects(selected);
  };
  const invalidationFor: RustErrorStorageDemandQueries["invalidationFor"] = (owner, expression, pureInvocations) => {
    const sourceOwners = ancestors(owner);
    if (sourceOwners === undefined || failure !== undefined) return Object.freeze({ kind: "unresolved",
      reason: failure ?? "A borrowed Error field has no exact source storage owner." });
    const bindingQuery = createRustErrorInvalidationBindings(source, step, subject, incoming, invocationOrigins);
    const pending = [{ node: expression, bindings: bindingQuery.empty }];
    const visited = new Map<RustErrorInvalidationBindings, Set<Node>>();
    let unresolved: string | undefined;
    const appendCallableRegions = (candidate: Node, invocation: Node | undefined, parent: RustErrorInvalidationBindings): boolean => {
      const selected = regions.callable(candidate, invocation);
      const bindings = invocation === undefined ? parent : bindingQuery.forInvocation(candidate, invocation, parent);
      pending.push(...selected.map(node => ({ node, bindings })));
      return selected.length !== 0;
    };
    while (pending.length !== 0) {
      const { node, bindings } = pending.pop()!;
      const checked = visited.get(bindings) ?? new Set<Node>();
      if (checked.has(node)) continue;
      checked.add(node);
      visited.set(bindings, checked);
      if (!step()) return Object.freeze({ kind: "unresolved", reason: failure! });
      if (ast.is.IsAwaitExpression(node) || ast.is.IsYieldExpression(node)) return Object.freeze({ kind: "invalidated" });
      const mutation = mutationOwners.get(node) ?? capturedStackTargets.get(node);
      if (mutation !== undefined) {
        const affected = bindingQuery.origins(mutation, bindings);
        if ([...affected].some(subject => sourceOwners.has(subject))) return Object.freeze({ kind: "invalidated" });
      }
      if (accessorTargets.has(node)) {
        const implementations = invocationImplementations(node, origin => bindingQuery.origins(origin, bindings));
        if (implementations.size === 0) unresolved = "An accessor invocation has no exact source mutation footprint.";
        for (const implementation of implementations) appendCallableRegions(implementation, node, bindings);
      }
      if ((ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) && !pureInvocations.has(node) &&
        !nativeSubjects.has(subject(node)!) && !capturedStackTargets.has(node)) {
        let resolved = false;
        for (const candidate of invocationImplementations(node, origin => bindingQuery.origins(origin, bindings))) {
          resolved = appendCallableRegions(candidate, node, bindings) || resolved;
        }
        if (ast.is.IsNewExpression(node)) {
          for (const region of regions.instance(node)) pending.push({ node: region.node,
            bindings: bindingQuery.forInvocation(region.owner, node, bindings) });
        }
        if (!resolved) {
          for (const argument of invocationArguments.get(node) ?? []) {
            const argumentSubject = subjectFor(argument);
            const origins = argumentSubject === undefined ? undefined : bindingQuery.origins(argumentSubject, bindings);
            if (origins === undefined) { unresolved = "An opaque invocation has unresolved Error backing."; continue; }
            if ([...origins].some(subject => sourceOwners.has(subject))) unresolved = "An opaque native invocation can access the borrowed Error owner without an exact mutation footprint.";
            for (const candidate of origins) {
              if (candidate.kind === "value") appendCallableRegions(candidate.node, undefined, bindings);
            }
          }
        }
      }
      forEachSourceImmediateEvaluationChild(ast, node, child => pending.push({ node: child, bindings }));
    }
    const reason = failure ?? unresolved;
    return reason === undefined ? Object.freeze({ kind: "preserved" }) : Object.freeze({ kind: "unresolved", reason });
  };
  const storageOriginsFor: RustErrorStorageDemandQueries["storageOriginsFor"] = subject => {
    const selected = ancestors(subject);
    if (selected === undefined || failure !== undefined) return Object.freeze({ kind: "unresolved",
      reason: failure ?? "An Error admission has no exact originating storage subject." });
    const origins = [...new Set([...selected].filter(node => (incoming.get(node)?.size ?? 0) === 0).map(subject => subject.node))];
    return origins.length === 0 ? Object.freeze({ kind: "unresolved", reason: "An Error storage cycle has no proven original physical owner." })
      : Object.freeze({ kind: "resolved", origins: Object.freeze(origins) });
  };
  return Object.freeze({ nativeConstructors: Object.freeze(nativeConstructors),
    fieldWrites: Object.freeze(fieldWrites), storageFor, receivesWritableNative, storageOriginsFor, invalidationFor });
}
