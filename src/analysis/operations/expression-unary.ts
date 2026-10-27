import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { Node_Operand } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustUnaryEmissionProducer } from "../program/records/operations/expression-unary.js";
import type { RustUnaryUpdateEmission } from "../../target-model/records/operations/expression-unary.js";
import { isRustBigIntCarrier, isRustBoolCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetOperationText } from "../../target-model/operations/text.js";

export function analyzeRustUnaryEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustUnaryEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string, code = "RUST_MISSING_TARGET_FACT"): void => {
    issues.push({ code, category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    if (!ast.is.IsPrefixUnaryExpression(node) && !ast.is.IsPostfixUnaryExpression(node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "operator-token" && !(fact?.kind === "source-conversion" && fact.conversion === undefined)) continue;
    const operand = Node_Operand(ast, node);
    const selected = program.records.selectedOperation.get(node);
    if (operand === undefined || selected?.operationId !== fact.operationId || selected.operationKind !== "operator" ||
      !rustTargetTypeRefEquals(selected.resultType, fact.resultCarrier) || selected.targetOperation !== rustTargetOperationText(fact)) {
      refuse(node, "rust.backend.operator-selected-evidence", fact.kind === "source-conversion"
        ? "Unary identity operation conflicts with the TSTS-selected operator fact."
        : "Unary Rust operator fact conflicts with the TSTS-selected operator fact.");
      continue;
    }
    if (fact.kind === "source-conversion") {
      producer.publish(node, { kind: "identity", operand, literal: ast.is.IsNumericLiteral(operand), carrier: fact.resultCarrier });
      continue;
    }
    if (fact.operator === "-" || fact.operator === "!") {
      producer.publish(node, { kind: "unary", operand, literal: ast.is.IsNumericLiteral(operand), fact,
        booleanNot: fact.operator === "!" && isRustBoolCarrier(fact.resultCarrier) });
      continue;
    }
    if (fact.operator !== "+=" && fact.operator !== "-=") {
      refuse(node, "rust.backend.operator", `Unary operator '${fact.operator}' is only supported in statement position.`, "RUST_UNSUPPORTED_AST");
      continue;
    }
    const member = program.records.updateMember.get(operand);
    const field = program.records.updateProjectField.get(operand);
    let location: RustUnaryUpdateEmission["location"];
    if (program.records.compoundWrite.get(node) !== undefined) location = { kind: "runtime" };
    else if (program.records.fieldValueReceiver.get(operand) === true) location = { kind: "value-field" };
    else if (member !== undefined && member !== null) {
      const selection = program.records.selectedOperation.get(member.expression);
      if (selection?.operationId !== member.fact.operationId) {
        refuse(member.expression, "rust.backend.operator-selected-evidence", "Unary Rust operator fact conflicts with the TSTS-selected operator fact."); continue;
      }
      if (member.kind === "accessor" && (member.fact.read === undefined || member.fact.write === undefined ||
        !rustTargetTypeRefEquals(member.fact.read.resultCarrier, fact.resultCarrier))) {
        refuse(member.expression, "rust.backend.source-accessor-update", "Project accessor update requires exact selected getter, setter, and update carriers."); continue;
      }
      if (member.kind === "index" && (!member.fact.writable || program.records.indexedRecordAccess.get(member.expression) === undefined ||
        !rustTargetTypeRefEquals(member.fact.resultCarrier, fact.resultCarrier))) {
        refuse(member.expression, "rust.backend.project-index-update-contract", "Project index update requires exact writable index, key, value, and update facts."); continue;
      }
      location = member;
    } else if (field !== undefined && field !== null) location = { kind: "field", selection: field };
    else {
      const root = program.records.locationStorageRoot.get(operand);
      const direct = program.records.directStorage.get(operand);
      if (root !== undefined && root !== null) location = { kind: "promoted" };
      else if (direct !== undefined && direct.kind !== "unavailable") location = { kind: "direct" };
      else {
        refuse(node, "rust.backend.update-location", "Increment/decrement requires a finalized writable Rust location.", "RUST_UNSUPPORTED_AST");
        continue;
      }
    }
    producer.publish(node, { kind: "update", operand, fact, location,
      step: isRustBigIntCarrier(fact.resultCarrier) ? "bigint" : fact.resultCarrier.kind === "source-primitive" &&
        (fact.resultCarrier.name === "float32" || fact.resultCarrier.name === "float64") ? "float" : "integer",
      postfix: ast.is.IsPostfixUnaryExpression(node), directDiscard: ast.is.IsIdentifier(operand) });
  }
  return Object.freeze(issues);
}
