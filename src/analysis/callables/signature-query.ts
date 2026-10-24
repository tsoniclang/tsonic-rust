import type { Node } from "@tsonic/tsts";
import { Node_Type, sourceCallableValueParameters } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustAsyncFunctionFact, RustGeneratorFact, RustSourceParameterAbiFact } from "../../target-model/records/callables-and-resources.js";
import type { RustSourceCallableReturnFact } from "../../target-model/records/source-declarations.js";

import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustAsyncFunctionFactEquals, rustGeneratorFactEquals } from "../../target-model/records/equality.js";
import { rustCallableTargetType, rustCallableProtocol, rustClosureProtocol } from "../../target-model/types/carriers/callables.js";
import { rustCallableInvocationResult } from "../../policy/types/callables/return-contexts.js";
import { recordCallableParameterInputFacts, recordCallableParameterSignatureFacts } from "./parameter-signature.js";
import { recordRustParameterAbiSelection } from "./parameter-facts.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { requireDenseSourceNodes } from "../source-evidence/dense-nodes.js";
import { selectRustCallableSuspension } from "./suspension.js";
import type { RustCallableSuspensionSelection } from "./suspension.js";
import { recordRustSourceCallableReturn, selectRustCallableLogicalReturn } from "./source-callable-abi.js";
import { requireRustRecord } from "../program/records/required-records.js";
import { rustClassCallableMemberOwner, rustClassReceiverCarriers } from "../declarations/classes/receivers.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { rustRetainedEnvironment } from "./retained-values.js";
import type { RustRetainedEnvironment } from "../../target-model/records/retained-environments.js";

export interface RustCallableSignatureRequest {
  readonly parameterAbis?: readonly RustSourceParameterAbiFact[];
  readonly selectedReturn?: TargetTypeRef;
  readonly contextualResult?: TargetTypeRef;
  readonly ownedReceiver?: TargetTypeRef;
}

export interface RustCallableSignatureCompletion {
  readonly parameterAbis: readonly RustSourceParameterAbiFact[];
  readonly result: RustSourceCallableReturnFact;
  readonly logicalReturn: TargetTypeRef;
  readonly suspension?: RustAsyncFunctionFact | RustGeneratorFact;
  readonly callableValue?: TargetTypeRef;
}

export interface RustCallableSignatureState {
  active: boolean;
  inputActive: boolean;
  readonly completed: Map<string, RustCallableSignatureCompletion>;
  readonly suspensions: Map<string, RustCallableSuspensionSelection>;
}

export function finalizeRustCallableParameterAbis(
  walk: RustFactWalk, declaration: Node,
): readonly RustSourceParameterAbiFact[] | undefined {
  return recordCallableParameterInputFacts(walk, declaration);
}

function signatureRequestKey(request?: RustCallableSignatureRequest): string {
  return closedMetadataKey({ parameterAbis: request?.parameterAbis, selectedReturn: request?.selectedReturn,
    contextualResult: request?.contextualResult, ownedReceiver: request?.ownedReceiver });
}

export function finalizeRustCallableSignature(
  walk: RustFactWalk, declaration: Node, request?: RustCallableSignatureRequest,
): RustCallableSignatureCompletion | undefined {
  const { records } = walk.context;
  records.assertOpen();
  const key = signatureRequestKey(request);
  let state = walk.callableSignatures.get(declaration);
  const cached = state?.completed.get(key);
  if (cached !== undefined) return cached;
  if (state?.active) return undefined;
  if (state === undefined) {
    state = { active: false, inputActive: false, completed: new Map(), suspensions: new Map() };
    walk.callableSignatures.set(declaration, state);
  }
  state.active = true;
  // A class member body reads `this` and `super` as its own class, whichever walk requests its signature.
  const classOwner = rustClassCallableMemberOwner(walk, declaration);
  const previousThis = walk.currentThisCarrier;
  const previousSuper = walk.currentSuperCarrier;
  if (classOwner !== undefined) {
    const receivers = rustClassReceiverCarriers(walk, classOwner);
    walk.currentThisCarrier = receivers?.thisCarrier;
    walk.currentSuperCarrier = receivers?.superCarrier;
  }
  try {
    const { ast } = walk.context;
    const parameters = requireDenseSourceNodes(walk,
      sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration)),
      "Function declaration contains an undefined or non-data parameter slot.");
    if (parameters === undefined || request?.parameterAbis !== undefined &&
      request.parameterAbis.length !== parameters.length) return undefined;
    let contextualResult = request?.contextualResult;
    if (request?.parameterAbis === undefined) {
      if (finalizeRustCallableParameterAbis(walk, declaration) === undefined) return undefined;
      const contextual = recordCallableParameterSignatureFacts(walk, declaration);
      contextualResult ??= (rustCallableProtocol(contextual) ?? rustClosureProtocol(contextual))?.result;
    } else {
      for (const [index, parameter] of parameters.entries()) {
        const selected = request.parameterAbis[index];
        if (selected === undefined || !recordRustParameterAbiSelection(walk, parameter, selected)) return undefined;
      }
    }
    const parameterAbis: RustSourceParameterAbiFact[] = [];
    for (const parameter of parameters) {
      const selected = records.sourceParameterAbi.get(parameter);
      if (selected === undefined) return undefined;
      parameterAbis.push(selected);
    }
    const suspensionKey = closedMetadataKey({ parameterAbis, contextualResult, ownedReceiver: request?.ownedReceiver });
    let suspension = state.suspensions.get(suspensionKey);
    if (suspension === undefined) {
      suspension = selectRustCallableSuspension(walk, declaration, request?.ownedReceiver, contextualResult);
      if (suspension === undefined) return undefined;
      state.suspensions.set(suspensionKey, suspension);
    }
    const retained = suspension.kind === "none"
      ? rustRetainedEnvironment(declaration, parameterAbis.map(parameter => parameter.parameterCarrier), walk.context)
      : suspension.retainedEnvironment === undefined ? { kind: "none" as const }
        : { kind: "selected" as const, environment: suspension.retainedEnvironment };
    if (retained.kind === "unresolved") {
      appendRustDiagnostic(walk, "RUST_RETAINED_ENVIRONMENT_NOT_EXACT", retained.reason, declaration,
        ["target.capability=rust.callable.retained-environment"]);
      return undefined;
    }
    admitCallableState(walk, declaration, suspension, retained.kind === "selected" ? retained.environment : undefined);
    const suspendedReturn = suspension.kind === "async" ? suspension.fact.outputCarrier
      : suspension.kind === "generator" ? suspension.fact.resultCarrier : undefined;
    if (suspendedReturn !== undefined && request?.selectedReturn !== undefined &&
      !rustTargetTypeRefEquals(suspendedReturn, request.selectedReturn)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.sourceCallableReturn' for one exact selected logical result.", declaration);
    }
    const logical = selectRustCallableLogicalReturn(walk, declaration, suspendedReturn ?? request?.selectedReturn);
    if (logical.kind === "pending") return undefined;
    if (!recordRustSourceCallableReturn(walk, declaration, logical.carrier)) return undefined;
    const result = records.sourceCallableReturn.get(declaration);
    if (result === undefined) return undefined;
    const invocation = rustCallableInvocationResult(records, declaration);
    const callableValue = invocation !== undefined && ast.body(declaration) !== undefined &&
      (ast.is.IsFunctionDeclaration(declaration) || ast.is.IsArrowFunction(declaration) || ast.is.IsFunctionExpression(declaration)) &&
      ast.typeParameters(declaration).length === 0
      ? rustCallableTargetType(parameterAbis.map(parameter => parameter.parameterCarrier), invocation) : undefined;
    const completed = Object.freeze({ parameterAbis: Object.freeze(parameterAbis), result, logicalReturn: logical.carrier,
      ...(callableValue === undefined ? {} : { callableValue }),
      ...(suspension.kind === "none" ? {} : { suspension: suspension.kind === "async"
        ? records.asyncFunction.get(declaration)! : records.generator.get(declaration)! }),
    });
    state.completed.set(key, completed);
    return completed;
  } finally {
    state.active = false;
    walk.currentThisCarrier = previousThis;
    walk.currentSuperCarrier = previousSuper;
  }
}

function admitCallableState(walk: RustFactWalk, declaration: Node, selection: RustCallableSuspensionSelection,
  retained: RustRetainedEnvironment | undefined): void {
  const { records, ast } = walk.context;
  if (retained !== undefined) {
    requireRustRecord(walk.context.requiredRecords, "retainedEnvironment", declaration,
      "native callable environment", "admitCallableState");
    records.retainedEnvironments.retain(declaration, retained.lifetime, retained.inputs);
  }
  if (selection.kind === "none") return;
  requireRustRecord(walk.context.requiredRecords, selection.kind === "async" ? "asyncFunction" : "generator",
    declaration, selection.fact.kind, "admitCallableState");
  const asynchronous = records.asyncFunction.get(declaration);
  const generator = records.generator.get(declaration);
  if (selection.kind === "async" ? generator !== undefined || asynchronous !== undefined &&
    !rustAsyncFunctionFactEquals(asynchronous, selection.fact) : asynchronous !== undefined || generator !== undefined &&
    !rustGeneratorFactEquals(generator, selection.fact)) {
    failTargetAnalysisInvariant("tsonic-rust",
      `Conflicting Rust semantic plan 'tsonic.rust.${selection.kind === "async" ? "asyncFunction" : "generator"}' for one exact source subject.`, declaration);
  }
  if (selection.kind === "async") {
    if (asynchronous === undefined) {
      if (selection.fact.kind === "native-future") records.asyncFunctions.native(declaration, selection.fact.outputCarrier);
      else records.asyncFunctions.promise(declaration, selection.fact.futureCarrier, selection.fact.outputCarrier,
        selection.fact.lowering);
    }
  } else {
    if (generator === undefined) records.generators.suspend(declaration, selection.fact, selection.fact);
    const typeNode = Node_Type(ast, declaration);
    if (typeNode !== undefined) setCarrierFact(walk, typeNode, selection.sourceCarrier);
  }
}

export function resolveRustCallableSignatureCarrier(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
  walk.context.records.assertOpen();
  const cached = walk.callableSignatures.get(declaration)?.completed.get(signatureRequestKey());
  if (cached !== undefined) return cached.callableValue;
  const { ast } = walk.context;
  if (walk.callableSignatures.get(declaration)?.active || ast.body(declaration) === undefined ||
    !ast.is.IsFunctionDeclaration(declaration) && !ast.is.IsArrowFunction(declaration) && !ast.is.IsFunctionExpression(declaration) ||
    ast.typeParameters(declaration).length !== 0) return undefined;
  return finalizeRustCallableSignature(walk, declaration)?.callableValue;
}
