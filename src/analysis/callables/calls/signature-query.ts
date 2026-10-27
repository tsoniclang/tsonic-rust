import type { Node } from "@tsonic/tsts";
import { Node_Type, sourceCallableValueParameters } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustAsyncFunctionFact, RustGeneratorFact, RustSourceParameterAbiFact } from "../../../target-model/records/callables-and-resources.js";
import type { RustSourceCallableReturnFact } from "../../../target-model/records/source-declarations.js";

import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { rustAsyncFunctionFactEquals, rustGeneratorFactEquals } from "../../../target-model/records/equality.js";
import { rustCallableTargetType, rustCallableProtocol, rustClosureProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustCallableInvocationResult } from "../../../policy/types/callables/return-contexts.js";
import { recordCallableParameterInputFacts, recordCallableParameterSignatureFacts } from "../values/parameter-signature.js";
import { recordRustParameterAbiSelection } from "../values/parameter-facts.js";
import { setCarrierFact } from "../../operations/project-calls.js";
import { requireDenseSourceNodes } from "../../source-evidence/dense-nodes.js";
import { selectRustCallableSuspension } from "../async/suspension.js";
import type { RustCallableSuspensionSelection } from "../async/suspension.js";
import { recordRustSourceCallableReturn, selectRustCallableLogicalReturn } from "./source-callable-abi.js";
import { requireRustRecord } from "../../program/records/required-records.js";
import { rustClassCallableMemberOwner, rustClassReceiverCarriers } from "../../declarations/classes/receivers.js";

export interface RustCallableSignatureRequest {
  readonly parameterAbis?: readonly RustSourceParameterAbiFact[];
  readonly selectedReturn?: TargetTypeRef;
  readonly contextualResult?: TargetTypeRef;
  readonly ownedReceiver?: TargetTypeRef;
}

export interface RustCallableSignatureCompletion {
  readonly kind: "complete";
  readonly parameterAbis: readonly RustSourceParameterAbiFact[];
  readonly result: RustSourceCallableReturnFact;
  readonly logicalReturn: TargetTypeRef;
  readonly suspension?: RustAsyncFunctionFact | RustGeneratorFact;
  readonly callableValue?: TargetTypeRef;
}

export interface RustCallableSignatureUnresolved {
  readonly kind: "unresolved";
  readonly sourceNode: Node;
  readonly reason: string;
}

export type RustCallableSignatureSelection = RustCallableSignatureCompletion | RustCallableSignatureUnresolved;

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

function unresolvedSignature(sourceNode: Node, reason: string): RustCallableSignatureUnresolved {
  return Object.freeze({ kind: "unresolved", sourceNode, reason });
}

export function finalizeRustCallableSignature(
  walk: RustFactWalk, declaration: Node, request?: RustCallableSignatureRequest,
): RustCallableSignatureSelection {
  const { records } = walk.context;
  records.assertOpen();
  const key = signatureRequestKey(request);
  let state = walk.callableSignatures.get(declaration);
  const cached = state?.completed.get(key);
  if (cached !== undefined) return cached;
  if (state?.active) return unresolvedSignature(declaration, "The same checked callable signature is already being completed.");
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
    if (parameters === undefined) return unresolvedSignature(declaration,
      "The checked callable value-parameter vector is not dense declaration-owned source metadata.");
    if (request?.parameterAbis !== undefined && request.parameterAbis.length !== parameters.length)
      return unresolvedSignature(declaration,
        `The selected native input ABI vector has ${request.parameterAbis.length} entries for ${parameters.length} checked value parameters.`);
    let contextualResult = request?.contextualResult;
    if (request?.parameterAbis === undefined) {
      if (finalizeRustCallableParameterAbis(walk, declaration) === undefined) {
        const missing = parameters.filter(parameter => records.sourceParameterAbi.get(parameter) === undefined).map(parameter => {
          const name = ast.name(parameter);
          const type = Node_Type(ast, parameter);
          return `${name === undefined ? ast.kindName(parameter) : ast.text(name)} (${type === undefined ? "contextual checked type" : ast.kindName(type)})`;
        });
        return unresolvedSignature(declaration, "The native callable input stage did not complete; " +
          (missing.length === 0 ? "its checked parameter contracts are not closed."
            : `unadmitted original parameter ABIs: ${missing.join(", ")}.`));
      }
      const contextual = recordCallableParameterSignatureFacts(walk, declaration);
      contextualResult ??= (rustCallableProtocol(contextual) ?? rustClosureProtocol(contextual))?.result;
    } else {
      for (const [index, parameter] of parameters.entries()) {
        const selected = request.parameterAbis[index];
        if (selected === undefined) return unresolvedSignature(parameter,
          "The selected native callable input vector has no ABI at this original value-parameter position.");
        if (!recordRustParameterAbiSelection(walk, parameter, selected)) return unresolvedSignature(parameter,
          "The selected native callable input ABI could not be admitted for its original value parameter.");
      }
    }
    const parameterAbis: RustSourceParameterAbiFact[] = [];
    for (const parameter of parameters) {
      const selected = records.sourceParameterAbi.get(parameter);
      if (selected === undefined) return unresolvedSignature(parameter,
        "Callable signature completion requires this original value parameter's admitted native ABI.");
      parameterAbis.push(selected);
    }
    const suspensionKey = closedMetadataKey({ parameterAbis, contextualResult, ownedReceiver: request?.ownedReceiver });
    let suspension = state.suspensions.get(suspensionKey);
    if (suspension === undefined) {
      suspension = selectRustCallableSuspension(walk, declaration, request?.ownedReceiver, contextualResult);
      if (suspension === undefined) return unresolvedSignature(declaration,
        "The native callable suspension contract is unresolved for its exact selected inputs and contextual result.");
      state.suspensions.set(suspensionKey, suspension);
    }
    admitSuspension(walk, declaration, suspension);
    const suspendedReturn = suspension.kind === "async" ? suspension.fact.outputCarrier
      : suspension.kind === "generator" ? suspension.fact.resultCarrier : undefined;
    if (suspendedReturn !== undefined && request?.selectedReturn !== undefined &&
      !rustTargetTypeRefEquals(suspendedReturn, request.selectedReturn)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.sourceCallableReturn' for one exact selected logical result.", declaration);
    }
    const logical = selectRustCallableLogicalReturn(walk, declaration, suspendedReturn ?? request?.selectedReturn);
    if (logical.kind === "pending") return unresolvedSignature(declaration,
      "The checked callable logical return is pending its native body dependencies; no return fact was published.");
    const diagnosticStart = walk.context.diagnostics.length;
    if (!recordRustSourceCallableReturn(walk, declaration, logical.carrier)) {
      const diagnostic = walk.context.diagnostics.slice(diagnosticStart).find(issue => issue.category === "error");
      return unresolvedSignature(diagnostic?.sourceNode ?? declaration,
        diagnostic?.message ?? "The selected callable logical result has no completed native return and retained-environment contract.");
    }
    const result = records.sourceCallableReturn.get(declaration);
    if (result === undefined) return unresolvedSignature(declaration,
      "The native callable return producer completed without publishing its required original declaration record.");
    const invocation = rustCallableInvocationResult(records, declaration);
    const callableValue = invocation !== undefined && ast.body(declaration) !== undefined &&
      (ast.is.IsFunctionDeclaration(declaration) || ast.is.IsArrowFunction(declaration) || ast.is.IsFunctionExpression(declaration)) &&
      ast.typeParameters(declaration).length === 0
      ? rustCallableTargetType(parameterAbis.map(parameter => parameter.parameterCarrier), invocation) : undefined;
    const completed = Object.freeze({ kind: "complete" as const, parameterAbis: Object.freeze(parameterAbis), result, logicalReturn: logical.carrier,
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

function admitSuspension(walk: RustFactWalk, declaration: Node, selection: RustCallableSuspensionSelection): void {
  if (selection.kind === "none") return;
  const { records, ast } = walk.context;
  if (selection.retainedEnvironment !== undefined) {
    requireRustRecord(walk.context.requiredRecords, "retainedEnvironment", declaration,
      "native callable environment", "admitSuspension");
    records.retainedEnvironments.retain(declaration,
      selection.retainedEnvironment.lifetime, selection.retainedEnvironment.inputs);
  }
  requireRustRecord(walk.context.requiredRecords, selection.kind === "async" ? "asyncFunction" : "generator",
    declaration, selection.fact.kind, "admitSuspension");
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
  const selected = finalizeRustCallableSignature(walk, declaration);
  return selected.kind === "complete" ? selected.callableValue : undefined;
}
