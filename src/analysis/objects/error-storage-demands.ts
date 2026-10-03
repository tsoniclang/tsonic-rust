import type { Node, SourceFile } from "@tsonic/tsts";
import { IsTypeSyntaxNode, Node_Expression, Node_Initializer, VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList, type TargetSourceProgram } from "@tsonic/target-api/source";
import { resolveRustSourceErrorDeclaration } from "../../policy/types/external-project-types.js";
import type { RustSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { rustSourceErrorConstructors } from "../../target-model/identities/source-errors.js";

export type RustErrorStorageDemand =
  | { readonly kind: "immutable" }
  | { readonly kind: "writable"; readonly writes: readonly Node[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustErrorStorageDemandQueries {
  readonly nativeConstructors: readonly Node[];
  readonly fieldWrites: readonly Node[];
  storageFor(subject: Node): RustErrorStorageDemand;
  receivesWritableNative(subject: Node): boolean;
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
  const incoming = new Map<Node, Set<Node>>();
  const subjects = new Map<Node, Node>();
  const mutationOwners = new Map<Node, Node>();
  const invocationTargets = new Map<Node, Node>();
  const invocationArguments = new Map<Node, readonly Node[]>();
  const capturedStackTargets = new Map<Node, Node>();
  const writes = new Map<Node, Set<Node>>();
  const nativeConstructors: Node[] = [];
  const fieldWrites: Node[] = [];
  const unresolvedSubjects = new Map<Node, string>();
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
        ast.is.IsGetAccessorDeclaration(current)) return current;
    }
    return undefined;
  };
  const callableFor = (node: Node): Node | undefined => {
    const selected = semantics.forNode(node).operations.call(node);
    if (selected === undefined || selected.sourceSelectedSignatureKind !== "resolved") return undefined;
    const declaration = semantics.forNode(node).declarations.signatureDeclaration(selected.selectedSignature);
    if (declaration === undefined) return undefined;
    const implementation = navigation.callableImplementation(declaration);
    return implementation?.kind === "resolved" ? implementation.implementation.declaration : declaration;
  };
  const subjectFor = (node: Node | undefined): Node | undefined => {
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
    const selected = ast.is.IsElementAccessExpression(node) ? node : ast.is.IsCallExpression(node) ? callableFor(node)
      : ast.is.IsPropertyAccessExpression(node)
        ? semantics.forNode(node).operations.propertyAccess(node)?.selectedReadDeclaration
          ?? semantics.forNode(node).operations.propertyAccess(node)?.selectedDeclaration
      : navigation.sourceReferenceFor(node)?.declaration;
    const subject = selected ?? node;
    subjects.set(node, subject);
    subjects.set(original, subject);
    return subject;
  };
  const connect = (origin: Node | undefined, destination: Node | undefined): void => {
    if (origin === undefined || destination === undefined || failure !== undefined) return;
    const origins = incoming.get(destination) ?? new Set<Node>();
    if (origins.has(origin)) return;
    if (++edgeCount > maximumDemandEdges) {
      failure = "Error storage transport exceeds its finite edge budget.";
      return;
    }
    origins.add(origin);
    incoming.set(destination, origins);
  };
  const recordWrite = (subject: Node | undefined, write: Node): void => {
    if (subject === undefined) {
      failure = "An admitted Error write has no exact source storage subject.";
      return;
    }
    const selected = writes.get(subject) ?? new Set<Node>();
    selected.add(write);
    writes.set(subject, selected);
    fieldWrites.push(write);
    if (++demandRows > maximumDemandRows) failure = "Error storage demand exceeds its finite selected-write budget.";
    if (ast.is.IsElementAccessExpression(subject) || ast.is.IsBindingElement(subject)) {
      unresolvedSubjects.set(subject, "An admitted Error write has no exact selected scalar storage transport.");
    }
  };
  const connectValueFlow = (expression: Node | undefined): void => {
    if (expression === undefined) return;
    const subject = subjectFor(expression);
    for (const declaration of navigation.expressionValueFlow(expression).aliasDeclarations) {
      if (!step()) return;
      connect(subject, declaration);
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
    if (ast.is.IsVariableDeclaration(node)) {
      connectValueFlow(Node_Initializer(ast, node));
    }
    if (ast.is.IsPropertyDeclaration(node) || ast.is.IsParameterDeclaration(node)) {
      connect(subjectFor(Node_Initializer(ast, node)), node);
    }
    if (ast.is.IsArrowFunction(node)) {
      const body = ast.as.AsArrowFunction(node)?.Body;
      if (body !== undefined && !ast.is.IsBlock(body)) connect(subjectFor(body), node);
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
      if (selected !== undefined && selected.accessMode !== "read") {
        const owner = subjectFor(selected.receiver.expression);
        if (owner !== undefined) mutationOwners.set(node, owner);
      }
      if (selected !== undefined && selected.accessMode !== "read" && declaration !== undefined && fields.has(declaration)) {
        recordWrite(subjectFor(selected.receiver.expression), node);
      }
    }
    if (ast.is.IsReturnStatement(node)) {
      connect(subjectFor(Node_Expression(ast, node)), enclosingCallable(node));
    }
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
      const selected = semantics.forNode(node).operations.call(node);
      const signature = selected === undefined ? undefined
        : semantics.forNode(node).declarations.signatureDeclaration(selected.selectedSignature);
      if (selected !== undefined && signature !== undefined) {
        const implementation = navigation.callableImplementation(signature);
        const implementationParameters = implementation.kind === "resolved"
          ? ast.parameters(implementation.implementation.declaration) : [];
        const callee = Node_Expression(ast, node);
        const target = implementation.kind === "resolved" && ast.body(implementation.implementation.declaration) !== undefined
          ? implementation.implementation.declaration : subjectFor(callee);
        if (target !== undefined) invocationTargets.set(node, target);
        invocationArguments.set(node, Object.freeze(selected.sourceArguments.map(argument => argument.expression)));
        const signatureOwner = ast.parent(signature);
        if (profiles.profileForNode(signature, ast) !== undefined && signatureOwner !== undefined &&
          ast.is.IsInterfaceDeclaration(signatureOwner) && ast.text(ast.name(signatureOwner)) === "ErrorConstructor" &&
          ast.text(ast.name(signature)) === "captureStackTrace" && selected.sourceArguments.length === 1) {
          const owner = subjectFor(selected.sourceArguments[0]!.expression);
          if (owner !== undefined) capturedStackTargets.set(node, owner);
        }
        if (constructors.has(signature)) {
          nativeConstructors.push(node);
          connectValueFlow(node);
        }
        for (const binding of selected.sourceArgumentBindings) {
          if (!step()) return;
          if (binding.sourceForm !== "value" || binding.sourceParameterForm !== "parameter") continue;
          const selectedParameter = selected.sourceSelectedSignatureParameters.find(parameter =>
            parameter.parameterIndex === binding.sourceParameterIndex)?.parameterDeclaration;
          const parameter = implementationParameters[binding.sourceParameterIndex] ?? selectedParameter;
          const argument = selected.sourceArguments[binding.sourceArgumentIndex]?.expression;
          connect(subjectFor(argument), parameter);
          connect(selectedParameter, parameter);
          if (parameter !== undefined) {
            for (const use of navigation.declarationUseSummary(parameter).uses) {
              if (use.role === "storage") connectValueFlow(use.reference);
            }
          }
        }
      }
    }
  };
  const nodes: Node[] = [...sourceFiles];
  while (nodes.length !== 0 && failure === undefined) {
    const node = nodes.pop()!;
    visit(node);
    const children: Node[] = [];
    ast.forEachChild(node, child => { if (child !== undefined) children.push(child); });
    nodes.push(...children.reverse());
  }
  if (failure === undefined) {
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
  const selections = new Map<Node, RustErrorStorageDemand>();
  const storageSubject = (subject: Node): Node | undefined => {
    for (let remaining = 2_048; IsTypeSyntaxNode(ast, subject); remaining -= 1) {
      if (remaining === 0) return undefined;
      const parent = ast.parent(subject);
      if (parent === undefined) break;
      subject = parent;
    }
    return subjects.get(subject) ?? subject;
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
  const nativeSubjects = new Set(nativeConstructors);
  const receivesWritableNative = (subject: Node): boolean => {
    const selected = storageSubject(subject);
    if (selected === undefined || failure !== undefined) return false;
    const pending = [selected];
    const visited = new Set<Node>();
    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index]!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (!step()) return false;
      if (nativeSubjects.has(current) && storageFor(current).kind === "writable") return true;
      pending.push(...incoming.get(current) ?? []);
    }
    return false;
  };
  const ancestors = (subject: Node): ReadonlySet<Node> | undefined => {
    const selected = storageSubject(subject);
    if (selected === undefined) return undefined;
    const pending = [selected];
    const visited = new Set<Node>();
    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index]!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (!step()) return undefined;
      pending.push(...incoming.get(current) ?? []);
    }
    return visited;
  };
  const invalidationFor: RustErrorStorageDemandQueries["invalidationFor"] = (owner, expression, pureInvocations) => {
    const sourceOwners = ancestors(owner);
    if (sourceOwners === undefined || failure !== undefined) return Object.freeze({ kind: "unresolved",
      reason: failure ?? "A borrowed Error field has no exact source storage owner." });
    const pending = [expression];
    const visited = new Set<Node>();
    let unresolved: string | undefined;
    while (pending.length !== 0) {
      const node = pending.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      if (!step()) return Object.freeze({ kind: "unresolved", reason: failure! });
      const mutation = mutationOwners.get(node) ?? capturedStackTargets.get(node);
      if (mutation !== undefined) {
        const affected = ancestors(mutation);
        if (affected === undefined) return Object.freeze({ kind: "unresolved", reason: "An Error borrow invalidation has no exact original storage." });
        if ([...affected].some(subject => sourceOwners.has(subject))) return Object.freeze({ kind: "invalidated" });
      }
      if (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node) || ast.is.IsFunctionDeclaration(node)) continue;
      if ((ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) && !pureInvocations.has(node) &&
        !nativeSubjects.has(node) && !capturedStackTargets.has(node)) {
        const target = invocationTargets.get(node);
        const candidates = target === undefined ? undefined : ancestors(target);
        let resolved = false;
        for (const candidate of candidates ?? []) {
          const body = ast.body(candidate);
          if (body === undefined) continue;
          resolved = true;
          pending.push(body);
        }
        if (!resolved) {
          for (const argument of invocationArguments.get(node) ?? []) {
            const origins = ancestors(argument);
            if (origins === undefined) { unresolved = "An opaque invocation has unresolved Error backing."; continue; }
            if ([...origins].some(subject => sourceOwners.has(subject))) unresolved = "An opaque native invocation can access the borrowed Error owner without an exact mutation footprint.";
            for (const candidate of origins) {
              const body = ast.body(candidate);
              if (body !== undefined) pending.push(body);
            }
          }
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined && !IsTypeSyntaxNode(ast, child)) pending.push(child); });
    }
    return unresolved === undefined ? Object.freeze({ kind: "preserved" }) : Object.freeze({ kind: "unresolved", reason: unresolved });
  };
  return Object.freeze({ nativeConstructors: Object.freeze(nativeConstructors),
    fieldWrites: Object.freeze(fieldWrites), storageFor, receivesWritableNative, invalidationFor });
}
