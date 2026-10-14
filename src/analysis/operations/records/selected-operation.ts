import type { ExtensionFactSubject, Node } from "@tsonic/tsts";
import type { RustPolicySelection } from "../../../policy/operations/contracts.js";
import { rustPostCheckOperationKind } from "../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustSelectedTargetOperation, TargetTypeRef } from "../../../target-model/types/model.js";
import { rustSelectedTargetOperationEquals } from "../../../target-model/types/equality.js";
import { maximumRustFoundation, type RustFoundation } from "../../../target-model/foundation/model.js";
import { rustFoundationForSelectedOperation } from "../../foundation/requirements.js";
import { rustTargetOperationText } from "../target-operation.js";
import type { RustOperationAnalysisContext } from "../../program/operation-context.js";
import type { RustCheckedCallSelectionInput, RustCheckedCallSelectionResult } from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "../provider/model.js";
import { resolveRustCheckedCall } from "../provider/calls/selection.js";
import { resolveRustPreparedCheckedCall, type RustPreparedDeferredCheckedCall } from "../provider/calls/deferred.js";

export function selectRustCheckedCall(
  request: RustCheckedCallSelectionInput,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const selection = resolveRustCheckedCall(request, context, options);
  context.records.selectedOperations.checked(request.source.call, selection);
  return selection;
}

export function finalizeRustPreparedCheckedCall(
  request: RustCheckedCallSelectionInput,
  prepared: RustPreparedDeferredCheckedCall,
  callbackFallible: boolean,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
): RustPolicySelection<RustCheckedCallSelectionResult> {
  const selection = resolveRustPreparedCheckedCall(request, prepared, callbackFallible, context, options);
  context.records.selectedOperations.checked(request.source.call, selection);
  return selection;
}

export interface RustSelectedOperationProducer {
  readonly records: RustRecordFamily<RustSelectedTargetOperation>;
  checked<T extends { readonly operation?: RustSelectedTargetOperation }>(
    subject: ExtensionFactSubject,
    selection: RustPolicySelection<T>,
  ): ReturnType<typeof rustPostCheckOperationKind>;
  operator(subject: Node, fact: RustTargetOperationFact, resultType: TargetTypeRef): void;
  project(
    subject: Node,
    operationId: string,
    operationKind: RustSelectedTargetOperation["operationKind"],
    targetOperation: string,
    resultType: TargetTypeRef,
  ): void;
  minimumFoundation(): RustFoundation;
  seal(): void;
}

export function createRustSelectedOperationProducer(
  inherited?: RustRecordFamily<RustSelectedTargetOperation>,
): RustSelectedOperationProducer {
  const values = new WeakMap<ExtensionFactSubject, RustSelectedTargetOperation>();
  let sealed = false;
  let foundation: RustFoundation = "core";
  const get = (subject: ExtensionFactSubject | undefined): RustSelectedTargetOperation | undefined =>
    subject === undefined ? undefined : values.get(subject) ?? inherited?.get(subject);
  const records = Object.freeze({ get });
  const assertOpen = (): void => {
    if (sealed) throw new Error("Rust semantic plans cannot be written after analysis is sealed.");
  };
  const admit = (subject: ExtensionFactSubject, operation: RustSelectedTargetOperation): void => {
    assertOpen();
    const existing = get(subject);
    if (existing !== undefined && !rustSelectedTargetOperationEquals(existing, operation)) {
      throw new Error("Conflicting Rust semantic plan 'selectedOperation' for one exact source subject.");
    }
    if (existing === undefined) values.set(subject, operation);
    foundation = maximumRustFoundation(foundation, rustFoundationForSelectedOperation(operation));
  };
  return Object.freeze({
    records,
    checked<T extends { readonly operation?: RustSelectedTargetOperation }>(
      subject: ExtensionFactSubject,
      selection: RustPolicySelection<T>,
    ): ReturnType<typeof rustPostCheckOperationKind> {
      assertOpen();
      if (selection.kind !== "accept" || selection.value.operation === undefined) return undefined;
      const deferred = rustPostCheckOperationKind(selection.value.operation.operationId);
      if (deferred !== undefined) return deferred;
      admit(subject, selection.value.operation);
      return undefined;
    },
    operator(subject: Node, fact: RustTargetOperationFact, resultType: TargetTypeRef): void {
      admit(subject, {
        operationId: fact.operationId,
        operationKind: "operator",
        targetOperation: rustTargetOperationText(fact),
        resultType,
        provenance: { sourceExpression: subject },
      });
    },
    project(
      subject: Node,
      operationId: string,
      operationKind: RustSelectedTargetOperation["operationKind"],
      targetOperation: string,
      resultType: TargetTypeRef,
    ): void {
      admit(subject, { operationId, operationKind, targetOperation, resultType });
    },
    minimumFoundation(): RustFoundation { return foundation; },
    seal(): void {
      assertOpen();
      sealed = true;
    },
  });
}
