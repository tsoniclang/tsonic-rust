import { isDenseDataArray } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustReferenceOperationCall(
  call: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "reference-operation" }>,
  context: RustPlanContext,
  planExpression: (node: Node, context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const argumentsList = context.input.program.source.ast.arguments(call);
  const expectedArguments = fact.operation === "store"
    ? [fact.operandExpression, fact.valueExpression]
    : [fact.operandExpression];
  if (!isDenseDataArray(argumentsList) || argumentsList.length !== expectedArguments.length ||
    argumentsList.some((argument, index) => argument !== expectedArguments[index])) {
    return rejectReferenceOperation(
      call,
      context,
      "RUST_REFERENCE_OPERATION_ARGUMENT_CONFLICT",
      "Rust reference operation arguments conflict with the exact finalized source occurrence.",
    );
  }
  const operandCarrier = context.input.program.facts.getRuntimeCarrierFact(
    fact.operandExpression,
  )?.carrier;
  if (operandCarrier === undefined ||
    !rustTargetTypeRefEquals(operandCarrier, fact.operandCarrier)) {
    return rejectReferenceOperation(
      call,
      context,
      "RUST_REFERENCE_OPERATION_OPERAND_CONFLICT",
      "Rust reference operation operand conflicts with its finalized target carrier.",
    );
  }
  const operand = planExpression(fact.operandExpression, context);
  if (operand === undefined) return undefined;
  switch (fact.operation) {
    case "shared-reference":
      return { kind: "reference", expr: operand };
    case "mutable-reference":
      return { kind: "reference", expr: operand, mutable: true };
    case "load":
      return { kind: "dereference", pointer: operand };
    case "store": {
      const valueCarrier = context.input.program.facts.getRuntimeCarrierFact(
        fact.valueExpression,
      )?.carrier;
      if (valueCarrier === undefined ||
        !rustTargetTypeRefEquals(valueCarrier, fact.valueCarrier)) {
        return rejectReferenceOperation(
          call,
          context,
          "RUST_REFERENCE_STORE_VALUE_CONFLICT",
          "Rust reference store value conflicts with its finalized target carrier.",
        );
      }
      const value = planExpression(fact.valueExpression, context);
      return value === undefined
        ? undefined
        : {
            kind: "assignment",
            operator: "=",
            target: { kind: "dereference", pointer: operand },
            value,
          };
    }
  }
}

function rejectReferenceOperation(
  call: Node,
  context: RustPlanContext,
  code: string,
  message: string,
): undefined {
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, call),
    code,
    message,
  ));
  return undefined;
}
