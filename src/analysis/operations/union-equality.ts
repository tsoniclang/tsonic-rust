import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustUnionEqualityProducer } from "../program/records/operations/union-equality.js";
import { selectRustUnionEqualityEmission } from "../../policy/operations/operators/union-equality.js";
import { rustUnionEqualityFactMatches } from "./union-equality-facts.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustUnionEquality(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustUnionEqualityProducer): void {
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "union-equality") continue;
    const left = BinaryExpression_Left(program.source.ast, node);
    const right = BinaryExpression_Right(program.source.ast, node);
    if (left === undefined || right === undefined || !rustUnionEqualityFactMatches(fact, program.source.ast.operatorKindName(node),
      program.records.valueRead.get(left)?.value, program.records.valueRead.get(right)?.value, program.typeDefinitions))
      failTargetAnalysisInvariant("tsonic-rust", "Union comparison requires exact sealed native operands, variants and equality operations.", node);
    const selected = selectRustUnionEqualityEmission(fact, program.typeDefinitions);
    if (selected === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted union equality arm requires its exact infallible native input conversions.", node);
    producer.publish(node, selected);
  }
}
