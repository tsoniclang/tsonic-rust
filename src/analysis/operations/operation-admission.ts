import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustPolicySelection } from "../../policy/model/contracts.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import { rustSelectedTargetOperationEquals } from "../../target-model/records/operations/operation-equality.js";
import type { RustSelectedTargetOperation } from "../../target-model/records/operations/member-selections.js";
import type { RustOperationAnalysisContext } from "../program/operation-context.js";
import { rustTargetOperationFactEquals } from "../../target-model/records/operations/operation-equality.js";
import { rustPostCheckOperationKind } from "../../target-model/operations/model.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";

export function admitRustOperationSelection<T extends {
  readonly operation?: RustSelectedTargetOperation;
  readonly targetFact?: RustTargetOperationFact;
}>(subject: Node, selection: RustPolicySelection<T>, context: RustOperationAnalysisContext): RustPolicySelection<T> {
  context.records.assertOpen();
  if (selection.kind === "reject") return selection;
  const value = selection.value;
  if (value.targetFact !== undefined) requireRustRecord(context.requiredRecords, "targetOperation", subject,
    value.targetFact.kind, "admitRustOperationSelection");
  if (value.operation !== undefined && rustPostCheckOperationKind(value.operation.operationId) === undefined) {
    requireRustRecord(context.requiredRecords, "selectedOperation", subject,
      value.operation.operationKind, "admitRustOperationSelection");
  }
  const existingTarget = value.targetFact === undefined ? undefined : context.records.targetOperation.get(subject);
  const existingOperation = value.operation === undefined ? undefined : context.records.selectedOperation.get(subject);
  if (existingTarget !== undefined && value.targetFact !== undefined && !rustTargetOperationFactEquals(existingTarget, value.targetFact)) {
    failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'tsonic.rust.targetOperation' for one exact source subject.", subject);
  }
  if (existingOperation !== undefined && value.operation !== undefined && !rustSelectedTargetOperationEquals(existingOperation, value.operation)) {
    failTargetAnalysisInvariant("tsonic-rust", "Conflicting Rust semantic plan 'selectedOperation' for one exact source subject.", subject);
  }
  if (value.targetFact !== undefined && existingTarget === undefined) context.records.targetOperations.checked(subject, selection);
  if (value.operation !== undefined && existingOperation === undefined) context.records.selectedOperations.checked(subject, selection);
  if ((existingTarget === undefined || existingTarget === value.targetFact) &&
    (existingOperation === undefined || existingOperation === value.operation)) return selection;
  return { ...selection, value: { ...value,
    ...(existingTarget === undefined ? {} : { targetFact: existingTarget }),
    ...(existingOperation === undefined ? {} : { operation: existingOperation }),
  } };
}
