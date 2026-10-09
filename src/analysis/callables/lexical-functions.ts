import type { Node, SourceFile } from "@tsonic/tsts";
import { createSourceSingleInvocationQuery, forEachSourceImmediateEvaluationChild, Node_Initializer, sourceDeclarationIsModuleScoped,
  sourceLexicalEnvironment, sourceLexicalFunctionValueCreation, sourceLexicalFunctionValueOrder,
  type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetOperationFactKey, rustSourceCallableReturnFactKey } from "../facts/keys.js";
import { rustTypedLocationStorageRootReference } from "../operations/typed-locations.js";
import { rustFinalizedTargetInputMayMutateSource } from "../facts/finalized-operation/conversions.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import type { RustLifetimeIndex, RustSourceGenericParameterContract } from "../../target-model/lifetimes/index.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { resolveRustEnclosingGenericParameters } from "../../policy/types/resolution/generic-environment.js";
import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";
import type { RustRuntimeValueUsePlan } from "../program/runtime-value-uses.js";

export interface RustLexicalFunctionCapture {
  readonly declaration: Node;
  readonly reference: Node;
  readonly mutable: boolean;
}

export type RustLexicalFunctionSelection =
  | { readonly kind: "resolved"; readonly captures: readonly RustLexicalFunctionCapture[];
      readonly genericParameters: readonly RustSourceGenericParameterContract[]; readonly valueObserved: boolean;
      readonly inlineValueReference?: Node;
      readonly singleInvocation: boolean; readonly captureRoots: readonly Node[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface RustLexicalFunctionQueries {
  forDeclaration(declaration: Node): RustLexicalFunctionSelection | undefined;
  valueDeclarationsAt(statement: Node): readonly Node[];
}

const maximumLexicalFunctions = 65_536;
const maximumLexicalCaptureRows = 262_144;
const maximumLexicalCaptureSteps = 4_194_304;

export function createRustLexicalFunctionQueries(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  lifetimes: RustLifetimeIndex,
  runtimeValueUses: RustRuntimeValueUsePlan,
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
  const genericIdentities = new Map<Node, Set<string>>();
  let rows = 0;
  for (const declaration of declarations) {
    const selected = sourceLexicalEnvironment(declaration, [declaration], ast, navigation,
      (use, referencedDeclaration) => facts.getFact(use.reference, rustCompileTimeSourceKey) !== true &&
        runtimeValueUses.isRuntimeReference(referencedDeclaration, use.reference));
    if (selected.kind === "unresolved") return exhausted(selected.reason);
    const evaluated = new Set<Node>();
    const mutationRoots = new Set<Node>();
    const evaluatedPending = selected.callableRoots.flatMap(owner => {
      const body = ast.body(owner);
      return [...(body === undefined ? [] : [body]), ...ast.parameters(owner).flatMap(parameter => {
        const initializer = Node_Initializer(ast, parameter);
        return initializer === undefined ? [] : [initializer];
      })];
    });
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
    const calls = selected.callableRoots.filter(owner => owner !== declaration && declarationSet.has(owner));
    for (const capture of selected.captures) {
      const reference = capture.references[capture.references.length - 1];
      if (reference === undefined) continue;
      const symbol = navigation.sourceReferenceFor(reference)?.symbol;
      values.set(capture.declaration, Object.freeze({
        declaration: capture.declaration,
        reference,
        mutable: mutationRoots.has(capture.declaration) || symbol !== undefined &&
          selected.callableRoots.some(owner =>
            navigation.bindingWritesWithin(symbol, owner).some(write => evaluated.has(write.operation))),
      }));
      if (++rows > maximumLexicalCaptureRows) return exhausted();
    }
    captures.set(declaration, values);
    callees.set(declaration, calls);
    const identities = new Set<string>();
    const nodes = new Set([...evaluated, declaration, ...ast.parameters(declaration),
      ...[...values.values()].flatMap(capture => [capture.declaration, capture.reference])]);
    for (const node of nodes) {
      const carrier = facts.getRuntimeCarrierFact(node)?.carrier ??
        facts.getFact(node, rustSourceCallableReturnFactKey)?.returnCarrier;
      if (carrier === undefined) continue;
      const references = rustTargetGenericReferences(carrier);
      for (const identity of [...references.typeIdentities, ...references.lifetimeIdentities]) identities.add(identity);
    }
    genericIdentities.set(declaration, identities);

    function mutate(expression: Node): void {
      const root = rustTypedLocationStorageRootReference(expression, ast, navigation);
      if (root !== undefined) mutationRoots.add(root.declaration);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      for (const callee of callees.get(declaration)!) {
        const bound = new Set((lifetimes.contractFor(callee)?.parameters ?? []).map(parameter =>
          parameter.kind === "type" ? parameter.identity : rustLifetimeKey(parameter.lifetime)));
        for (const identity of genericIdentities.get(callee)!) {
          if (++steps > maximumLexicalCaptureSteps) return exhausted();
          if (!bound.has(identity) && !genericIdentities.get(declaration)!.has(identity)) {
            genericIdentities.get(declaration)!.add(identity);
            changed = true;
          }
        }
      }
    }
  }
  const selections = new Map<Node, RustLexicalFunctionSelection>();
  const valueDeclarations = new Map<Node, Node[]>();
  const singleInvocation = createSourceSingleInvocationQuery(ast, navigation);
  for (const declaration of declarations) {
    const creation = sourceLexicalFunctionValueCreation(declaration, ast, navigation,
      (use, referencedDeclaration) => facts.getFact(use.reference, rustCompileTimeSourceKey) !== true &&
        runtimeValueUses.isRuntimeReference(referencedDeclaration, use.reference));
    if (creation.kind === "unresolved") {
      selections.set(declaration, Object.freeze({ kind: "unresolved", reason: creation.reason }));
      continue;
    }
    if (creation.kind === "resolved" && creation.inlineReference === undefined) {
      const scheduled = valueDeclarations.get(creation.statement) ?? [];
      scheduled.push(declaration);
      valueDeclarations.set(creation.statement, scheduled);
    }
    const roots = new Set<Node>();
    const rootPending = [declaration];
    while (rootPending.length > 0) {
      if (++steps > maximumLexicalCaptureSteps) return exhausted();
      const current = rootPending.pop()!;
      if (roots.has(current)) continue;
      roots.add(current);
      rootPending.push(...callees.get(current)!);
      if (++rows > maximumLexicalCaptureRows) return exhausted();
    }
    const own = new Set((lifetimes.contractFor(declaration)?.parameters ?? []).map(parameter =>
      parameter.kind === "type" ? parameter.identity : rustLifetimeKey(parameter.lifetime)));
    const parameters = resolveRustEnclosingGenericParameters(declaration,
      [...genericIdentities.get(declaration)!].filter(identity => !own.has(identity)), ast, lifetimes);
    selections.set(declaration, Object.freeze(parameters === undefined
      ? { kind: "unresolved", reason: "A lexical function lost its exact enclosing generic or lifetime declarations." }
      : { kind: "resolved", captures: Object.freeze([...captures.get(declaration)!.values()]), genericParameters: parameters,
          valueObserved: creation.kind === "resolved",
          ...(creation.kind === "resolved" && creation.inlineReference !== undefined
            ? { inlineValueReference: creation.inlineReference } : {}),
          singleInvocation: singleInvocation(declaration), captureRoots: Object.freeze([...roots]) }));
  }
  const empty: readonly Node[] = Object.freeze([]);
  const scheduled = new Map<Node, readonly Node[]>();
  for (const [statement, values] of valueDeclarations) {
    const ordered = sourceLexicalFunctionValueOrder(values, ast, navigation,
      (use, referencedDeclaration) => facts.getFact(use.reference, rustCompileTimeSourceKey) !== true &&
        runtimeValueUses.isRuntimeReference(referencedDeclaration, use.reference));
    if (ordered.kind === "resolved") scheduled.set(statement, ordered.declarations);
    else for (const declaration of values) selections.set(declaration, Object.freeze(ordered));
  }
  return Object.freeze({ forDeclaration: (declaration: Node) => selections.get(declaration),
    valueDeclarationsAt: (statement: Node) => scheduled.get(statement) ?? empty });


  function exhausted(reason = "Lexical function capture analysis exceeded its finite resource budget."): RustLexicalFunctionQueries {
    const selection: RustLexicalFunctionSelection = Object.freeze({
      kind: "unresolved", reason,
    });
    return Object.freeze({ forDeclaration: (declaration: Node) =>
      ast.is.IsFunctionDeclaration(declaration) && !sourceDeclarationIsModuleScoped(declaration, ast) ? selection : undefined,
      valueDeclarationsAt: () => Object.freeze([]) });
  }
}
