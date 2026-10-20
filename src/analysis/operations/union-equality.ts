import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustUnionEqualityProducer } from "../program/records/union-equality.js";
import type { RustUnionEqualityOperand, RustUnionEqualityEmission } from "../../target-model/records/union-equality.js";
import { isRustUnitCarrier, isRustBoolCarrier } from "../../target-model/types/index.js";
import { rustSourceOptionalElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustUnionEqualityFactMatches } from "./contracts/union-equality.js";

export function analyzeRustUnionEquality(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustUnionEqualityProducer): void {
  for (const node of nodes) {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "union-equality") continue;
    const left = BinaryExpression_Left(program.source.ast, node);
    const right = BinaryExpression_Right(program.source.ast, node);
    if (left === undefined || right === undefined || !rustUnionEqualityFactMatches(fact, program.source.ast.operatorKindName(node),
      program.records.valueRead.get(left)?.value, program.records.valueRead.get(right)?.value, program.typeDefinitions))
      failTargetAnalysisInvariant("tsonic-rust", "Union comparison requires exact sealed native operands, variants and equality operations.", node);
    const side = (arm: RustUnionEqualityOperand["arm"], optional: boolean): RustUnionEqualityOperand => {
      const variant = arm.path[arm.path.length - 1]?.variant;
      return Object.freeze({ arm, optional, absence: isRustUnitCarrier(arm.carrier), value: variant?.kind === "constant"
        ? Object.freeze({ kind: "constant", value: variant.value }) : Object.freeze({ kind: "borrowed" }) });
    };
    const arms = fact.arms.map(arm => {
      const left = side(arm.left, rustSourceOptionalElementCarrier(fact.leftCarrier) !== undefined);
      const right = side(arm.right, rustSourceOptionalElementCarrier(fact.rightCarrier) !== undefined);
      const operation = arm.operation;
      const leftConversion = operation.leftConversion === undefined ? undefined : rustValueConversionContract(operation.leftConversion, program.typeDefinitions);
      const rightConversion = operation.rightConversion === undefined ? undefined : rustValueConversionContract(operation.rightConversion, program.typeDefinitions);
      if (operation.leftConversion !== undefined && (leftConversion === undefined || leftConversion.fallible) ||
        operation.rightConversion !== undefined && (rightConversion === undefined || rightConversion.fallible))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted union equality arm requires its exact infallible native input conversions.", node);
      const constant = left.absence && right.absence ? true : operation.kind === "operator-token" &&
        leftConversion === undefined && rightConversion === undefined && left.value.kind === "constant" && right.value.kind === "constant"
          ? left.value.value === right.value.value : undefined;
      const booleanOperand = operation.kind === "operator-token" && leftConversion === undefined && rightConversion === undefined &&
        isRustBoolCarrier(arm.left.carrier) && isRustBoolCarrier(arm.right.carrier)
        ? left.value.kind === "constant" ? Object.freeze({ side: "right" as const, negated: !left.value.value })
          : right.value.kind === "constant" ? Object.freeze({ side: "left" as const, negated: !right.value.value }) : undefined : undefined;
      return Object.freeze({ left, right, operation, constant, booleanOperand, leftConversion, rightConversion });
    });
    const allTrue = arms.every(arm => arm.constant === true);
    const form: RustUnionEqualityEmission["form"] = allTrue ? fact.exhaustive || arms.length === 0 ? "constant" : "matches" : "match";
    producer.publish(node, { fact, arms: Object.freeze(arms), form });
  }
}
