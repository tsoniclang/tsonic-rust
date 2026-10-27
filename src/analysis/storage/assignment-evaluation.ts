import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, ElementAccessExpression_ArgumentExpression } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustAssignmentEvaluationProducer } from "../program/records/storage/assignment-evaluation.js";
import type { RustAssignmentEvaluation } from "../../target-model/records/storage/assignment-evaluation.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetOperationText } from "../../target-model/operations/text.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import { rustTargetOperationIsDirectLocation } from "../../policy/operations/members/native-contracts.js";
import { rustFinalizedSourceInputs } from "../../target-model/operations/finalized-inputs.js";
import type { RustFinalizedOperationAbi } from "../../target-model/records/operations/finalized-operation.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

function hasSharedIdentityReceiver(abi: RustFinalizedOperationAbi, carrier: TargetTypeRef): boolean {
  if (abi.sourceReceiver.kind !== "receiver" || abi.sourceReceiver.disposition !== "runtime") return false;
  const inputs = rustFinalizedSourceInputs(abi).filter(input => input.source.kind === "receiver");
  return inputs.length !== 0 && inputs.every(input => input.mode === "ref" && input.conversion.kind === "identity" &&
    rustTargetTypeRefEquals(input.sourceCarrier, carrier));
}

export function analyzeRustAssignmentEvaluation(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustAssignmentEvaluationProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    if (!ast.is.IsBinaryExpression(node) || program.records.nativeUnreachable.get(node) === true ||
      program.records.nativeParticipation.get(node) === "erased" || program.records.compileTimeSource.get(node) !== undefined) continue;
    const fact = program.records.targetOperation.get(node);
    const compound = (fact?.kind === "operator-token" || fact?.kind === "operator-call") && fact.operator !== "=" && isRustAssignmentOperator(fact.operator);
    if (!compound && fact?.kind !== "nullish-assignment") continue;
    let left = BinaryExpression_Left(ast, node);
    while (left !== undefined && ast.is.IsParenthesizedExpression(left)) left = Node_Expression(ast, left);
    const right = BinaryExpression_Right(ast, node);
    if (left === undefined || right === undefined || fact === undefined || !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, fact.resultCarrier)) {
      refuse(node, compound ? "rust.backend.compound-assignment-carrier" : "rust.backend.nullish-assignment-carrier", "An assignment value requires its exact finalized native operands and result carrier.");
      continue;
    }
    if (fact.kind === "nullish-assignment") {
      const selected = program.records.selectedOperation.get(node);
      if (selected?.operationId !== fact.operationId || selected.operationKind !== "operator" || selected.targetOperation !== rustTargetOperationText(fact) ||
        !rustTargetTypeRefEquals(selected.resultType, fact.resultCarrier)) { refuse(node, "rust.backend.nullish-assignment-carrier", "Nullish assignment requires its exact selected native operation."); continue; }
    }
    const write = program.records.assignmentWrite.get(node);
    if (write === undefined) { refuse(node, "rust.backend.assignment", "Assignments require an exact direct, promoted or module storage owner."); continue; }
    const valueField = write.valueField;
    const target = program.records.targetOperation.get(left);
    const receiver = target?.kind === "source-static-field" || target?.kind === "source-accessor" && target.receiver.kind === "static" ? undefined : Node_Expression(ast, left);
    const index = program.records.computedMember.get(left) === undefined && ast.is.IsElementAccessExpression(left) ? ElementAccessExpression_ArgumentExpression(ast, left) : undefined;
    const receiverCarrier = program.records.valueRead.get(receiver)?.value;
    const receiverRead = program.records.readOwnership.get(receiver);
    const setter = program.records.compoundWrite.get(node);
    const sharedReceiver = compound && receiverCarrier !== undefined && receiverRead?.readsStorage === true &&
      receiverRead.source.kind === "borrow" && !receiverRead.source.mutable && receiverRead.borrowedAcross.has(right) &&
      (index === undefined || receiverRead.borrowedAcross.has(index)) &&
      target?.kind === "provider-operation" && target.abi.result.kind === "sync" && setter !== undefined &&
      hasSharedIdentityReceiver(target.abi, receiverCarrier) && hasSharedIdentityReceiver(setter.abi, receiverCarrier);
    const operands: RustAssignmentEvaluation["operands"][number][] = [];
    if (!valueField) for (const operand of [receiver, index]) {
      if (operand === undefined) continue;
      const direct = compound && operand === receiver && rustTargetOperationIsDirectLocation(target) ? program.records.directStorage.get(operand) : undefined;
      const storage = sharedReceiver && operand === receiver ? "shared-reference"
        : direct === undefined || direct.kind === "unavailable" ? "value" : direct.kind === "identifier" || direct.kind === "this" ? "direct-identifier" : "direct";
      const carrier = compound && (storage === "value" || storage === "shared-reference")
        ? program.records.valueRead.get(operand)?.value : program.records.runtimeCarrier.get(operand)?.carrier;
      if (carrier === undefined) { refuse(operand, "rust.backend.assignment", "Assignment receiver evaluation requires its exact finalized native carrier."); continue; }
      operands.push(Object.freeze({ node: operand, carrier, role: operand === receiver ? "receiver" : "index", storage }));
    }
    const common = { left, right, operands: Object.freeze(operands) };
    if (fact.kind === "nullish-assignment") producer.publish(node, { ...common, kind: "nullish", fact, valueField, copy: isRustCopyCarrier(fact.rightCarrier),
      rightForm: rustTargetTypeRefEquals(fact.rightCarrier, program.records.valueRead.get(right)?.value) ? "value" : "before-context" });
    else if (fact.kind === "operator-token" || fact.kind === "operator-call") {
      const selection = program.records.assignmentValue.get(node);
      if (selection === undefined) { refuse(node, "rust.backend.compound-assignment-carrier", "A compound assignment requires its exact previous-value ownership."); continue; }
      let current: Extract<RustAssignmentEvaluation, { readonly kind: "compound" }>["current"];
      if (valueField) current = Object.freeze({ kind: "field" });
      else {
        const direct = program.records.directStorage.get(left);
        if (direct === undefined) { refuse(left, "rust.backend.compound-assignment-carrier", "A compound assignment requires its exact native place classification."); continue; }
        current = direct.kind === "unavailable" ? Object.freeze({ kind: "value" })
          : Object.freeze({ kind: "direct", ownership: selection.previous });
      }
      producer.publish(node, { ...common, kind: "compound", fact, current, copy: isRustCopyCarrier(fact.resultCarrier) });
    }
  }
  return Object.freeze(issues);
}
