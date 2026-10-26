import { rustConditionPrintsAsBlock } from "../../target-ast/syntax/expressions.js";
import type { Node } from "@tsonic/tsts";
import { Node_Expression, ConditionalExpression_Condition, ConditionalExpression_WhenTrue, ConditionalExpression_WhenFalse,
  BinaryExpression_OperatorToken } from "@tsonic/target-api/source";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustExpressionAccess, RustExpressionResultUse } from "./entry.js";
import { rustSourceBindingPath } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { planExpression } from "./entry.js";
import { planNumericLiteral, planBigIntLiteral } from "./literal-conversions.js";
import { planSourceConversion } from "./source-conversions.js";
import { planTemplateExpression } from "./expression-template-strings.js";
import { planDeleteExpression } from "./expression-element-deletion.js";
import { planGeneratorResumeExpression } from "./generator-resume.js";
import { rustOperationFact } from "./fundamentals.js";
import { planRustAbsentValue, planRustOptionalStorageOperation } from "./optional-storage.js";
import { planRustClassValueRead } from "../objects/class-values.js";
import { planRustIdentifierValue, planRustValueRead } from "./typed-locations.js";
import { planProviderOperationExpression, finishProviderOperationExpression } from "./conversions.js";
import { planRustSourceCallableValue } from "./source-callable-value.js";
import { planRustRuntimeCategoryExpression } from "./runtime-category.js";
import { planRustVoidExpression } from "./expression-void.js";
import { planElementAccess } from "./elements.js";
import { planArrayLiteral } from "./array-literals/planning.js";
import { planBinaryExpression } from "./binary.js";
import { planAssignmentExpression } from "./assignment.js";
import { planCallExpression } from "./calls/basic.js";
import { planCallableExpression } from "./callable.js";
import { planNewExpression } from "./constructions.js";
import { planRegExpCreate } from "./regular-expression-literals.js";
import { planPropertyAccess } from "./properties.js";
import { planRecordLiteral } from "./records.js";
import { planUnaryExpression } from "./expression-unary.js";
import { planRustAwaitExpression } from "./await.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustValueDestinationContext } from "./value-destinations.js";
import { planExpressionAsStatement } from "../statements/statement-simple.js";

export function planExpressionInner(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse,
  access: RustExpressionAccess = "value"): RustExpr | undefined {
  const { ast } = context.input.program.source;
  const fact = rustOperationFact(node, context);
  const syntax = context.input.program.records.expressionSyntax.get(node);
  switch (ast.kindName(node)) {
    case "KindBigIntLiteral": return planBigIntLiteral(node, context);
    case "KindNumericLiteral": return planNumericLiteral(node, context);
    case "KindStringLiteral":
    case "KindNoSubstitutionTemplateLiteral": {
      if (fact?.kind === "source-enum-member") return planPropertyAccess(node, context);
      if (syntax?.kind === "char") return { kind: "int-literal", text: String(syntax.value) };
      if (syntax?.kind !== "string") failRustPlannerInvariant("An admitted literal requires its exact native string or character recipe.", node);
      return { kind: "string-literal", value: syntax.value };
    }
    case "KindTrueKeyword": return { kind: "bool-literal", value: true };
    case "KindFalseKeyword": return { kind: "bool-literal", value: false };
    case "KindThisExpression":
    case "KindThisKeyword": return access === "value"
      ? planRustValueRead(node, { kind: "path", path: "self" }, context) : { kind: "path", path: "self" };
    case "KindNullKeyword": {
      if (syntax?.kind !== "absence") failRustPlannerInvariant("An admitted null literal requires its one native absence form.", node);
      return planRustAbsentValue(syntax.carrier, context);
    }
    case "KindClassExpression": return planRustClassValueRead(node, context);
    case "KindIdentifier": {
      if (context.input.program.records.classValue.get(node) !== undefined) return planRustClassValueRead(node, context);
      if (syntax?.kind === "absence") return planRustAbsentValue(syntax.carrier, context);
      if (fact?.kind === "provider-operation") {
        const value = planProviderOperationExpression(context, fact, undefined, [], node, { resultUse: "value" });
        if (value === undefined) failRustPlannerInvariant("An admitted provider value requires its native property syntax.", node);
        return finishProviderOperationExpression(context, fact, value, node);
      }
      const callable = context.input.program.records.sourceCallableValue.get(node);
      if (callable !== undefined) return planRustSourceCallableValue(callable, context);
      const binding = context.input.program.records.sourceBinding.get(node);
      const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
      if (path === undefined) failRustPlannerInvariant("An admitted identifier requires its exact native source binding.", node);
      return planRustIdentifierValue(node, path, context, access);
    }
    case "KindParenthesizedExpression":
    case "KindSatisfiesExpression": {
      const inner = Node_Expression(ast, node);
      if (inner === undefined) failRustPlannerInvariant("An admitted transparent expression requires its checked source operand.", node);
      return planExpression(inner, context, resultUse, access === "value" ? "value" : "shared-place");
    }
    case "KindAsExpression":
    case "KindTypeAssertionExpression": {
      // A discarded type assertion only evaluates its operand, which is itself discarded (TypeScript assertions have no
      // runtime effect); the conversion is planned only when the value is used.
      if (resultUse === "discarded") {
        const inner = Node_Expression(ast, node);
        if (inner === undefined) failRustPlannerInvariant("An admitted discarded assertion requires its checked source operand.", node);
        return planExpression(inner, context, "discarded");
      }
      return planSourceConversion(node, context, access);
    }
    case "KindNonNullExpression": {
      const inner = Node_Expression(ast, node);
      // A discarded non-null assertion has no runtime effect beyond evaluating its discarded operand.
      if (resultUse === "discarded") {
        if (inner === undefined) failRustPlannerInvariant("An admitted discarded non-null assertion requires its checked source operand.", node);
        return planExpression(inner, context, "discarded");
      }
      const value = inner === undefined ? undefined : planExpression(inner, context);
      if (syntax?.kind !== "non-null" || value === undefined) failRustPlannerInvariant("An admitted non-null read requires its exact native payload projection.", node);
      return syntax.operation === "identity" ? value : syntax.operation === "unwrap"
        ? { kind: "method-call", receiver: value, method: "unwrap", args: [] }
        : planRustOptionalStorageOperation(syntax.source, "into_present", [value], context);
    }
    case "KindConditionalExpression": {
      const test = ConditionalExpression_Condition(ast, node);
      const yes = ConditionalExpression_WhenTrue(ast, node);
      const no = ConditionalExpression_WhenFalse(ast, node);
      const condition = test === undefined ? undefined : planExpression(test, context);
      if (resultUse === "discarded") {
        // A discarded conditional evaluates its test and then only the selected branch, itself discarded.
        if (condition === undefined || yes === undefined || no === undefined)
          failRustPlannerInvariant("An admitted discarded conditional requires its native test and branches.", node);
        const whenTrue = planExpressionAsStatement(yes, context);
        const whenFalse = planExpressionAsStatement(no, context);
        // Only branches with work are emitted; with none, the test is still evaluated once.
        const statement: RustStmt | undefined = whenTrue.length > 0
          ? { kind: "if", condition, then: { statements: whenTrue }, ...(whenFalse.length === 0 ? {} : { else: { statements: whenFalse } }) }
          : whenFalse.length > 0 ? { kind: "if", condition: { kind: "unary", operator: "!", operand: condition }, then: { statements: whenFalse } }
          : undefined;
        return statement === undefined ? condition : { kind: "block", body: { statements: [statement] } };
      }
      const destination = context.valueDestinations?.get(node);
      const whenTrue = yes === undefined ? undefined : planExpression(yes, rustValueDestinationContext(yes, destination, context));
      const whenFalse = no === undefined ? undefined : planExpression(no, rustValueDestinationContext(no, destination, context));
      if (condition === undefined || whenTrue === undefined || whenFalse === undefined || context.syntheticNames === undefined)
        failRustPlannerInvariant("An admitted conditional requires its native test, branch values and name scope.", node);
      // A test that prints as a statement block is bound first (clippy::blocks_in_conditions); any other test is the
      // condition itself, as in the checkpoint output.
      if (!rustConditionPrintsAsBlock(condition)) return { kind: "conditional", condition, whenTrue, whenFalse };
      const name = allocateRustSyntheticName(context.syntheticNames, "conditional_test");
      return rustValueBlock([{ name, value: condition }], { kind: "conditional", condition: { kind: "path", path: name }, whenTrue, whenFalse });
    }
    case "KindTemplateExpression": return planTemplateExpression(node, context);
    case "KindTypeOfExpression": return { kind: "owned-string-from-borrowed-str",
      expression: planRustRuntimeCategoryExpression(node, context) };
    case "KindVoidExpression": return planRustVoidExpression(node, context);
    case "KindDeleteExpression": return planDeleteExpression(node, context);
    case "KindArrayLiteralExpression": {
      if (fact?.kind !== "fixed-array-literal") return planArrayLiteral(node, context);
      const elements = ast.elements(node).map(element => element === undefined ? undefined : planExpression(element, context));
      if (elements.some(element => element === undefined)) failRustPlannerInvariant("An admitted fixed literal requires every native element.", node);
      return { kind: "slice-literal", elements: elements as readonly RustExpr[] };
    }
    case "KindObjectLiteralExpression": return planRecordLiteral(node, context);
    case "KindArrowFunction":
    case "KindFunctionExpression":
    case "KindMethodDeclaration":
    case "KindGetAccessor":
    case "KindSetAccessor": return planCallableExpression(node, context, resultUse);
    case "KindRegularExpressionLiteral": return planRegExpCreate(node, context);
    case "KindAwaitExpression": return planRustAwaitExpression(node, context, planExpression);
    case "KindYieldExpression": {
      const generator = context.generator;
      if (syntax?.kind !== "yield" || generator?.declaration !== syntax.declaration)
        failRustPlannerInvariant("An admitted yield requires its exact native generator owner.", node);
      if (syntax.delegated !== undefined) {
        requireRustCarrierRequirements(syntax.delegated.next, ["default"], node, context);
        requireRustCarrierRequirements(syntax.delegated.result, ["clone"], node, context);
      }
      const value = syntax.operand === undefined ? { kind: "tuple-literal" as const, elements: [] } : planExpression(syntax.operand, context);
      if (value === undefined) failRustPlannerInvariant("An admitted yield requires its native operand.", node);
      return planGeneratorResumeExpression({ kind: "await", expr: { kind: "method-call", receiver: { kind: "path", path: generator.controllerName },
        method: syntax.method, args: [value] } }, context);
    }
    case "KindPrefixUnaryExpression":
    case "KindPostfixUnaryExpression": return planUnaryExpression(node, context, resultUse);
    case "KindBinaryExpression": {
      const token = BinaryExpression_OperatorToken(ast, node);
      return token !== undefined && ast.kindName(token) === "KindEqualsToken" ? planAssignmentExpression(node, context) : planBinaryExpression(node, context, resultUse, access);
    }
    case "KindCallExpression": return planCallExpression(node, context, resultUse);
    case "KindNewExpression": return planNewExpression(node, context);
    case "KindPropertyAccessExpression": return planPropertyAccess(node, context);
    case "KindElementAccessExpression": return planElementAccess(node, context, access);
    default: return failRustPlannerInvariant("An admitted expression requires its exact native syntax form.", node);
  }
}
