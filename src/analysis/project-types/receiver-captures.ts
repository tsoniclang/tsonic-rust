import type { AstReader, Node, SourceFile, Type } from "@tsonic/tsts";
import { Node_Expression, Node_Initializer, sourceLexicalEnvironment } from "@tsonic/target-api/source";
import type { SourceProgramNavigation, SourceProgramSemantics } from "@tsonic/target-api/source";
import { rustProjectObjectField } from "./object-layout.js";
import type { RustProjectTypePolicy } from "./type-policy.js";

export interface RustReceiverFieldCapture {
  readonly declaration: Node;
  readonly reference: Node;
  readonly receiver: Node;
  readonly references: readonly Node[];
}

export interface RustReceiverCapture {
  readonly owner: Node;
  readonly reference: Node;
  readonly references: readonly Node[];
}

export interface RustReceiverFieldCaptureQueries {
  readonly issues: readonly { readonly node: Node; readonly reason: string }[];
  readonly fields: readonly Node[];
  capturesFor(callable: Node): readonly RustReceiverFieldCapture[];
  fixedSelfFor(callable: Node): RustReceiverFieldCapture | undefined;
  fixedSelfForReference(reference: Node): RustReceiverFieldCapture | undefined;
  receiversFor(callable: Node): readonly RustReceiverCapture[];
  capturesReceiver(reference: Node): boolean;
  isCaptured(declaration: Node): boolean;
  isDeferred(declaration: Node): boolean;
  storageDeclaration(declaration: Node): Node;
  storageReadonly(declaration: Node): boolean;
  storageImmutable(declaration: Node): boolean;
}

export function analyzeRustReceiverFieldCaptures(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly semantics: SourceProgramSemantics;
  readonly sourceFiles: readonly SourceFile[];
  readonly projectTypes: RustProjectTypePolicy;
  readonly isStoredField: (declaration: Node) => boolean;
  readonly deferredFields: ReadonlySet<Node>;
}): RustReceiverFieldCaptureQueries {
  const issues: { readonly node: Node; readonly reason: string }[] = [];
  const fields = new Set<Node>();
  const receivers = new Set<Node>();
  const selections = new Map<Node, readonly RustReceiverFieldCapture[]>();
  const wholeReceivers = new Map<Node, readonly RustReceiverCapture[]>();
  const related = new Map<Node, Set<Node>>();
  const lexicalEnvironments = new Map<Node, ReturnType<typeof sourceLexicalEnvironment>>();
  const classReceivers = new Map<Node, Node[]>();
  const pending: Node[] = [...input.sourceFiles];
  let visited = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (++visited > 4_194_304) {
      issues.push({ node, reason: "Rust receiver capture analysis exceeds its finite node budget." });
      break;
    }
    if (input.ast.kindName(node) === "KindThisKeyword" || input.ast.kindName(node) === "KindThisExpression") {
      const owner = input.projectTypes.definitionContainingDeclaration(node);
      if (owner?.kind === "class") {
        const references = classReceivers.get(owner.declaration) ?? [];
        references.push(node);
        classReceivers.set(owner.declaration, references);
      }
    }
    if (input.ast.is.IsArrowFunction(node)) {
      const body = input.ast.body(node);
      const selected = body === undefined ? undefined
        : sourceLexicalEnvironment(node, [...input.ast.parameters(node).flatMap(parameter => {
          const initializer = parameter === undefined ? undefined : Node_Initializer(input.ast, parameter);
          return initializer === undefined ? [] : [initializer];
        }), body], input.ast, input.navigation);
      if (selected?.kind === "unresolved") {
        issues.push({ node, reason: selected.reason });
        continue;
      }
      if (selected !== undefined) lexicalEnvironments.set(node, selected);
      const captures = new Map<Node, { readonly receiver: Node; readonly references: Node[] }>();
      const retained: RustReceiverCapture[] = [];
      for (const receiver of selected?.receivers ?? []) {
        const selectedFields: { readonly declaration: Node; readonly reference: Node; readonly access: Node }[] = [];
        for (const reference of receiver.references) {
          let expression = reference;
          let access = input.ast.parent(expression);
          for (let depth = 0; access !== undefined && depth < 256 &&
            (input.ast.is.IsParenthesizedExpression(access) || input.ast.is.IsAsExpression(access) ||
              input.ast.is.IsSatisfiesExpression(access) || input.ast.is.IsNonNullExpression(access) || input.ast.is.IsTypeAssertion(access)) &&
            Node_Expression(input.ast, access) === expression; depth += 1) {
            expression = access;
            access = input.ast.parent(expression);
          }
          if (access === undefined || Node_Expression(input.ast, access) !== expression) continue;
          const semantics = input.semantics.forNode(access);
          const member = input.ast.is.IsPropertyAccessExpression(access)
            ? semantics.operations.propertyAccess(access)
            : input.ast.is.IsElementAccessExpression(access) ? semantics.operations.elementAccess(access) : undefined;
          const declaration = member?.selectedDeclaration;
          if (declaration === undefined || !input.isStoredField(declaration) ||
            rustProjectObjectField(declaration, input.ast) === undefined) continue;
          selectedFields.push({ declaration, reference, access });
        }
        if (selectedFields.length !== receiver.references.length) {
          if (receiver.references.length > 0) retained.push(Object.freeze({ owner: receiver.owner,
            reference: receiver.references[0]!, references: Object.freeze([...receiver.references]) }));
          continue;
        }
        for (const selected of selectedFields) {
          const capture = captures.get(selected.declaration) ?? { receiver: selected.reference, references: [] };
          capture.references.push(selected.access);
          captures.set(selected.declaration, capture);
          fields.add(selected.declaration);
          receivers.add(selected.reference);
        }
      }
      wholeReceivers.set(node, Object.freeze(retained));
      selections.set(node, Object.freeze([...captures].map(([declaration, capture]) => Object.freeze({
        declaration, receiver: capture.receiver, reference: capture.references[0]!,
        references: Object.freeze(capture.references),
      }))));
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  const demanded = [...fields];
  for (let index = 0; index < demanded.length; index += 1) {
    const declaration = demanded[index]!;
    for (const concrete of input.projectTypes.definitions) {
      if (concrete.kind !== "class") continue;
      const selected = input.projectTypes.memberImplementation(concrete, declaration);
      const implementation = selected.kind === "resolved" ? selected.implementation.declaration : undefined;
      if (implementation === undefined || !input.isStoredField(implementation) ||
        rustProjectObjectField(implementation, input.ast) === undefined) continue;
      if (!fields.has(implementation)) { fields.add(implementation); demanded.push(implementation); }
      const connected = new Set([...(related.get(declaration) ?? [declaration]), ...(related.get(implementation) ?? [implementation])]);
      for (const field of connected) related.set(field, connected);
    }
  }
  const storageDeclarations = new Map<Node, Node>();
  const readonlyStorage = new Set<Node>();
  const immutableStorage = new Set<Node>();
  const deferredStorage = new Set<Node>();
  for (const declaration of fields) {
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    const lineage = owner === undefined ? undefined : input.projectTypes.classLineage(owner);
    const family = related.get(declaration) ?? new Set([declaration]);
    const canonical = lineage?.flatMap(ancestor => [...family].filter(field =>
      input.projectTypes.definitionContainingDeclaration(field) === ancestor))[0] ?? declaration;
    storageDeclarations.set(declaration, canonical);
    if ([...family].every(field => input.ast.hasModifierKind(field, "readonly"))) {
      readonlyStorage.add(declaration);
      if (family.size === 1 && !input.navigation.declarationUseSummary(declaration).memberWritten) {
        immutableStorage.add(declaration);
      }
    }
    if ([...family].some(field => input.deferredFields.has(field))) deferredStorage.add(declaration);
  }
  const fixedSelf = new Map<Node, RustReceiverFieldCapture>();
  const fixedSelfReferences = new Map<Node, RustReceiverFieldCapture>();
  let ownershipSteps = 0;
  const account = (): boolean => ++ownershipSteps <= 4_194_304;
  if (issues.length === 0) for (const [callable, captures] of selections) {
    const capture = captures.length === 1 ? captures[0] : undefined;
    const environment = lexicalEnvironments.get(callable);
    const owner = capture === undefined ? undefined : input.projectTypes.definitionContainingDeclaration(capture.declaration);
    if (!account() || capture === undefined || environment?.kind !== "resolved" || owner?.kind !== "class" ||
      environment.captures.length !== 0 || environment.callableRoots.length !== 1 || environment.selfReferences.length !== 0 ||
      (wholeReceivers.get(callable)?.length ?? 0) !== 0 || Node_Initializer(input.ast, capture.declaration) !== callable ||
      input.ast.parent(capture.declaration) !== owner.declaration || input.ast.questionToken(capture.declaration) !== undefined ||
      input.ast.hasModifierKind(callable, "async") || input.ast.typeParameters(callable).length !== 0 ||
      owner.genericParameters.length !== 0 || input.projectTypes.isPolymorphic(owner) ||
      input.projectTypes.heritageForDefinition(owner).length !== 0 || input.projectTypes.externalBaseForDefinition(owner) !== undefined ||
      (related.get(capture.declaration)?.size ?? 1) !== 1 ||
      input.navigation.declarationUseSummary(capture.declaration).memberWritten ||
      input.navigation.declarationUseSummary(owner.declaration).exported) continue;
    const semantics = input.semantics.forNode(callable);
    const sourceType = semantics.types.expressionType(callable);
    const fieldType = semantics.declarations.declaredValueType(capture.declaration);
    const signature = sourceType === undefined ? undefined : semantics.types.callable(sourceType);
    const staticValue = (type: Type): boolean => !semantics.types.couldContainTypeVariables(type) &&
      (semantics.types.isNumberLike(type) || semantics.types.isBooleanLike(type) || semantics.types.isStringLike(type) ||
        semantics.types.isBigIntLike(type) || semantics.types.isVoidLike(type) || semantics.types.isNullish(type));
    if (sourceType === undefined || fieldType === undefined || !semantics.types.isIdentical(sourceType, fieldType) ||
      signature === undefined || !staticValue(signature.result.selectedType) ||
      signature.parameters.some(parameter => parameter.omissionKind !== "required" || !staticValue(parameter.type))) continue;
    const ownedRead = (access: Node): boolean => {
      let expression = access;
      let parent = input.ast.parent(expression);
      while (parent !== undefined && account() &&
        (input.ast.is.IsParenthesizedExpression(parent) || input.ast.is.IsAsExpression(parent) ||
          input.ast.is.IsSatisfiesExpression(parent) || input.ast.is.IsNonNullExpression(parent) || input.ast.is.IsTypeAssertion(parent)) &&
        Node_Expression(input.ast, parent) === expression) {
        const type = input.semantics.forNode(parent).types.expressionType(parent);
        if (type === undefined || !semantics.types.isIdentical(type, fieldType)) return false;
        expression = parent;
        parent = input.ast.parent(expression);
      }
      if (!account() || parent === undefined) return false;
      if (input.ast.is.IsCallExpression(parent)) return Node_Expression(input.ast, parent) === expression;
      if (input.ast.is.IsVariableDeclaration(parent) && Node_Initializer(input.ast, parent) === expression) {
        const type = input.semantics.forNode(parent).declarations.declaredValueType(parent);
        return type !== undefined && semantics.types.isIdentical(type, fieldType);
      }
      if (input.ast.is.IsBinaryExpression(parent) && ["KindEqualsEqualsToken", "KindEqualsEqualsEqualsToken",
        "KindExclamationEqualsToken", "KindExclamationEqualsEqualsToken"].includes(input.ast.operatorKindName(parent) ?? "")) return true;
      if (!input.ast.is.IsReturnStatement(parent) && !(input.ast.is.IsArrowFunction(parent) && input.ast.body(parent) === expression)) return false;
      for (let owner: Node | undefined = parent; owner !== undefined; owner = input.ast.parent(owner)) {
        if (!account()) return false;
        if (["KindFunctionDeclaration", "KindFunctionExpression", "KindArrowFunction", "KindMethodDeclaration",
          "KindGetAccessor"].includes(input.ast.kindName(owner))) {
          const selected = input.semantics.forNode(owner);
          const type = input.ast.is.IsArrowFunction(owner) || input.ast.is.IsFunctionExpression(owner)
            ? selected.types.expressionType(owner) : selected.declarations.declaredValueType(owner);
          const result = type === undefined ? undefined : selected.types.callable(type)?.result.selectedType;
          return result !== undefined && semantics.types.isIdentical(result, fieldType);
        }
      }
      return false;
    };
    const selectedAccess = (reference: Node): Node | undefined => {
      let expression = reference;
      let parent = input.ast.parent(expression);
      while (parent !== undefined && account() &&
        (input.ast.is.IsParenthesizedExpression(parent) || input.ast.is.IsAsExpression(parent) ||
          input.ast.is.IsSatisfiesExpression(parent) || input.ast.is.IsNonNullExpression(parent) || input.ast.is.IsTypeAssertion(parent)) &&
        Node_Expression(input.ast, parent) === expression) {
        expression = parent;
        parent = input.ast.parent(expression);
      }
      if (!account() || parent === undefined || Node_Expression(input.ast, parent) !== expression) return undefined;
      if (input.ast.is.IsElementAccessExpression(parent)) {
        const key = input.ast.as.AsElementAccessExpression(parent)?.ArgumentExpression;
        const effects = key === undefined ? undefined : input.navigation.expressionEffects(key);
        if (effects === undefined || effects.invokes || effects.mutates || effects.suspends || effects.mayThrow) return undefined;
      }
      const selected = input.ast.is.IsPropertyAccessExpression(parent)
        ? input.semantics.forNode(parent).operations.propertyAccess(parent)
        : input.ast.is.IsElementAccessExpression(parent) ? input.semantics.forNode(parent).operations.elementAccess(parent) : undefined;
      return selected?.selectedDeclaration === capture.declaration && selected.accessMode === "read" && ownedRead(parent) ? parent : undefined;
    };
    if (capture.references.some(reference => {
      for (let parent = input.ast.parent(reference); parent !== undefined; parent = input.ast.parent(parent)) {
        if (!account()) return true;
        if (parent === callable) return false;
        if (["KindFunctionDeclaration", "KindFunctionExpression", "KindArrowFunction", "KindMethodDeclaration",
          "KindConstructor", "KindGetAccessor", "KindSetAccessor"].includes(input.ast.kindName(parent))) return true;
      }
      return true;
    })) continue;
    if ((classReceivers.get(owner.declaration) ?? []).some(reference => selectedAccess(reference) === undefined)) continue;
    const uses = input.navigation.declarationUseSummary(owner.declaration).uses;
    const constructions: Node[] = [];
    let closed = true;
    for (const use of uses) {
      if (!account()) { closed = false; break; }
      if (use.kind === "type-only") { closed = false; break; }
      let expression = use.reference;
      let parent = input.ast.parent(expression);
      while (parent !== undefined && account() && input.ast.is.IsParenthesizedExpression(parent) &&
        Node_Expression(input.ast, parent) === expression) {
        expression = parent;
        parent = input.ast.parent(expression);
      }
      if (use.role !== "call-target" || parent === undefined || !input.ast.is.IsNewExpression(parent) ||
        Node_Expression(input.ast, parent) !== expression) { closed = false; break; }
      constructions.push(parent);
    }
    if (!closed || constructions.length === 0) continue;
    for (const construction of constructions) {
      const flow = input.navigation.expressionValueFlow(construction);
      if (!account() || flow.exported || flow.returned || flow.yielded || flow.passedAsArgument ||
        flow.storedOutsideBinding || flow.hasUnclassifiedUse || flow.memberWritten ||
        flow.aliasDeclarations.some(declaration => !account() || input.navigation.declarationUseSummary(declaration).bindingWritten) ||
        flow.uses.some(use => !account() || use.kind === "type-only" ||
          !use.throughMember || use.role !== "receiver" || selectedAccess(use.reference) === undefined)) {
        closed = false;
        break;
      }
    }
    if (!closed) continue;
    fixedSelf.set(callable, capture);
    for (const reference of capture.references) fixedSelfReferences.set(reference, capture);
    selections.set(callable, Object.freeze([]));
  }
  fields.clear();
  for (const captures of selections.values()) for (const capture of captures)
    for (const declaration of related.get(capture.declaration) ?? [capture.declaration]) fields.add(declaration);
  return Object.freeze({ issues: Object.freeze(issues.map(issue => Object.freeze(issue))), fields: Object.freeze([...fields]),
    capturesFor: (callable: Node) => selections.get(callable) ?? [],
    fixedSelfFor: (callable: Node) => fixedSelf.get(callable),
    fixedSelfForReference: (reference: Node) => fixedSelfReferences.get(reference),
    receiversFor: (callable: Node) => wholeReceivers.get(callable) ?? [],
    capturesReceiver: (reference: Node) => receivers.has(reference),
    isCaptured: (declaration: Node) => fields.has(declaration),
    isDeferred: (declaration: Node) => deferredStorage.has(declaration),
    storageDeclaration: (declaration: Node) => storageDeclarations.get(declaration) ?? declaration,
    storageReadonly: (declaration: Node) => readonlyStorage.has(declaration),
    storageImmutable: (declaration: Node) => immutableStorage.has(declaration),
  });
}
