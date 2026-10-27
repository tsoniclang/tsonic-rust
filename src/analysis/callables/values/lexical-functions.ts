import type { Node } from "@tsonic/tsts";
import { createSourceSingleInvocationQuery, forEachSourceImmediateEvaluationChild, Node_Initializer, sourceDeclarationIsModuleScoped, sourceLexicalEnvironment, sourceLexicalFunctionValueCreation, sourceLexicalFunctionValueOrder, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";

import { rustTypedLocationStorageRootReference } from "../../operations/typed-locations.js";
import { rustFinalizedTargetInputMayMutateSource } from "../../../target-model/operations/finalized-inputs.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import type { RustLifetimeIndex, RustSourceGenericParameterContract } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import { resolveRustEnclosingGenericParameters } from "../generics/generic-environment.js";

import type { RustRuntimeValueUsePlan } from "../../program/runtime-value-uses.js";
import type { RustSourceCallableQueries } from "../../../target-model/records/source-callables.js";
import { rustCallableImplicitLifetimeParameters } from "../ownership/source-input-lifetimes.js";

import type { RustNativeStorageConstruction } from "../storage/native-storage.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";

import type { RustLexicalFunctionCapture, RustLexicalFunctionEnvironmentSelection, RustLexicalFunctionSelection, RustLexicalFunctionEnvironmentPlan, RustLexicalFunctionQueries } from "../../../target-model/records/lexical-functions.js";
import { sealRustLexicalFunctionEnvironments, sealRustLexicalFunctionQueries } from "../../program/records/lexical-functions.js";

const maximumLexicalFunctions = 65_536;
const maximumLexicalCaptureRows = 262_144;
const maximumLexicalCaptureSteps = 4_194_304;

export function createRustLexicalFunctionEnvironmentPlan(
  source: TargetSourceProgram,
  nativeNodes: readonly Node[],
  records: RustProgramRecords,
  runtimeValueUses: RustRuntimeValueUsePlan,
  sourceCallables: RustSourceCallableQueries,
): RustLexicalFunctionEnvironmentPlan {
  const { ast, navigation } = source;
  const declarations: Node[] = [];
  let steps = 0;
  for (const node of nativeNodes) {
    if (++steps > maximumLexicalCaptureSteps) return exhausted();
    if (ast.is.IsFunctionDeclaration(node) && !sourceDeclarationIsModuleScoped(node, ast) && ast.body(node) !== undefined ||
      sourceCallables.directLexicalBinding(node) !== undefined) {
      declarations.push(node);
      if (declarations.length > maximumLexicalFunctions) return exhausted();
    }
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
    const selected = sourceLexicalEnvironment(declaration, roots, ast, navigation, "source",
      (use, referencedDeclaration) => records.compileTimeSource.get(use.reference) !== true &&
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
      const passing = records.argumentPassing.get(node);
      if (passing?.mode === "borrow-mut") mutate(passing.storageExpression ?? node);
      const operation = records.targetOperation.get(node);
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
      (use, referencedDeclaration) => records.compileTimeSource.get(use.reference) !== true &&
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
  const scheduled = new Map<Node, readonly Node[]>();
  for (const [statement, values] of valueDeclarations) {
    const ordered = sourceLexicalFunctionValueOrder(values, ast, navigation, "source",
      (use, referencedDeclaration) => records.compileTimeSource.get(use.reference) !== true &&
        runtimeValueUses.isRuntimeReference(referencedDeclaration, use.reference));
    if (ordered.kind === "resolved") scheduled.set(statement, ordered.declarations);
    else for (const declaration of values) selections.set(declaration, Object.freeze(ordered));
  }
  return sealRustLexicalFunctionEnvironments(declarations, selections, scheduled, genericNodes, callees);

  function exhausted(reason = "Lexical function capture analysis exceeded its finite resource budget."): RustLexicalFunctionEnvironmentPlan {
    const selection: RustLexicalFunctionEnvironmentSelection = Object.freeze({
      kind: "unresolved", reason,
    });
    const failures = new Map<Node, RustLexicalFunctionEnvironmentSelection>();
    for (const declaration of nativeNodes) if (
      ast.is.IsFunctionDeclaration(declaration) && !sourceDeclarationIsModuleScoped(declaration, ast) ||
      sourceCallables.directLexicalBinding(declaration) !== undefined) failures.set(declaration, selection);
    return sealRustLexicalFunctionEnvironments([], failures, new Map(), new Map(), new Map());
  }
}

export function finalizeRustLexicalFunctionQueries(
  environments: RustLexicalFunctionEnvironmentPlan,
  source: TargetSourceProgram,
  records: RustProgramRecords,
  lifetimes: RustLifetimeIndex,
  nativeStorage: RustNativeStorageConstruction,
  native: RustNativeCallableInputPlan,
): RustLexicalFunctionQueries {
  const { ast } = source;
  const identities = new Map<Node, Set<string>>();
  const failures = new Map<Node, string>();
  const nativeIdentities = new Set(native.inputs.map(input => input.implementation.identity));
  const parametersFor = (owner: Node): readonly RustSourceGenericParameterContract[] =>
    [...lifetimes.contractFor(owner)?.parameters ?? [], ...rustCallableImplicitLifetimeParameters(owner, ast, records)];
  let steps = 0;
  for (const declaration of environments.declarations) {
    const references = new Set<string>();
    const future = nativeStorage.futureEnvironmentFor(declaration);
    if (future.kind === "unresolved") {
      failures.set(declaration, future.reason);
      identities.set(declaration, references);
      continue;
    }
    const futureIdentities = new Set([...future.inputs, ...future.captures].map(input => input.implementation.identity));
    for (const node of environments.genericNodesFor(declaration)) {
      if (++steps > maximumLexicalCaptureSteps) return exhausted();
      const parameter = ast.is.IsParameterDeclaration(node) ? records.sourceParameterAbi.get(node)?.parameterCarrier : undefined;
      const carrier = parameter ?? records.runtimeCarrier.get(node)?.carrier ??
        records.sourceCallableReturn.get(node)?.returnCarrier;
      if (carrier === undefined) continue;
      const selected = parameter !== undefined ? nativeStorage.parameterFor(node)
        : records.sourceCallableReturn.get(node) !== undefined ? nativeStorage.prepareReturn(node)
        : nativeStorage.valueFor(node);
      if (selected.kind === "unresolved") { failures.set(declaration, selected.reason); continue; }
      const generic = rustTargetGenericReferences(selected.carrier);
      for (const identity of [...generic.typeIdentities, ...generic.lifetimeIdentities]) {
        if (!nativeIdentities.has(identity) && !futureIdentities.has(identity)) references.add(identity);
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
  for (const declaration of environments.subjects) {
    const selected = environments.forDeclaration(declaration);
    if (selected?.kind === "unresolved") selections.set(declaration, selected);
  }
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
  return sealRustLexicalFunctionQueries(selections, environments.valueDeclarationsAt, environments.calleesFor);

  function exhausted(): RustLexicalFunctionQueries {
    const selection = Object.freeze({ kind: "unresolved" as const, reason: "Lexical physical generic selection exceeds its finite work budget." });
    return sealRustLexicalFunctionQueries(new Map(environments.subjects.map(declaration => [declaration, selection])),
      environments.valueDeclarationsAt, environments.calleesFor);
  }
}
