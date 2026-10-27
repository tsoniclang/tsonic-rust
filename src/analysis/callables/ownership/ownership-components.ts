import type { Node, Type } from "@tsonic/tsts";
import { targetStronglyConnectedComponents, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Expression, Node_Initializer, sourceBindingScope, sourceEnclosingCallable, sourceLexicalEnvironment, sourceParameterIsProperty, type SourceDeclarationUse } from "@tsonic/target-api/source";
import type { RustReceiverFieldCaptureQueries } from "../../project-types/receiver-captures.js";

export interface RustCallableOwnershipLimits {
  readonly maximumNodes: number;
  readonly maximumEdges: number;
  readonly maximumSteps: number;
}

export const defaultRustCallableOwnershipLimits: RustCallableOwnershipLimits = Object.freeze({
  maximumNodes: 1_048_576, maximumEdges: 1_048_576, maximumSteps: 4_194_304,
});

import type { RustCallableOwnershipCapture, RustCallableOwnershipReceiverRelation, RustCallableOwnershipComponent } from "../../../target-model/records/callable-ownership.js";

import type { RustCallableOwnershipIssue, RustCallableOwnershipComponentQueries } from "../../../target-model/records/callable-ownership.js";
import { sealRustCallableOwnershipComponents } from "../../program/records/callable-ownership.js";

type Vertex = { readonly kind: "callable" | "slot"; readonly declaration: Node };
type Owner = { readonly kind: "lexical" | "class"; readonly declaration: Node; readonly scope: Node };

export function createRustCallableOwnershipComponentQueries(input: {
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly receiverCaptures: RustReceiverFieldCaptureQueries;
  readonly isRuntimeUse?: (use: SourceDeclarationUse, declaration: Node) => boolean;
  readonly limits?: RustCallableOwnershipLimits;
}): RustCallableOwnershipComponentQueries {
  const { storage, receiverCaptures } = input;
  const { ast, navigation, semantics } = storage.source;
  const limits = { ...defaultRustCallableOwnershipLimits };
  let failure: string | undefined;
  let steps = 0;
  let edges = 0;
  const issues: RustCallableOwnershipIssue[] = [];
  const problems = new Map<Node, string>();
  const vertices = new Set<Vertex>();
  const callables = new Map<Node, Vertex>();
  const slots = new Map<Node, Vertex>();
  const neighbours = new Map<Vertex, Set<Vertex>>();
  const captures = new Map<Node, RustCallableOwnershipCapture[]>();
  const relations = new Map<Node, RustCallableOwnershipReceiverRelation[]>();
  const receiverOwners = new Map<Node, Node>();
  const supplied = new Map<Node, Set<Node>>();
  const canonicalSlots = new Map<Node, Node>();
  const writes = new Map<Node, Node[]>();
  const sourceNodes = new Set<Node>();
  const callableComponents = new Map<Node, RustCallableOwnershipComponent>();
  const slotComponents = new Map<Node, RustCallableOwnershipComponent>();
  const components: RustCallableOwnershipComponent[] = [];
  const cyclicCallables = new Set<Node>();
  const cyclicSlots = new Set<Node>();
  const independentCallables = new Set<Node>();
  const reject = (reason: string): void => { failure ??= reason; };
  const account = (cost = 1): boolean => {
    if (failure !== undefined) return false;
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > limits.maximumSteps - steps)
      reject("Rust callable ownership analysis exceeds its finite work budget.");
    else steps += cost;
    return failure === undefined;
  };
  const boundedAst: typeof ast = { ...ast,
    parent: node => account() ? ast.parent(node) : undefined,
    forEachChild: (node, visit) => {
      if (account()) ast.forEachChild(node, child => { if (child !== undefined && account()) visit(child); });
    },
  };
  const issue = (node: Node, reason: string): void => {
    if (!account() || problems.has(node)) return;
    problems.set(node, reason);
    issues.push(Object.freeze({ node, reason }));
  };
  if (input.limits !== undefined) {
    const keys = Object.keys(defaultRustCallableOwnershipLimits) as (keyof RustCallableOwnershipLimits)[];
    if (input.limits === null || typeof input.limits !== "object" ||
      Reflect.ownKeys(input.limits).length !== keys.length) reject("Rust callable ownership limits require exact finite data fields.");
    else for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input.limits, key);
      const value: unknown = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 ||
        value > defaultRustCallableOwnershipLimits[key]) {
        reject("Rust callable ownership limits must be positive finite integers within the bounded defaults.");
        break;
      }
      limits[key] = value;
    }
  }
  const storageFailure = storage.failureReason();
  if (storageFailure !== undefined) reject(storageFailure);
  if (failure === undefined && receiverCaptures.issues.length !== 0) {
    for (const current of receiverCaptures.issues) issue(current.node, current.reason);
    reject("Rust callable ownership requires a complete checked receiver-capture query.");
  }
  if (failure !== undefined) return result();
  for (const node of storage.nodes) {
    if (!account() || sourceNodes.size >= limits.maximumNodes) {
      reject("Rust callable ownership analysis exceeds its finite source-node budget.");
      return result();
    }
    sourceNodes.add(node);
  }
  const vertex = (kind: Vertex["kind"], declaration: Node): Vertex | undefined => {
    const indexed = kind === "callable" ? callables : slots;
    const previous = indexed.get(declaration);
    if (previous !== undefined) return previous;
    if (!account() || vertices.size >= limits.maximumNodes) {
      reject("Rust callable ownership analysis exceeds its finite graph-node budget.");
      return undefined;
    }
    const selected = Object.freeze({ kind, declaration });
    indexed.set(declaration, selected);
    vertices.add(selected);
    return selected;
  };
  const connect = (graph: Map<Vertex, Set<Vertex>>, from: Vertex, to: Vertex): void => {
    if (!account()) return;
    const selected = graph.get(from) ?? new Set<Vertex>();
    if (selected.has(to)) return;
    if (edges >= limits.maximumEdges) {
      reject("Rust callable ownership analysis exceeds its finite edge budget.");
      return;
    }
    edges += 1;
    selected.add(to);
    graph.set(from, selected);
  };
  const isCallable = (node: Node): boolean => ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node) ||
    ast.is.IsFunctionDeclaration(node) && sourceEnclosingCallable(ast.parent(node), boundedAst) !== undefined;
  const isField = (node: Node): boolean => ast.is.IsPropertyDeclaration(node) || sourceParameterIsProperty(boundedAst, node);
  const canonical = (node: Node): Node => {
    if (!isField(node)) return node;
    let selected = canonicalSlots.get(node);
    if (selected === undefined) {
      selected = receiverCaptures.storageDeclaration(node);
      canonicalSlots.set(node, selected);
    }
    return selected;
  };
  const classOwner = (node: Node): Node | undefined => {
    for (let parent = ast.parent(node); parent !== undefined && account(); parent = ast.parent(parent))
      if (ast.is.IsClassDeclaration(parent) || ast.is.IsClassExpression(parent)) return parent;
    return undefined;
  };
  const unwrap = (expression: Node | undefined): Node | undefined => {
    let current = expression;
    while (current !== undefined && account() && (ast.is.IsParenthesizedExpression(current) ||
      ast.is.IsAsExpression(current) || ast.is.IsSatisfiesExpression(current) ||
      ast.is.IsNonNullExpression(current) || ast.is.IsTypeAssertion(current))) current = Node_Expression(ast, current);
    return current;
  };
  const receiverOwner = (receiver: Node): Node | undefined => {
    if (ast.kindName(receiver) !== "KindThisKeyword") return undefined;
    for (let parent = ast.parent(receiver); parent !== undefined && account(); parent = ast.parent(parent)) {
      if (ast.is.IsFunctionDeclaration(parent) || ast.is.IsFunctionExpression(parent)) return undefined;
      if (ast.kindName(parent) === "KindClassStaticBlockDeclaration" || ast.hasModifierKind(parent, "static")) return undefined;
      if (ast.is.IsClassDeclaration(parent) || ast.is.IsClassExpression(parent)) return parent;
    }
    return undefined;
  };
  const accessInfo = (node: Node) => ast.is.IsPropertyAccessExpression(node)
    ? semantics.forNode(node).operations.propertyAccess(node)
    : ast.is.IsElementAccessExpression(node) ? semantics.forNode(node).operations.elementAccess(node) : undefined;
  const callableStorageType = (type: Type, types: ReturnType<typeof semantics.forNode>["types"]): boolean => {
    const pending = [type];
    const visited = new Set<Type>();
    while (pending.length !== 0 && account()) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (types.isUnion(current)) {
        const members = types.unionOrIntersectionTypes(current);
        if (!account(members.length)) return false;
        pending.push(...members);
        continue;
      }
      if (types.isNullish(current) || types.isVoidLike(current) || types.isNever(current)) continue;
      if (types.callSignatures(current).length !== 0 || types.isAny(current) || types.isUnknown(current) ||
        types.isNonPrimitive(current) || types.couldContainTypeVariables(current)) return true;
      if (types.constructSignatures(current).length === 0 && types.propertyInfos(current).length === 0 &&
        types.indexInfos(current).length === 0 && !types.isStringLike(current) && !types.isNumberLike(current) &&
        !types.isBooleanLike(current) && !types.isBigIntLike(current) && !types.isSymbolLike(current)) return true;
    }
    return false;
  };
  const pending: Vertex[] = [];
  for (const node of input.nativeNodes) {
    if (!account()) return result();
    const receiver = unwrap(node);
    const owner = receiver === undefined ? undefined : receiverOwner(receiver);
    if (owner !== undefined) receiverOwners.set(node, owner);
    if (isCallable(node) && ast.body(node) !== undefined && receiverCaptures.fixedSelfFor(node) === undefined) {
      const selected = vertex("callable", node);
      if (selected !== undefined) pending.push(selected);
    }
  }
  const admitCapture = (callable: Vertex, capture: RustCallableOwnershipCapture): void => {
    if (!account(1 + capture.references.length)) return;
    const values = captures.get(callable.declaration) ?? [];
    values.push(Object.freeze({ ...capture, references: Object.freeze([...capture.references]) }));
    captures.set(callable.declaration, values);
    if (capture.kind === "receiver") return;
    const selected = vertex("slot", capture.declaration);
    if (selected !== undefined) {
      connect(neighbours, callable, selected);
      pending.push(selected);
    }
  };
  const visited = new Set<Vertex>();
  while (pending.length !== 0 && account()) {
    const selected = pending.pop()!;
    if (visited.has(selected)) continue;
    visited.add(selected);
    const declaration = selected.declaration;
    if (selected.kind === "slot") {
      const subject = storage.storageSubjectFor(declaration);
      if (subject.kind === "unresolved") { issue(declaration, subject.reason); continue; }
      const type = storage.typeFor(subject.subject);
      if (type.kind === "unresolved") { issue(declaration, type.reason); continue; }
      if (!callableStorageType(type.type, semantics.forFile(type.sourceFile).types)) continue;
      const origins = storage.originsFor(subject.subject);
      if (origins.kind === "unresolved") { issue(declaration, origins.reason); continue; }
      for (const origin of origins.origins) {
        if (!account()) break;
        const node = origin.subject.node;
        if (!sourceNodes.has(node)) {
          issue(declaration, "A callable ownership origin belongs to a different checked source graph.");
          continue;
        }
        if (origin.subject.kind !== "value" || origin.subject.projection.length !== 0 ||
          !isCallable(node) || ast.body(node) === undefined) {
          if (semantics.forNode(node).types.callable(origin.type) !== undefined)
            issue(declaration, "A callable ownership slot has an unresolved external or projected callable origin.");
          continue;
        }
        if (receiverCaptures.fixedSelfFor(node) !== undefined) {
          issue(declaration, "A callable ownership slot mixes a separately proven fixed-self representation.");
          continue;
        }
        const target = vertex("callable", node);
        if (target !== undefined) { connect(neighbours, selected, target); pending.push(target); }
      }
      continue;
    }
    const body = ast.body(declaration)!;
    let environment: ReturnType<typeof sourceLexicalEnvironment>;
    try {
      environment = sourceLexicalEnvironment(declaration, [...ast.parameters(declaration).flatMap(parameter => {
        const initializer = Node_Initializer(ast, parameter);
        return initializer === undefined ? [] : [initializer];
      }), body], boundedAst, navigation, "source", input.isRuntimeUse);
    } catch (error) {
      if (failure !== undefined) return result();
      throw error;
    }
    if (environment.kind === "unresolved") { issue(declaration, environment.reason); continue; }
    for (const capture of environment.captures) {
      if (!account()) break;
      admitCapture(selected, { callable: declaration, declaration: capture.declaration,
        kind: "lexical", references: capture.references });
    }
    const consumedReceivers = new Set<Node>();
    const receiverReferences = new Set<Node>();
    for (const receiver of environment.receivers) for (const reference of receiver.references) {
      if (!account()) break;
      receiverReferences.add(reference);
    }
    for (const capture of receiverCaptures.capturesFor(declaration)) {
      if (!account()) break;
      const slot = canonical(capture.declaration);
      const owner = classOwner(slot);
      const selectedRelations: RustCallableOwnershipReceiverRelation[] = [];
      for (const access of capture.references) {
        if (!account()) break;
        const info = accessInfo(access);
        const receiver = unwrap(info?.receiver.expression);
        const currentOwner = receiver === undefined ? undefined : receiverOwner(receiver);
        if (info?.selectedDeclaration !== capture.declaration || !isField(capture.declaration) ||
          !isField(slot) || owner === undefined || receiver === undefined || currentOwner === undefined ||
          classOwner(declaration) !== currentOwner || !receiverReferences.has(receiver) ||
          !receiverCaptures.hasStoredField(currentOwner, capture.declaration) ||
          !receiverCaptures.hasStoredField(currentOwner, slot)) {
          issue(declaration, "A captured field requires an exact same-instance receiver and canonical stored-field declaration.");
          continue;
        }
        consumedReceivers.add(receiver);
        selectedRelations.push(Object.freeze({ callable: declaration, selectedDeclaration: capture.declaration,
          storageDeclaration: slot, access, receiver, receiverOwner: currentOwner }));
      }
      if (selectedRelations.length !== capture.references.length || selectedRelations.length === 0 ||
        capture.reference !== capture.references[0] || capture.receiver !== selectedRelations[0]!.receiver) {
        issue(declaration, "A captured field lost its exact reference and receiver relation.");
        continue;
      }
      const retainedRelations = relations.get(declaration) ?? [];
      for (const relation of selectedRelations) {
        if (!account()) break;
        retainedRelations.push(relation);
      }
      relations.set(declaration, retainedRelations);
      admitCapture(selected, { callable: declaration, declaration: slot, kind: "field", references: capture.references });
    }
    for (const receiver of environment.receivers) {
      if (!account(receiver.references.length)) break;
      const references = receiver.references.filter(reference => !consumedReceivers.has(reference));
      if (references.length !== 0) admitCapture(selected, { callable: declaration,
        declaration: receiver.owner, kind: "receiver", references });
    }
  }
  if (failure !== undefined || storage.failureReason() !== undefined) return result();
  for (const declaration of callables.keys()) {
    if (!account()) return result();
    if (!problems.has(declaration) && (captures.get(declaration)?.length ?? 0) === 0)
      independentCallables.add(declaration);
  }
  const cyclic = graphComponents(vertices, neighbours);
  if (cyclic === undefined) return result();
  const cycleSlots = new Set<Vertex>();
  const cycleCallables = new Set<Vertex>();
  for (const members of cyclic) {
    if (!account()) return result();
    if (members.length < 2) continue;
    for (const member of members) {
      if (!account()) return result();
      (member.kind === "slot" ? cycleSlots : cycleCallables).add(member);
      (member.kind === "slot" ? cyclicSlots : cyclicCallables).add(member.declaration);
    }
  }
  const affinityVertices = new Set<Vertex>([...cycleSlots, ...cycleCallables]);
  const affinity = new Map<Vertex, Set<Vertex>>();
  const join = (first: Vertex, second: Vertex): void => {
    affinityVertices.add(first);
    affinityVertices.add(second);
    connect(affinity, first, second);
    connect(affinity, second, first);
  };
  for (const slot of cycleSlots) for (const origin of neighbours.get(slot) ?? []) {
    if (!account()) return result();
    join(slot, origin);
  }
  for (const callable of affinityVertices) {
    if (!account()) return result();
    if (callable.kind !== "callable") continue;
    for (const slot of neighbours.get(callable) ?? []) {
      if (!account()) return result();
      if (cycleSlots.has(slot)) join(callable, slot);
    }
  }
  const closed = graphComponents(affinityVertices, affinity);
  if (closed === undefined) return result();
  for (const node of input.nativeNodes) {
    if (!account()) return result();
    const info = accessInfo(node);
    const declaration = info?.selectedDeclaration;
    if (info === undefined || declaration === undefined || !isField(declaration) || info.accessMode === "read") continue;
    const slot = canonical(declaration);
    const accesses = writes.get(slot) ?? [];
    accesses.push(node);
    writes.set(slot, accesses);
  }
  for (const members of closed) {
    if (!account(1 + 2 * members.length)) return result();
    const declarations = members.filter(member => member.kind === "callable").map(member => member.declaration);
    const storageDeclarations = members.filter(member => member.kind === "slot").map(member => member.declaration);
    if (declarations.length === 0 || storageDeclarations.length === 0) continue;
    const owners = storageDeclarations.map(ownerForSlot);
    const owner = owners[0];
    let reason = members.map(member => problems.get(member.declaration)).find(value => value !== undefined);
    for (const declaration of storageDeclarations) {
      if (!account()) return result();
      const subject = storage.storageSubjectFor(declaration);
      const domain = subject.kind === "resolved" ? storage.storageProducersFor(subject.subject) : subject;
      if (domain.kind !== "complete") reason ??= domain.kind === "unresolved" ? domain.reason
        : "A cyclic callable storage domain has unknown physical activation contributors.";
    }
    if (owner === undefined || owners.some(current => current === undefined || current.kind !== owner.kind ||
      current.declaration !== owner.declaration || current.scope !== owner.scope))
      reason ??= "A cyclic callable component requires one exact lexical activation or one class-instance owner.";
    if (owner !== undefined) for (const declaration of declarations) {
      if (!account()) return result();
      if (independentCallables.has(declaration)) continue;
      if (owner.kind === "lexical") {
        if (sourceEnclosingCallable(ast.parent(declaration), boundedAst) !== owner.declaration ||
          !within(declaration, owner.scope)) reason ??= "A callable origin belongs to a different lexical activation.";
      } else if (classOwner(declaration) !== owner.declaration ||
        !(supplied.get(declaration)?.has(owner.declaration) ?? false))
        reason ??= "A callable field origin has no exact same-instance construction or assignment relationship.";
    }
    if (reason !== undefined || owner === undefined) {
      for (const member of members) issue(member.declaration, reason ?? "A callable component has no exact activation owner.");
      continue;
    }
    if (storageDeclarations.length === 1 && declarations.length === 1 && owner.kind === "lexical" &&
      !navigation.declarationUseSummary(storageDeclarations[0]!).bindingWritten) {
      cyclicSlots.delete(storageDeclarations[0]!);
      cyclicCallables.delete(declarations[0]!);
      continue;
    }
    const slotSet = new Set(storageDeclarations);
    const retained: RustCallableOwnershipCapture[] = [];
    for (const declaration of declarations) for (const capture of captures.get(declaration) ?? []) {
      if (!account()) return result();
      retained.push(capture);
    }
    const component: RustCallableOwnershipComponent = Object.freeze({ identity: storageDeclarations[0]!,
      ownerDeclaration: owner.declaration, kind: owner.kind, activationScope: owner.scope,
      callableDeclarations: Object.freeze(declarations), slotDeclarations: Object.freeze(storageDeclarations),
      captures: Object.freeze(retained), externalCaptures: Object.freeze(retained.filter(capture =>
        capture.kind === "receiver" || !slotSet.has(capture.declaration))),
      receiverRelations: Object.freeze(declarations.flatMap(declaration => relations.get(declaration) ?? [])),
      creationIdentity: "per-evaluation" });
    components.push(component);
    for (const declaration of declarations) callableComponents.set(declaration, component);
    for (const declaration of storageDeclarations) slotComponents.set(declaration, component);
  }
  return result();

  function ownerForSlot(declaration: Node): Owner | undefined {
    if (!account()) return undefined;
    if (isField(declaration)) {
      if (ast.hasModifierKind(declaration, "static")) {
        issue(declaration, "A cyclic callable field requires instance storage, not a static class owner.");
        return undefined;
      }
      const owner = classOwner(declaration);
      if (owner === undefined) return undefined;
      const initializer = unwrap(Node_Initializer(ast, declaration));
      if (initializer !== undefined) recordSupplier(declaration, initializer, owner);
      for (const node of writes.get(declaration) ?? []) {
        if (!account()) return undefined;
        const info = accessInfo(node);
        const receiver = unwrap(info?.receiver.expression);
        const parent = ast.parent(node);
        const binary = parent === undefined ? undefined : ast.as.AsBinaryExpression(parent);
        if (receiver === undefined || binary?.Left !== node ||
          parent === undefined || ast.operatorKindName(parent) !== "KindEqualsToken") {
          issue(declaration, "A cyclic callable field has a foreign-instance, accessor or unresolved write relationship.");
          continue;
        }
        const value = unwrap(binary.Right);
        if (value !== undefined && independentSupplier(value)) continue;
        if (receiverOwner(receiver) !== owner) {
          issue(declaration, "A cyclic callable field has a foreign-instance retaining write relationship.");
          continue;
        }
        if (value !== undefined) recordSupplier(declaration, value, owner);
      }
      return Object.freeze({ kind: "class", declaration: owner, scope: owner });
    }
    const scope = sourceBindingScope(declaration, boundedAst);
    const owner = sourceEnclosingCallable(ast.parent(declaration), boundedAst);
    return scope === undefined || owner === undefined ? undefined
      : Object.freeze({ kind: "lexical", declaration: owner, scope });
  }

  function recordSupplier(slot: Node, expression: Node, owner: Node): void {
    if (!account()) return;
    if (independentSupplier(expression)) return;
    const creations = storage.localCallableCreationsFor(expression);
    if (creations.kind !== "resolved" || creations.nodes.length === 0 ||
      creations.nodes.some(node => !sourceNodes.has(node) || !isCallable(node) || classOwner(node) !== owner)) {
      issue(slot, "A cyclic callable field assignment requires an exact local callback creation, not declaration-level alias transport.");
      return;
    }
    for (const node of creations.nodes) {
      if (!account()) return;
      const owners = supplied.get(node) ?? new Set<Node>();
      owners.add(owner);
      supplied.set(node, owners);
    }
  }

  function independentSupplier(expression: Node): boolean {
    if (!account()) return false;
    const subject = storage.subject(expression, "value");
    const origins = subject.kind === "resolved" ? storage.closedOriginsFor(subject.subject) : subject;
    return origins.kind === "complete" && origins.origins.length !== 0 && origins.origins.every(origin =>
      account() && origin.subject.kind === "value" && origin.subject.projection.length === 0 &&
      independentCallables.has(origin.subject.node));
  }

  function within(node: Node, scope: Node): boolean {
    for (let current: Node | undefined = node; current !== undefined && account(); current = ast.parent(current))
      if (current === scope) return true;
    return false;
  }

  function graphComponents(nodes: ReadonlySet<Vertex>, graph: ReadonlyMap<Vertex, ReadonlySet<Vertex>>):
    readonly (readonly Vertex[])[] | undefined {
    if (nodes.size === 0) return Object.freeze([]);
    const selected = targetStronglyConnectedComponents(nodes, node => graph.get(node) ?? [], account);
    if (selected.kind === "unresolved") { reject(selected.reason); return undefined; }
    return selected.components;
  }

  function result(): RustCallableOwnershipComponentQueries {
    failure ??= storage.failureReason();
    return sealRustCallableOwnershipComponents({ components, issues, failure, callableComponents, slotComponents,
      canonicalSlots, cyclicCallables, cyclicSlots, independentCallables, receiverOwners });
  }
}
