import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, ElementAccessExpression_ArgumentExpression } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustAssignmentEvaluationProducer } from "../program/records/assignment-evaluation.js";
import type { RustAssignmentEvaluation } from "../../target-model/records/assignment-evaluation.js";
import { isRustCopyCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetOperationText } from "../../target-model/operations/text.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import { rustTargetOperationIsDirectLocation } from "../../policy/operations/native-contracts.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustAssignmentEvaluation(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustAssignmentEvaluationProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
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
    const operands: RustAssignmentEvaluation["operands"][number][] = [];
    if (!valueField) for (const operand of [receiver, index]) {
      if (operand === undefined) continue;
      const direct = compound && operand === receiver && rustTargetOperationIsDirectLocation(target) ? program.records.directStorage.get(operand) : undefined;
      const storage = direct === undefined || direct.kind === "unavailable" ? "value" : direct.kind === "identifier" || direct.kind === "this" ? "direct-identifier" : "direct";
      const carrier = storage === "value" && compound ? rustEffectiveValueCarrier(program.records, operand) : program.records.runtimeCarrier.get(operand)?.carrier;
      if (carrier === undefined) { refuse(operand, "rust.backend.assignment", "Assignment receiver evaluation requires its exact finalized native carrier."); continue; }
      operands.push(Object.freeze({ node: operand, carrier, role: operand === receiver ? "receiver" : "index", storage }));
    }
    const common = { left, right, valueField, operands: Object.freeze(operands) };
    if (fact.kind === "nullish-assignment") producer.publish(node, { ...common, kind: "nullish", fact, copy: isRustCopyCarrier(fact.rightCarrier),
      rightForm: rustTargetTypeRefEquals(fact.rightCarrier, rustEffectiveValueCarrier(program.records, right)) ? "value" : "before-context" });
    else if (fact.kind === "operator-token" || fact.kind === "operator-call") producer.publish(node, { ...common, kind: "compound", fact, copy: isRustCopyCarrier(fact.resultCarrier) });
  }
  return Object.freeze(issues);
}
