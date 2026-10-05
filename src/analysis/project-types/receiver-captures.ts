import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
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
  const pending: Node[] = [...input.sourceFiles];
  let visited = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (++visited > 4_194_304) {
      issues.push({ node, reason: "Rust receiver capture analysis exceeds its finite node budget." });
      break;
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
  return Object.freeze({ issues: Object.freeze(issues.map(issue => Object.freeze(issue))), fields: Object.freeze([...fields]),
    capturesFor: (callable: Node) => selections.get(callable) ?? [],
    receiversFor: (callable: Node) => wholeReceivers.get(callable) ?? [],
    capturesReceiver: (reference: Node) => receivers.has(reference),
    isCaptured: (declaration: Node) => fields.has(declaration),
    isDeferred: (declaration: Node) => deferredStorage.has(declaration),
    storageDeclaration: (declaration: Node) => storageDeclarations.get(declaration) ?? declaration,
    storageReadonly: (declaration: Node) => readonlyStorage.has(declaration),
    storageImmutable: (declaration: Node) => immutableStorage.has(declaration),
  });
}
