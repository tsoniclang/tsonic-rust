import { type Node } from "@tsonic/tsts";
import { type RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import { rustTargetOperationResultCarrier } from "../../../../target-model/records/operations/operation-result-carriers.js";
import { type TargetTypeRef } from "../../../../target-model/types/model.js";
import { type RustSelectedTargetOperation } from "../../../../target-model/records/operations/member-selections.js";
import { rustTargetOperationText } from "../../../../target-model/operations/text.js";
import type { RustCheckedElementSelectionInput, RustCheckedOperatorSelectionInput } from "../../../../policy/model/contracts.js";
import { rustPostCheckBinaryOperationId, rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId } from "../../../../target-model/operations/model.js";
import { acceptRustPolicy, type RustCheckedOperationSelectionResult, type RustPolicySelection, type RustTargetOperationSelection } from "../../../../policy/model/contracts.js";

export function rustSelectedOperatorOperation(
  subject: Node, fact: RustTargetOperationFact, resultType: TargetTypeRef,
): RustSelectedTargetOperation {
  return { operationId: fact.operationId, operationKind: "operator",
    targetOperation: rustTargetOperationText(fact), resultType, provenance: { sourceExpression: subject } };
}

export function acceptRustOperation(
  fact: RustTargetOperationFact,
  provenance: NonNullable<RustTargetOperationSelection["provenance"]>,
  resultType: TargetTypeRef | undefined = rustTargetOperationResultCarrier(fact),
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const evidence = [{ message: `rust selected operation ${fact.operationId}` }];
  const operation: RustTargetOperationSelection = {
    operationId: fact.operationId,
    operationKind: genericOperationKind(fact),
    targetOperation: rustTargetOperationText(fact),
    ...(resultType === undefined ? {} : { resultType }),
    provenance,
  };
  return acceptRustPolicy({
    targetFact: fact,
    operation,
    ...(resultType === undefined ? {} : { resultType }),
    provenance,
  }, evidence);
}

export function acceptDeclarationOperation(
  operationKind: RustTargetOperationSelection["operationKind"],
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  return acceptRustPolicy({
    operation: genericOperation(`tsonic.rust.declaration.${operationKind}`, operationKind, "declaration-only"),
  }, [{ message: "rust declaration-only checked operation" }]);
}

export function elementProvenance(request: RustCheckedElementSelectionInput): NonNullable<RustTargetOperationSelection["provenance"]> {
  return {
    sourceExpression: request.expression,
    sourceReceiver: request.receiver,
    sourceSelectedSymbol: request.sourceSelectedSymbol,
    sourceSelectedDeclaration: request.sourceSelectedDeclaration,
    sourceResultType: request.sourceResultType,
  };
}

function genericOperation(
  operationId: string,
  operationKind: RustTargetOperationSelection["operationKind"],
  targetOperation: string,
): RustTargetOperationSelection {
  return { operationId, operationKind, targetOperation };
}

function genericOperationKind(fact: RustTargetOperationFact): RustTargetOperationSelection["operationKind"] {
  switch (fact.kind) {
    case "provider-operation":
      return fact.abi.operationKind;
    case "tuple-index":
    case "fixed-index":
    case "source-index-signature":
    case "source-indexed-field":
      return "indexer";
    case "source-field":
    case "builtin-error-property":
    case "source-method-property":
    case "source-static-field":
    case "source-accessor":
    case "source-union-field":
    case "union-property":
    case "source-enum-member":
      return "property";
    case "iteration":
      return "iteration";
    default:
      return "operator";
  }
}

export function acceptPostCheckOperator(
  request: RustCheckedOperatorSelectionInput,
): RustPolicySelection<RustCheckedOperationSelectionResult> {
  const unaryOperationId = request.right === undefined
    ? request.operator === "-"
      ? rustPostCheckUnaryMinusOperationId
      : request.operator === "+"
        ? rustPostCheckUnaryPlusOperationId
        : undefined
    : undefined;
  const operationId = unaryOperationId ?? rustPostCheckBinaryOperationId;
  const provenance: NonNullable<RustTargetOperationSelection["provenance"]> = {
    sourceExpression: request.expression,
    sourceReceiver: request.left,
    ...(request.right === undefined ? {} : { sourceResultType: request.right }),
  };
  return acceptRustPolicy({
    operation: {
      operationId,
      operationKind: "operator",
      targetOperation: unaryOperationId === rustPostCheckUnaryMinusOperationId
        ? "-"
        : unaryOperationId === rustPostCheckUnaryPlusOperationId
          ? unaryOperationId
          : "post-check-finalization",
      provenance,
    },
    provenance,
  }, [{ message: "rust retained the TSTS-checked operator for post-check carrier finalization" }]);
}
