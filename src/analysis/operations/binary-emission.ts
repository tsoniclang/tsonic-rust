import type { Node } from "@tsonic/tsts";
import { rustNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, sourceBooleanShortCircuitBranch, sourceSequenceInputChoice } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustBinaryEmissionProducer } from "../program/records/operations/expression-binary.js";
import type { RustBinaryEmission } from "../../target-model/records/operations/expression-binary.js";
import { isRustBoolCarrier, isRustNeverCarrier, isRustUnitCarrier, isRustStringCarrier, rustOptionElementCarrier, rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetOperationText } from "../../target-model/operations/text.js";
import { isRustAssignmentOperator, isRustBinaryOperator } from "../../target-model/syntax/tokens.js";
import { hasExactObjectKeys, isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { finalizedConversionIsValid } from "../../policy/operations/members/abi/conversions.js";
import { rustProjectTypeTestMatches } from "./type-tests.js";
import { rustBindingReadIsUnevaluated } from "./static-comparison-operands.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustBinaryEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustBinaryEmissionProducer): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string, code = "RUST_MISSING_TARGET_FACT"): void => {
    issues.push({ code, category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  const effect = (node: Node): boolean => {
    const selected = program.sourceNavigation.expressionEffects(node);
    const read = program.ownership.reads.get(node);
    if (selected.invokes || selected.mutates || selected.suspends || selected.mayThrow) return true;
    // The global undefined (an identifier with no source binding) evaluates nothing.
    const globalUndefined = ast.is.IsIdentifier(node) && ast.text(node) === "undefined" && program.records.sourceBinding.get(node) === undefined;
    return !(globalUndefined || ast.is.IsIdentifier(node) && read?.pure === true && read.value.kind !== "clone" ||
      ast.is.IsNumericLiteral(node) || ast.kindName(node) === "KindTrueKeyword" || ast.kindName(node) === "KindFalseKeyword" || ast.kindName(node) === "KindNullKeyword");
  };
  const parts = (node: Node, result: Node[]): void => {
    if (program.records.targetOperation.get(node)?.kind === "string-concat") {
      const left = BinaryExpression_Left(ast, node);
      const right = BinaryExpression_Right(ast, node);
      if (left !== undefined && right !== undefined) { parts(left, result); parts(right, result); return; }
    }
    result.push(node);
  };
  // A nullish choice that selects a spread's sequence input is lowered as that choice, not as an operator.
  const spreadChoiceControl = (node: Node): boolean => {
    let current = ast.parent(node);
    while (current !== undefined && (ast.is.IsParenthesizedExpression(current) || ast.is.IsSatisfiesExpression(current) ||
      ast.is.IsBinaryExpression(current) && ast.operatorKindName(current) === "KindQuestionQuestionToken")) current = ast.parent(current);
    const spread = current !== undefined && ast.is.IsSpreadElement(current) ? Node_Expression(ast, current) : undefined;
    return spread !== undefined && sourceSequenceInputChoice(ast, spread)?.controlNodes.includes(node) === true;
  };
  // The condition of an if statement whose guard result is already decided is never evaluated natively: the
  // statement emits only its selected branch (planner statements/planning.ts).
  const insideDecidedGuard = (node: Node): boolean => {
    let current = node;
    for (let parent = ast.parent(current); parent !== undefined; current = parent, parent = ast.parent(parent)) {
      if (ast.is.IsIfStatement(parent)) return Node_Expression(ast, parent) === current && program.records.nativeGuardResult.get(current) !== undefined;
      if (!ast.is.IsBinaryExpression(parent) && !ast.is.IsParenthesizedExpression(parent) && !ast.is.IsPrefixUnaryExpression(parent)) return false;
    }
    return false;
  };
  for (const node of nodes) {
    if (!ast.is.IsBinaryExpression(node) || ast.operatorKindName(node) === "KindEqualsToken" || spreadChoiceControl(node) || insideDecidedGuard(node) ||
      program.records.nativeParticipation.get(node) === "erased" || rustNodeIsOutsideNativeCode(ast, program.records,
        expression => program.safetyApplications.operationForExpression(expression), node)) continue;
    const fact = program.records.targetOperation.get(node);
    const left = BinaryExpression_Left(ast, node);
    const right = BinaryExpression_Right(ast, node);
    if (fact === undefined || left === undefined || right === undefined) { refuse(node, "rust.backend.operator", "Binary expression requires a finalized Rust operator fact."); continue; }
    const selected = program.records.selectedOperation.get(node);
    const exact = (carrier: import("../../target-model/types/model.js").TargetTypeRef, operation: string): boolean =>
      selected?.operationId === fact.operationId && selected.operationKind === "operator" && selected.targetOperation === operation &&
      rustTargetTypeRefEquals(selected.resultType, carrier) && rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, carrier);
    const leftCarrier = rustEffectiveValueCarrier(program.records, left);
    const rightCarrier = rustEffectiveValueCarrier(program.records, right);
    let optionCheck: RustBinaryEmission["optionCheck"];
    switch (fact.kind) {
      case "logical-value": {
        const conversion = (value: typeof fact.leftConversion, carrier: typeof fact.leftCarrier, needed: boolean): boolean => needed
          ? value !== null && finalizedConversionIsValid(value, program.typeDefinitions) && rustTargetTypeRefEquals(value.sourceCarrier, carrier) && rustTargetTypeRefEquals(value.targetCarrier, fact.resultCarrier)
          : value === null;
        if (!isClosedMetadata(fact) || !hasExactObjectKeys(fact, ["kind", "operationId", "operator", "branch", "leftCarrier", "rightCarrier", "resultCarrier", "leftConversion", "rightConversion"]) ||
          (fact.branch !== "left" && fact.branch !== "right" && fact.branch !== "conditional") || (fact.operator !== "and" && fact.operator !== "or") ||
          fact.branch !== sourceBooleanShortCircuitBranch(ast, left, fact.operator === "and" ? "&&" : "||") ||
          ast.operatorKindName(node) !== (fact.operator === "and" ? "KindAmpersandAmpersandToken" : "KindBarBarToken") || !isRustBoolCarrier(fact.leftCarrier) ||
          !conversion(fact.leftConversion, fact.leftCarrier, fact.branch !== "right") || !conversion(fact.rightConversion, fact.rightCarrier, fact.branch !== "left") ||
          !rustTargetTypeRefEquals(leftCarrier, fact.leftCarrier) || !rustTargetTypeRefEquals(rightCarrier, fact.rightCarrier) || !exact(fact.resultCarrier, fact.operationId)) {
          refuse(node, "rust.backend.logical-value-evidence", "Short-circuit selection requires exact finalized branch and conversion evidence."); continue;
        }
        break;
      }
      case "sequence":
        if (!rustTargetTypeRefEquals(leftCarrier, fact.leftCarrier) || !rustTargetTypeRefEquals(rightCarrier, fact.rightCarrier) ||
          !rustTargetTypeRefEquals(fact.rightCarrier, fact.resultCarrier) || !exact(fact.resultCarrier, fact.operationId)) {
          refuse(node, "rust.backend.sequence-evidence", "Sequencing requires exact finalized operand and result carriers."); continue;
        }
        break;
      case "program-error-equality":
        if (!rustTargetTypeRefEquals(leftCarrier, fact.errorOperand === "left" ? fact.sourceCarrier : fact.targetCarrier) ||
          !rustTargetTypeRefEquals(rightCarrier, fact.errorOperand === "right" ? fact.sourceCarrier : fact.targetCarrier) || !exact(fact.resultCarrier, fact.operationId)) {
          refuse(node, "rust.backend.program-error-equality-evidence", "Program-error equality requires its exact finalized operand carriers."); continue;
        }
        break;
      case "program-error-type-test":
        if (!rustTargetTypeRefEquals(leftCarrier, fact.sourceCarrier) || !exact(fact.resultCarrier, "program-error-type-test")) {
          refuse(node, "rust.backend.program-error-type-test-selected-evidence", "Program-error type test conflicts with its exact finalized source operation evidence."); continue;
        }
        break;
      case "project-type-test":
        if (!rustProjectTypeTestMatches(fact, program.projectTypes) || !rustTargetTypeRefEquals(leftCarrier, fact.sourceCarrier) || !exact(fact.resultCarrier, "project-type-test")) {
          refuse(node, "rust.backend.project-type-test-selected-evidence", "Project type test conflicts with its exact finalized source operation evidence."); continue;
        }
        break;
      case "option-check": {
        const option = fact.optionOperand === "left" ? left : right;
        const nullish = fact.optionOperand === "left" ? right : left;
        if (!rustTargetTypeRefEquals(program.records.runtimeCarrier.get(option)?.carrier, fact.optionCarrier) ||
          !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(nullish)?.carrier, fact.nullishCarrier) || !exact(rustSourcePrimitiveTargetType("bool"), rustTargetOperationText(fact))) {
          refuse(node, "rust.backend.option-check", "Option presence check conflicts with its exact finalized operand carriers or selected operation."); continue;
        }
        const depths = fact.nullishDepths;
        const valid = Array.isArray(depths) && depths.length !== 0 && depths.every((depth, index) => {
          if (!Number.isSafeInteger(depth) || depth < 0 || index > 0 && depth <= depths[index - 1]!) return false;
          let carrier = fact.optionCarrier;
          for (let layer = 0; layer < depth; layer++) {
            const inner = rustOptionElementCarrier(carrier);
            if (inner === undefined) return false;
            carrier = inner;
          }
          return rustOptionElementCarrier(carrier) !== undefined || depth === 0 && rustOptionalStorageValue(carrier) !== undefined;
        });
        if (!valid) { refuse(node, "rust.backend.option-check", "Option nullish depths must be ordered, unique and contained in the exact operand carrier."); continue; }
        optionCheck = Object.freeze({ custom: rustOptionalStorageValue(fact.optionCarrier) !== undefined,
          skipNullish: !effect(nullish), nullishUnit: isRustUnitCarrier(fact.nullishCarrier) });
        break;
      }
      case "constant-equality":
        if (!exact(fact.resultCarrier, rustTargetOperationText(fact))) {
          refuse(node, "rust.backend.constant-equality-selected-evidence", "Constant equality conflicts with its exact finalized source operation evidence."); continue;
        }
        break;
      case "operator-token":
      case "operator-call":
      case "string-concat":
        if (!exact(fact.resultCarrier, rustTargetOperationText(fact))) { refuse(node, "rust.backend.operator-selected-evidence", "Binary Rust operator fact conflicts with the TSTS-selected operator fact."); continue; }
        if (fact.kind === "operator-token" && !isRustBinaryOperator(fact.operator) && !isRustAssignmentOperator(fact.operator)) {
          refuse(node, "rust.backend.operator", "Binary expression selected a non-binary Rust operator fact.", "RUST_UNSUPPORTED_AST"); continue;
        }
        if (fact.kind === "operator-call" && fact.fallible) {
          const region = program.errorRegions.localFor(node);
          if (region === undefined || region.kind === "infallible") { refuse(node, "rust.error.operator", "Fallible operator calls require a finalized fallible lowering context.", "RUST_UNSUPPORTED_AST"); continue; }
        }
        break;
      case "nullish-identity":
        if (!rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, fact.resultCarrier)) { refuse(node, "rust.backend.nullish-carrier", "Nullish identity requires its exact finalized result carrier."); continue; }
        break;
      case "union-equality":
        if (!exact(fact.resultCarrier, rustTargetOperationText(fact))) {
          refuse(node, "rust.backend.union-equality-selected-evidence", "Union equality conflicts with its exact finalized source operation evidence."); continue;
        }
        break;
      case "closed-type-test":
      case "nullish-assignment":
      case "option-coalesce":
      case "option-equality": break;
      default: refuse(node, "rust.backend.operator", "Binary expression selected a non-operator Rust operation.", "RUST_UNSUPPORTED_AST"); continue;
    }
    const concatParts: Node[] | undefined = fact.kind === "string-concat" ? [] : undefined;
    if (concatParts !== undefined) parts(node, concatParts);
    const comparison = fact.kind === "operator-token" && (fact.operator === "==" || fact.operator === "!=");
    const shared = (operand: Node, side: "left" | "right"): boolean => {
      const conversion = fact.kind === "operator-token" || fact.kind === "operator-call"
        ? side === "left" ? fact.leftConversion : fact.rightConversion : undefined;
      const borrowed = fact.kind === "operator-call" ? fact.operandModes[side === "left" ? 0 : 1] === "ref" && conversion === undefined
        : comparison ? conversion === undefined : fact.kind === "union-equality" || fact.kind === "project-type-test";
      if (!borrowed) return false;
      const selected = program.ownership.reads.get(operand)?.value;
      return selected?.kind === "borrow" && !selected.mutable;
    };
    const literal = (node: Node): string | undefined => {
      const value = program.records.literalValue.get(node);
      return value?.form === "string" || value?.form === "template" ? value.text : undefined;
    };
    producer.publish(node, { fact, left, right, leftUnit: isRustUnitCarrier(leftCarrier), rightUnit: isRustUnitCarrier(rightCarrier),
      leftNever: isRustNeverCarrier(leftCarrier), leftShared: shared(left, "left"), rightShared: shared(right, "right"),
      int32Remainder: program.numericRepresentations.int32Remainder.get(node),
      compound: (fact.kind === "operator-token" || fact.kind === "operator-call") && fact.operator !== "=" && isRustAssignmentOperator(fact.operator),
      operator: fact.kind === "operator-token" && isRustBinaryOperator(fact.operator) ? fact.operator : undefined,
      leftLiteral: comparison && fact.leftConversion === undefined && isRustStringCarrier(leftCarrier) ? literal(left) : undefined,
      rightLiteral: comparison && fact.rightConversion === undefined && isRustStringCarrier(rightCarrier) ? literal(right) : undefined,
      selectionTest: fact.kind === "project-type-test" && fact.lowering.kind === "dispatch" && rustTargetTypeRefEquals(fact.sourceCarrier, fact.dispatchCarrier),
      constantLeftEffect: effect(left) && !rustBindingReadIsUnevaluated(ast, program.records, left),
      constantRightEffect: effect(right) && !rustBindingReadIsUnevaluated(ast, program.records, right), concatParts: concatParts === undefined ? undefined : Object.freeze(concatParts), optionCheck });
  }
  return Object.freeze(issues);
}
