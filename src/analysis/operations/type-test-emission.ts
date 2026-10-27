import type { Node } from "@tsonic/tsts";
import { BinaryExpression_Left } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustClosedTypeTestProducer } from "../program/records/types/type-tests.js";
import type { RustClosedTypeTestEmission } from "../../target-model/records/types/type-tests.js";
import type { RustClosedTypeTestPlan, RustClosedTypePredicate } from "../../target-model/operations/type-tests.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustClosedTypeTestConstant } from "../../target-model/operations/type-tests.js";
import { rustClosedTypeTestMatches } from "./type-tests.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { rustCaughtErrorReadCarrier } from "../errors/catching-try.js";
import { selectRustClosedTypeTestPlan } from "../../policy/operations/operators/type-tests.js";
import { isRustProgramErrorCarrier } from "../../target-model/types/index.js";

export function analyzeRustClosedTypeTests(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustClosedTypeTestProducer): void {
  const select = (carrier: TargetTypeRef, test: RustClosedTypeTestPlan, predicate: RustClosedTypePredicate, node: Node): RustClosedTypeTestEmission => {
    const constant = rustClosedTypeTestConstant(test);
    if (constant !== undefined) return Object.freeze({ kind: "constant", value: constant });
    if (test.kind === "constant" || test.kind === "project" || test.kind === "runtime-array") return Object.freeze(test);
    if (test.kind === "error") {
      if (predicate.kind !== "error") failTargetAnalysisInvariant("tsonic-rust", "An admitted Error test requires its checked predicate.", node);
      return test.lowering === "native-error" && predicate.errorKind === "any" ? Object.freeze({ kind: "constant", value: true })
        : Object.freeze({ ...test, errorKind: predicate.errorKind });
    }
    if (test.kind === "option") return Object.freeze({ kind: "option", test: select(test.element, test.test, predicate, node) });
    const arms = test.arms.map(arm => Object.freeze({ variant: arm.variant, test: select(arm.carrier, arm.test, predicate, node) }));
    const constantArms = arms.filter(arm => arm.test.kind === "constant");
    if (constantArms.length === arms.length) {
      const matching = arms.filter(arm => arm.test.kind === "constant" && arm.test.value);
      if (matching.length === 0 || matching.length === arms.length) return Object.freeze({ kind: "constant", value: matching.length !== 0 });
      return Object.freeze({ kind: "union", carrier, form: "matches", arms: Object.freeze(matching) });
    }
    return Object.freeze({ kind: "union", carrier, form: "match", arms: Object.freeze(arms) });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind !== "closed-type-test") continue;
    const ast = program.source.ast;
    // The selected operation is validated before any of its parts is read, so a malformed record stops at the invariant.
    if (!rustClosedTypeTestMatches(fact, program.projectTypes, program.typeDefinitions))
      failTargetAnalysisInvariant("tsonic-rust", "Type predicate requires its exact selected operation, carrier and retained test plan.", node);
    const arguments_ = ast.is.IsCallExpression(node) ? ast.arguments(node) : [];
    const nominal = fact.predicate.kind !== "array";
    const operand = nominal ? BinaryExpression_Left(ast, node) : arguments_[0];
    if (operand === undefined || (nominal ? ast.operatorKindName(node) !== "KindInstanceOfKeyword"
      : !ast.is.IsCallExpression(node) || arguments_.length !== 1 || ast.is.IsSpreadElement(operand)) ||
      !rustClosedTypeTestMatches(fact, program.projectTypes, program.typeDefinitions) ||
      !rustTargetTypeRefEquals(program.records.valueRead.get(operand)?.value, fact.sourceCarrier))
      failTargetAnalysisInvariant("tsonic-rust", "Type predicate requires its exact selected operation, carrier and retained test plan.", node);
    const physical = isRustProgramErrorCarrier(fact.sourceCarrier)
      ? rustCaughtErrorReadCarrier(ast, program.records, operand) : undefined;
    const carrier = physical ?? fact.sourceCarrier;
    const test = physical === undefined ? fact.test
      : selectRustClosedTypeTestPlan(carrier, fact.predicate, program.projectTypes, program.typeDefinitions);
    if (test === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted caught predicate requires its exact physical error observation.", node);
    producer.publish(node, { operand, test: select(carrier, test, fact.predicate, node) });
  }
}
