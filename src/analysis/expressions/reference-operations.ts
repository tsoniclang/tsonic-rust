import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustReferenceOperationProducer } from "../program/records/reference-operations.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { rustValueCarrierBeforeOptionProjection } from "../conversions/value-carrier-queries.js";

export function analyzeRustReferenceOperations(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustReferenceOperationProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const call of nodes) {
    const fact = program.records.targetOperation.get(call);
    if (fact?.kind !== "reference-operation") continue;
    const argumentsList = program.source.ast.arguments(call);
    const expected = fact.operation === "store" ? [fact.operandExpression, fact.valueExpression] : [fact.operandExpression];
    if (!isDenseDataArray(argumentsList) || argumentsList.length !== expected.length || argumentsList.some((argument, index) => argument !== expected[index])) {
      refuse(call, "RUST_REFERENCE_OPERATION_ARGUMENT_CONFLICT", "Rust reference operation arguments conflict with the exact finalized source occurrence.");
      continue;
    }
    if (!rustTargetTypeRefEquals(rustValueCarrierBeforeOptionProjection(program.records, fact.operandExpression), fact.operandCarrier)) {
      refuse(call, "RUST_REFERENCE_OPERATION_OPERAND_CONFLICT", "Rust reference operation operand conflicts with its finalized target carrier.");
      continue;
    }
    if (fact.operation === "load" && (!rustTargetTypeRefEquals(fact.referenceCarrier, fact.operandCarrier) ||
      !rustTargetTypeRefEquals(fact.resultCarrier, fact.operandCarrier.referent) || !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(call)?.carrier, fact.resultCarrier))) {
      refuse(call, "RUST_REFERENCE_LOAD_VALUE_CONFLICT", "Rust reference load conflicts with its exact reference and result carrier relationship.");
      continue;
    }
    if (fact.operation === "store") {
      if (!rustTargetTypeRefEquals(program.records.runtimeCarrier.get(fact.valueExpression)?.carrier, fact.valueCarrier)) {
        refuse(call, "RUST_REFERENCE_STORE_VALUE_CONFLICT", "Rust reference store value conflicts with its finalized target carrier.");
        continue;
      }
      if (fact.writeStrategy !== undefined) {
        const read = program.records.targetOperation.get(fact.writeStrategy.readExpression);
        const value = program.records.targetOperation.get(fact.valueExpression);
        if (read?.kind !== "reference-operation" || read.operation !== "load" || value?.kind !== "operator-token" ||
          !rustTargetTypeRefEquals(read.operandCarrier, fact.operandCarrier) || !rustTargetTypeRefEquals(read.resultCarrier, fact.operandCarrier.referent) ||
          !rustTargetTypeRefEquals(value.resultCarrier, fact.valueCarrier)) {
          refuse(call, "RUST_REFERENCE_STORE_STRATEGY_CONFLICT", "Rust reference store strategy conflicts with its finalized read and operator facts.");
          continue;
        }
      }
    }
    producer.publish(call, { operation: fact, load: fact.operation !== "load" || program.ownership.reads.get(call)?.sharedReference === true ? "reference"
      : !fact.operandCarrier.mutable && isRustStringCarrier(fact.operandCarrier.referent) ? "owned-string" : "dereference" });
  }
  return Object.freeze(issues);
}
