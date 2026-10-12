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
import type { RustSourceCallableQueries } from "../../policy/ownership/source-borrowed-return.js";
import { rustCallableImplicitLifetimeParameters } from "../facts/source-input-lifetimes.js";
import { rustSourceParameterAbiFactKey } from "../facts/keys.js";
import type { RustNativeStoragePlan } from "./native-storage.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";

export interface RustLexicalFunctionCapture {
  readonly declaration: Node;
  readonly reference: Node;
  readonly mutable: boolean;
}

export type RustLexicalFunctionEnvironmentSelection =
  | { readonly kind: "resolved"; readonly captures: readonly RustLexicalFunctionCapture[];
      readonly valueObserved: boolean;
      readonly inlineValueReference?: Node;
      readonly singleInvocation: boolean; readonly captureRoots: readonly Node[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export type RustLexicalFunctionSelection =
  | (Extract<RustLexicalFunctionEnvironmentSelection, { readonly kind: "resolved" }> & {
      readonly genericParameters: readonly RustSourceGenericParameterContract[] })
  | Extract<RustLexicalFunctionEnvironmentSelection, { readonly kind: "unresolved" }>;

export interface RustLexicalFunctionEnvironments {
  forDeclaration(declaration: Node): RustLexicalFunctionEnvironmentSelection | undefined;
  valueDeclarationsAt(statement: Node): readonly Node[];
}

export interface RustLexicalFunctionEnvironmentPlan extends RustLexicalFunctionEnvironments {
  readonly declarations: readonly Node[];
  genericNodesFor(declaration: Node): readonly Node[];
  calleesFor(declaration: Node): readonly Node[];
}

export interface RustLexicalFunctionQueries extends RustLexicalFunctionEnvironments {
  forDeclaration(declaration: Node): RustLexicalFunctionSelection | undefined;
}

const maximumLexicalFunctions = 65_536;
const maximumLexicalCaptureRows = 262_144;
const maximumLexicalCaptureSteps = 4_194_304;

export function createRustLexicalFunctionEnvironmentPlan(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  runtimeValueUses: RustRuntimeValueUsePlan,
  sourceCallables: RustSourceCallableQueries,
): RustLexicalFunctionEnvironmentPlan {
  const { ast, navigation } = source;
  const declarations: Node[] = [];
  const pending: Node[] = [...sourceFiles];
  let steps = 0;
  while (pending.length > 0) {
    if (++steps > maximumLexicalCaptureSteps) return exhausted();
    const node = pending.pop()!;
    if (ast.is.IsFunctionDeclaration(node) && !sourceDeclarationIsModuleScoped(node, ast) && ast.body(node) !== undefined ||
      sourceCallables.directLexicalBinding(node) !== undefined) {
      declarations.push(node);
      if (declarations.length > maximumLexicalFunctions) return exhausted();
    }
    ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  const captures = new Map<Node, Map<Node, RustLexicalFunctionCapture>>();
  const declarationSet = new Set(declarations);
  const callees = new Map<Node, readonly Node[]>();
  const genericNodes = new Map<Node, readonly Node[]>();
  let rows = 0;
  for (const declaration of declarations) {
    const roots = ast.is.IsArrowFunction(declaration) ? [ast.body(declaration)!,
      ...ast.parameters(declaration).flatMap(parameter => {
        const initializer = Node_Initializer(ast, parameter);
        return initializer === undefined ? [] : [initializer];
      })] : [declaration];
    const selected = sourceLexicalEnvironment(declaration, roots, ast, navigation,
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
    callees.set(declaration, Object.freeze(calls));
    const parameters = ast.parameters(declaration);
    if (parameters.some(parameter => parameter === undefined)) return exhausted("Lexical generic collection requires every exact authored parameter.");
    const nodes = new Set([...evaluated, declaration, ...parameters.filter(parameter => parameter !== undefined),
      ...[...values.values()].flatMap(capture => [capture.declaration, capture.reference])]);
    rows += nodes.size + calls.length;
    if (rows > maximumLexicalCaptureRows) return exhausted();
    genericNodes.set(declaration, Object.freeze([...nodes]));

    function mutate(expression: Node): void {
      const root = rustTypedLocationStorageRootReference(expression, ast, navigation);
      if (root !== undefined) mutationRoots.add(root.declaration);
    }
  }
  const selections = new Map<Node, RustLexicalFunctionEnvironmentSelection>();
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
    selections.set(declaration, Object.freeze({ kind: "resolved", captures: Object.freeze([...captures.get(declaration)!.values()]),
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
    valueDeclarationsAt: (statement: Node) => scheduled.get(statement) ?? empty,
    declarations: Object.freeze(declarations), genericNodesFor: (declaration: Node) => genericNodes.get(declaration) ?? empty,
    calleesFor: (declaration: Node) => callees.get(declaration) ?? empty });


  function exhausted(reason = "Lexical function capture analysis exceeded its finite resource budget."): RustLexicalFunctionEnvironmentPlan {
    const selection: RustLexicalFunctionEnvironmentSelection = Object.freeze({
      kind: "unresolved", reason,
    });
    return Object.freeze({ forDeclaration: (declaration: Node) =>
      ast.is.IsFunctionDeclaration(declaration) && !sourceDeclarationIsModuleScoped(declaration, ast) ||
        sourceCallables.directLexicalBinding(declaration) !== undefined ? selection : undefined,
      valueDeclarationsAt: () => Object.freeze([]), declarations: Object.freeze([]),
      genericNodesFor: () => Object.freeze([]), calleesFor: () => Object.freeze([]) });
  }
}

export function finalizeRustLexicalFunctionQueries(
  environments: RustLexicalFunctionEnvironmentPlan,
  source: TargetSourceProgram,
  facts: RustPlanQueries,
  lifetimes: RustLifetimeIndex,
  nativeStorage: RustNativeStoragePlan,
  native: RustNativeCallableInputPlan,
): RustLexicalFunctionQueries {
  const { ast } = source;
  const identities = new Map<Node, Set<string>>();
  const failures = new Map<Node, string>();
  const nativeIdentities = new Set(native.inputs.map(input => input.implementation.identity));
  const parametersFor = (owner: Node): readonly RustSourceGenericParameterContract[] =>
    [...lifetimes.contractFor(owner)?.parameters ?? [], ...rustCallableImplicitLifetimeParameters(owner, ast, facts)];
  let steps = 0;
  for (const declaration of environments.declarations) {
    const references = new Set<string>();
    for (const node of environments.genericNodesFor(declaration)) {
      if (++steps > maximumLexicalCaptureSteps) return exhausted();
      const parameter = ast.is.IsParameterDeclaration(node) ? facts.getFact(node, rustSourceParameterAbiFactKey)?.parameterCarrier : undefined;
      const carrier = parameter ?? facts.getRuntimeCarrierFact(node)?.carrier ??
        facts.getFact(node, rustSourceCallableReturnFactKey)?.returnCarrier;
      if (carrier === undefined) continue;
      const selected = parameter !== undefined ? nativeStorage.parameterFor(node, parameter)
        : facts.getFact(node, rustSourceCallableReturnFactKey) !== undefined ? nativeStorage.returnFor(node)
        : nativeStorage.valueFor(node);
      if (selected.kind === "unresolved") { failures.set(declaration, selected.reason); continue; }
      const generic = rustTargetGenericReferences(selected.carrier);
      for (const identity of [...generic.typeIdentities, ...generic.lifetimeIdentities]) {
        if (!nativeIdentities.has(identity)) references.add(identity);
      }
    }
    identities.set(declaration, references);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of environments.declarations) {
      for (const callee of environments.calleesFor(declaration)) {
        const bound = new Set(parametersFor(callee).map(parameter =>
          parameter.kind === "type" ? parameter.identity : rustLifetimeKey(parameter.lifetime)));
        for (const identity of identities.get(callee)!) {
          if (++steps > maximumLexicalCaptureSteps) return exhausted();
          if (!bound.has(identity) && !identities.get(declaration)!.has(identity)) {
            identities.get(declaration)!.add(identity);
            changed = true;
          }
        }
      }
    }
  }
  const selections = new Map<Node, RustLexicalFunctionSelection>();
  for (const declaration of environments.declarations) {
    const environment = environments.forDeclaration(declaration);
    if (environment === undefined) continue;
    if (environment.kind === "unresolved") { selections.set(declaration, environment); continue; }
    const own = new Set(parametersFor(declaration).map(parameter =>
      parameter.kind === "type" ? parameter.identity : rustLifetimeKey(parameter.lifetime)));
    const parameters = resolveRustEnclosingGenericParameters(declaration,
      [...identities.get(declaration)!].filter(identity => !own.has(identity)), ast, parametersFor);
    const failure = failures.get(declaration);
    selections.set(declaration, failure !== undefined || parameters === undefined
      ? Object.freeze({ kind: "unresolved", reason: failure ?? "A lexical function lost its exact enclosing generic or lifetime declarations." })
      : Object.freeze({ ...environment, genericParameters: parameters }));
  }
  return Object.freeze({ forDeclaration: (declaration: Node) => selections.get(declaration) ??
    unresolvedEnvironment(declaration), valueDeclarationsAt: environments.valueDeclarationsAt });

  function unresolvedEnvironment(declaration: Node): Extract<RustLexicalFunctionSelection, { readonly kind: "unresolved" }> | undefined {
    const environment = environments.forDeclaration(declaration);
    return environment?.kind === "unresolved" ? environment : undefined;
  }

  function exhausted(): RustLexicalFunctionQueries {
    const selection = Object.freeze({ kind: "unresolved" as const, reason: "Lexical physical generic selection exceeds its finite work budget." });
    return Object.freeze({ forDeclaration: (declaration: Node) => environments.forDeclaration(declaration) === undefined ? undefined : selection,
      valueDeclarationsAt: environments.valueDeclarationsAt });
  }
}
