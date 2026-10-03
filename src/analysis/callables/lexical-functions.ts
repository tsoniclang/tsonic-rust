import type { Node, SourceFile } from "@tsonic/tsts";
import { forEachSourceImmediateEvaluationChild, Node_Initializer, sourceDeclarationIsModuleScoped,
  sourceLexicalCaptures, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { rustTypedLocationStorageRootReference } from "../operations/typed-locations.js";
import { rustFinalizedTargetInputMayMutateSource } from "../facts/finalized-operation/conversions.js";

export interface RustLexicalFunctionCapture {
  readonly declaration: Node;
  readonly reference: Node;
  readonly mutable: boolean;
}

export type RustLexicalFunctionSelection =
  | { readonly kind: "resolved"; readonly captures: readonly RustLexicalFunctionCapture[]; readonly valueObserved: boolean }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustLexicalFunctionQueries {
  forDeclaration(declaration: Node): RustLexicalFunctionSelection | undefined;
}

const maximumLexicalFunctions = 65_536;
const maximumLexicalCaptureRows = 262_144;
const maximumLexicalCaptureSteps = 4_194_304;

export function createRustLexicalFunctionQueries(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
): RustLexicalFunctionQueries {
  const { ast, navigation } = source;
  const declarations: Node[] = [];
  const pending: Node[] = [...sourceFiles];
  let steps = 0;
  while (pending.length > 0) {
    if (++steps > maximumLexicalCaptureSteps) return exhausted();
    const node = pending.pop()!;
    if (ast.is.IsFunctionDeclaration(node) && !sourceDeclarationIsModuleScoped(node, ast) && ast.body(node) !== undefined) {
      declarations.push(node);
      if (declarations.length > maximumLexicalFunctions) return exhausted();
    }
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  const captures = new Map<Node, Map<Node, RustLexicalFunctionCapture>>();
  const declarationSet = new Set(declarations);
  const callees = new Map<Node, Node[]>();
  let rows = 0;
  for (const declaration of declarations) {
    const selected = sourceLexicalCaptures(declaration, [declaration], ast, navigation);
    const evaluated = new Set<Node>();
    const mutationRoots = new Set<Node>();
    const body = ast.body(declaration);
    const evaluatedPending = body === undefined ? [] : [body];
    for (const parameter of ast.parameters(declaration)) {
      const initializer = Node_Initializer(ast, parameter);
      if (initializer !== undefined) evaluatedPending.push(initializer);
    }
    while (evaluatedPending.length > 0) {
      if (++steps > maximumLexicalCaptureSteps) return exhausted();
      const node = evaluatedPending.pop()!;
      if (evaluated.has(node)) continue;
      evaluated.add(node);
      const passing = facts.getArgumentPassingFact(node);
      if (passing?.mode === "borrow-mut") mutate(passing.storageExpression ?? node);
      const operation = facts.getFact(node, rustTargetOperationFactKey);
      const mutatesReceiver = operation?.kind === "source-call"
        ? operation.target.form === "method" && operation.target.mutatesSelf ||
          operation.target.form === "union-method" && operation.target.variants.some(variant => variant.mutatesSelf)
        : operation?.kind === "provider-operation" && operation.abi.targetReceiver.kind === "input" &&
          rustFinalizedTargetInputMayMutateSource(operation.abi.targetReceiver.input);
      if (mutatesReceiver) {
        const call = source.semantics.forNode(node).operations.call(node);
        const receiver = call?.sourceReceiver?.expression ?? call?.sourceCalleeAccess?.receiver.expression;
        if (receiver !== undefined) mutate(receiver);
      }
      forEachSourceImmediateEvaluationChild(ast, node, child => evaluatedPending.push(child));
    }
    const values = new Map<Node, RustLexicalFunctionCapture>();
    const calls: Node[] = [];
    for (const capture of selected.captures) {
      if (ast.is.IsFunctionDeclaration(capture.declaration) && declarationSet.has(capture.declaration)) {
        calls.push(capture.declaration);
        continue;
      }
      const reference = capture.references[capture.references.length - 1];
      if (reference === undefined) continue;
      const symbol = navigation.sourceReferenceFor(reference)?.symbol;
      values.set(capture.declaration, Object.freeze({
        declaration: capture.declaration,
        reference,
        mutable: mutationRoots.has(capture.declaration) || symbol !== undefined &&
          navigation.bindingWritesWithin(symbol, declaration).some(write => evaluated.has(write.operation)),
      }));
      if (++rows > maximumLexicalCaptureRows) return exhausted();
    }
    captures.set(declaration, values);
    callees.set(declaration, calls);

    function mutate(expression: Node): void {
      const root = rustTypedLocationStorageRootReference(expression, ast, navigation);
      if (root !== undefined) mutationRoots.add(root.declaration);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const values = captures.get(declaration)!;
      for (const callee of callees.get(declaration)!) {
        for (const capture of captures.get(callee)!.values()) {
          if (++steps > maximumLexicalCaptureSteps) return exhausted();
          const previous = values.get(capture.declaration);
          if (within(capture.declaration, declaration) || previous !== undefined && (!capture.mutable || previous.mutable)) continue;
          values.set(capture.declaration, previous === undefined ? capture : Object.freeze({ ...previous, mutable: true }));
          if (++rows > maximumLexicalCaptureRows) return exhausted();
          changed = true;
        }
      }
    }
  }
  const selections = new Map<Node, RustLexicalFunctionSelection>(declarations.map(declaration => [declaration, Object.freeze({
    kind: "resolved" as const,
    captures: Object.freeze([...captures.get(declaration)!.values()]),
    valueObserved: navigation.declarationUseSummary(declaration).firstClassUseCount > 0,
  })]));
  return Object.freeze({ forDeclaration: (declaration: Node) => selections.get(declaration) });

  function within(node: Node, owner: Node): boolean {
    for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
      if (current === owner) return true;
    }
    return false;
  }

  function exhausted(): RustLexicalFunctionQueries {
    const selection: RustLexicalFunctionSelection = Object.freeze({
      kind: "unresolved", reason: "Lexical function capture analysis exceeded its finite resource budget.",
    });
    return Object.freeze({ forDeclaration: (declaration: Node) =>
      ast.is.IsFunctionDeclaration(declaration) && !sourceDeclarationIsModuleScoped(declaration, ast) ? selection : undefined });
  }
}
