import { rustCaughtErrorPhysicalView } from "../errors/catching-try.js";
import type { Node } from "@tsonic/tsts";
import { Node_Expression, BinaryExpression_Left, BinaryExpression_Right, forEachSourceImmediateEvaluationChild } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustErrorFieldProducer } from "../program/records/error-field-borrows.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";
import type { RustErrorFieldEmission } from "../../target-model/records/error-field-borrows.js";
import { rustJsErrorTargetType, isRustProgramErrorCarrier, rustSourceOptionalTargetType, rustStringTargetType } from "../../target-model/types/index.js";
import { isRustClosedValueCarrier } from "../../target-model/types/carriers/closed-value-kind.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCarrierProvidesErrorObservation } from "../../policy/constraints/error-protocols.js";
import { rustFlowReadProjectionMatches } from "../control-flow/flow-read-projections.js";
import { rustBorrowPureOperation, rustBorrowValueIsUnprojected } from "../storage/borrowed-element-purity.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustErrorFieldBorrows(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustErrorFieldProducer, required: RustRequiredRecord[]): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const unwrap = (input: Node): Node => {
    let node = input;
    while (ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) || ast.is.IsSatisfiesExpression(node) || ast.is.IsNonNullExpression(node)) {
      const expression = Node_Expression(ast, node);
      if (expression === undefined) break;
      node = expression;
    }
    return node;
  };
  const selected = new Map<Node, RustErrorFieldEmission>();
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const expression = unwrap(node);
    const operation = program.records.targetOperation.get(expression);
    if (operation?.kind !== "builtin-error-property" || operation.accessMode === "write") {
      const ordinary = Object.freeze({ kind: "ordinary" as const });
      selected.set(node, ordinary); producer.field(node, ordinary); continue;
    }
    const receiver = Node_Expression(ast, expression);
    const physicalReceiver = receiver === undefined ? undefined : rustCaughtErrorPhysicalView(ast, program.records, receiver);
    const receiverCarrier = physicalReceiver ?? operation.receiverCarrier;
    const result = operation.property === "stack" ? rustSourceOptionalTargetType(rustStringTargetType()) : rustStringTargetType();
    if (receiver === undefined || !rustCarrierProvidesErrorObservation(receiverCarrier, program.typeDefinitions) ||
      !rustTargetTypeRefEquals(operation.resultCarrier, result))
      failTargetAnalysisInvariant("tsonic-rust", "Builtin Error property reading conflicts with its finalized member or exact native carriers.", expression);
    const projection = program.records.flowReadProjection.get(receiver);
    const borrowed = physicalReceiver === undefined && projection?.kind === "builtin-error" &&
      (isRustProgramErrorCarrier(projection.sourceCarrier) || isRustClosedValueCarrier(projection.sourceCarrier)) &&
      rustTargetTypeRefEquals(projection.selectedCarrier, operation.receiverCarrier) && rustFlowReadProjectionMatches(projection, program.projectTypes, program.typeDefinitions);
    const shared = operation.property !== "stack" && !rustTargetTypeRefEquals(operation.receiverCarrier, rustJsErrorTargetType());
    const value: RustErrorFieldEmission = Object.freeze({ kind: "property", expression, receiver, property: operation.property,
      receiverForm: !borrowed ? "direct" : isRustClosedValueCarrier(projection.sourceCarrier) ? "closed" : "program",
      guarded: operation.property === "stack" || shared, shared,
      directRead: rustBorrowValueIsUnprojected(node, program.records) && program.records.optionalChain.get(node) === undefined });
    selected.set(node, value); producer.field(node, value);
    requireRustRecord(required, "errorFieldEmission", node, "builtin-error-property", "analysis/operations/error-field-borrows.ts");
  }
  const pure = new Map<Node, ReadonlySet<Node>>();
  for (const expression of nodes) {
    if (!ast.is.IsBinaryExpression(expression)) continue;
    const left = BinaryExpression_Left(ast, expression);
    const right = BinaryExpression_Right(ast, expression);
    if (left === undefined || right === undefined || selected.get(left)?.kind !== "property") continue;
    const field = selected.get(left)!;
    if (field.kind !== "property" || !field.guarded || producer.records.errorFieldSnapshot.get(left, right) !== undefined) continue;
    let invocations = pure.get(right);
    if (invocations === undefined) {
      const collected = new Set<Node>();
      const pending = [right];
      while (pending.length !== 0) {
        const node = pending.pop()!;
        if (rustBorrowPureOperation(node, program.records) !== undefined) collected.add(node);
        forEachSourceImmediateEvaluationChild(ast, node, child => pending.push(child));
      }
      invocations = collected; pure.set(right, invocations);
    }
    const result = program.errorStorageDemands.invalidationFor(field.receiver, right, invocations);
    if (result.kind === "unresolved") issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: right,
      message: `${result.reason} Node kind: ${ast.kindName(right)}.`, evidence: ["target.capability=rust.backend.error-borrow-effect"] });
    else producer.snapshot(left, right, result.kind === "invalidated" || result.kind === "unproven");
  }
  return Object.freeze(issues);
}
