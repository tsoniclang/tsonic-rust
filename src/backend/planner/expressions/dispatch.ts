import {
  rustBottomAfterEffect,
  rustBottomExpression,
} from "../types/fallible-shape.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
  rustSourceBindingPath,
  sourceTypePath,
} from "../program/plan-context.js";
import {
  getRustGeneratorProtocol,
  isRustJsStringCarrier,
  isRustNeverCarrier,
  isRustNullCarrier,
  isRustUndefinedCarrier,
  isRustUnitCarrier,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
} from "../../../target-model/types/index.js";
import {
  KindBinaryExpression,
  KindBigIntLiteral,
  KindCallExpression,
  KindConditionalExpression,
  KindDeleteExpression,
  KindElementAccessExpression,
  KindFalseKeyword,
  KindFunctionExpression,
  KindIdentifier,
  KindNewExpression,
  KindNoSubstitutionTemplateLiteral,
  KindNonNullExpression,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindStringLiteral,
  KindSatisfiesExpression,
  KindTemplateExpression,
  KindTrueKeyword,
  KindTypeOfExpression,
  KindVoidExpression,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  Node_Expression,
} from "@tsonic/target-api/source";
import {
  planRustIdentifierValue,
  planRustValueRead,
  planRustNonConsumingValue,
} from "./typed-locations.js";
import {
  rustFutureValueFactKey,
  rustSourceBindingFactKey,
  rustSourceCallableValueFactKey,
  rustYieldFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyFinalizedValueConversion, finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { expressionCarrier, planBigIntLiteral, planDeleteExpression, planGeneratorResumeExpression, planNumericLiteral, planSourceConversion, planTemplateExpression, requireExpressionCarrier, rustOperationFact, selectedOperationMatches } from "./fundamentals.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planArrayLiteral, planElementAccess } from "./elements.js";
import { planBinaryExpression } from "./binary.js";
import { planCallExpression } from "./calls/basic.js";
import { planCallableExpression } from "./callable.js";
import { planExpression } from "./entry.js";
import { planNewExpression, planRegExpCreate } from "./special.js";
import { planPropertyAccess } from "./properties.js";
import { planRecordLiteral } from "./records.js";
import { planUnaryExpression } from "./updates/source.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustEffectiveValueCarrier } from "../../../analysis/facts/value-carrier-queries.js";
import { rustExpressionContainsStatementBlock, rustJsStringLiteral } from "../../target-ast/expressions.js";
import { rustFutureValueMatchesCarrier } from "../../../analysis/facts/future-values.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { sourceCharCodeUnit } from "../../../target-model/syntax/literals.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustExpressionResultUse } from "./entry.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustSourceCallableValue } from "./source-callable-value.js";

export function planExpressionInner(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindBigIntLiteral: {
      return planBigIntLiteral(node, context);
    }
    case KindNumericLiteral: {
      return planNumericLiteral(node, context);
    }
    case KindStringLiteral:
    case KindNoSubstitutionTemplateLiteral: {
      const literalFact = rustOperationFact(node, context);
      if (literalFact !== undefined && literalFact.kind === "source-enum-member") {
        if (!requireExpressionCarrier(node, literalFact.resultCarrier, context, "rust.backend.enum-literal-carrier")) {
          return undefined;
        }
        const value = rustSourceTypeCarrierValue(literalFact.resultCarrier);
        const typePath = value === undefined ? undefined : sourceTypePath(context, value);
        if (typePath === undefined) {
          return undefined;
        }
        return { kind: "path", path: `${typePath}::${literalFact.name}` };
      }
      const carrier = expressionCarrier(node, context);
      if (carrier?.kind === "source-primitive" && carrier.name === "char") {
        const value = sourceCharCodeUnit(ast.text(node));
        if (value === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.char-literal",
            "Neutral char lowering requires one exact UTF-16 code unit.",
          ));
          return undefined;
        }
        return { kind: "int-literal", text: String(value) };
      }
      const value = ast.text(node);
      return isRustJsStringCarrier(expressionCarrier(node, context))
        ? rustJsStringLiteral(value)
        : { kind: "string-literal", value };
    }
    case KindTrueKeyword: {
      return { kind: "bool-literal", value: true };
    }
    case KindFalseKeyword: {
      return { kind: "bool-literal", value: false };
    }
    case "KindThisExpression":
    case "KindThisKeyword": {
      return planRustValueRead(node, { kind: "path", path: "self" }, context);
    }
    case "KindNullKeyword": {
      const fact = rustOperationFact(node, context);
      if (fact?.kind === "option-none") {
        return { kind: "none" };
      }
      if (!isRustNullCarrier(expressionCarrier(node, context))) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.nullish",
          "null literals require an exact Null carrier or finalized Option lane fact.",
        ));
        return undefined;
      }
      context.usedAliases?.add("rt");
      return { kind: "path", path: "rt::Null" };
    }
    case KindIdentifier: {
      const identifierFact = rustOperationFact(node, context);
      const binding = context.input.program.facts.getFact(node, rustSourceBindingFactKey);
      if (identifierFact !== undefined && identifierFact.kind === "option-none") {
        return { kind: "none" };
      }
      if (binding === undefined && isRustUndefinedCarrier(expressionCarrier(node, context))) {
        context.usedAliases?.add("rt");
        return { kind: "path", path: "rt::Undefined" };
      }
      if (identifierFact !== undefined && identifierFact.kind === "provider-operation") {
        if (identifierFact.abi.operationKind !== "property" || identifierFact.abi.sourceArguments.length !== 0) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.provider-value-abi",
            "Provider value identifier requires a finalized zero-argument property ABI.",
          ));
          return undefined;
        }
        const planned = planProviderOperationExpression(
          context,
          identifierFact,
          undefined,
          [],
          node,
          { resultUse: "value" },
        );
        if (planned === undefined) {
          context.diagnostics.push(unsupportedConstructDiagnostic(
            diagnosticInput(context, node),
            "rust.provider.value",
            "Provider value has no runtime representation in this position.",
          ));
          return undefined;
        }
        return finishProviderOperationExpression(context, identifierFact, planned, node);
      }
      const callableValue = context.input.program.facts.getFact(node, rustSourceCallableValueFactKey);
      if (callableValue !== undefined) {
        return planRustSourceCallableValue(callableValue, context);
      }
      if (binding === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.value-reference",
          "Identifier expression has no finalized project-source binding or selected target value operation.",
        ));
        return undefined;
      }
      const name = context.input.program.names.nameForDeclaration(binding.sourceDeclaration) ?? "";
      if (!isValidRustIdentifier(name)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.identifier",
          `Identifier '${ast.text(node)}' does not lower to a valid Rust identifier.`,
        ));
        return undefined;
      }
      const path = rustSourceBindingPath(context, binding);
      if (path === undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.identifier",
          `Identifier '${ast.text(node)}' does not lower to one exact Rust binding path.`,
        ));
        return undefined;
      }
      return planRustIdentifierValue(
        node,
        path,
        context,
      );
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(context.input.program.source.ast, node);
      return inner === undefined ? undefined : planExpression(inner, context);
    }
    case "KindAsExpression":
    case "KindTypeAssertionExpression": {
      return planSourceConversion(node, context);
    }
    case KindSatisfiesExpression: {
      const fact = rustOperationFact(node, context);
      const inner = Node_Expression(context.input.program.source.ast, node);
      if (fact?.kind !== "identity-expression" || inner === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.identity-expression",
          "Erased source syntax requires one exact finalized identity operation.",
        ));
        return undefined;
      }
      if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.identity-expression")) {
        return undefined;
      }
      return planExpression(inner, context);
    }
    case KindNonNullExpression: {
      const fact = rustOperationFact(node, context);
      const inner = Node_Expression(context.input.program.source.ast, node);
      const planned = inner === undefined ? undefined : planExpression(inner, context);
      const innerCarrier = inner === undefined
        ? undefined
        : rustEffectiveValueCarrier(context.input.program.facts, inner);
      if (fact?.kind !== "non-null-expression" || inner === undefined || planned === undefined ||
        innerCarrier === undefined || !rustTargetTypeRefEquals(innerCarrier, fact.sourceCarrier) ||
        !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.non-null-expression")) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.non-null-expression",
          "Non-null syntax requires one exact finalized source and result carrier.",
        ));
        return undefined;
      }
      if (rustTargetTypeRefEquals(fact.sourceCarrier, fact.resultCarrier)) {
        return planned;
      }
      if (!rustTargetTypeRefEquals(rustOptionElementCarrier(fact.sourceCarrier), fact.resultCarrier)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.non-null-option",
          "Non-null syntax can remove only the exact nullish lane from its finalized source carrier.",
        ));
        return undefined;
      }
      return { kind: "method-call", receiver: planned, method: "unwrap", args: [] };
    }
    case KindConditionalExpression: {
      const fact = rustOperationFact(node, context);
      const conditionNode = ConditionalExpression_Condition(context.input.program.source.ast, node);
      const whenTrueNode = ConditionalExpression_WhenTrue(context.input.program.source.ast, node);
      const whenFalseNode = ConditionalExpression_WhenFalse(context.input.program.source.ast, node);
      if (fact?.kind !== "conditional" || conditionNode === undefined ||
        whenTrueNode === undefined || whenFalseNode === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.conditional",
          "Conditional expression requires one exact finalized result carrier.",
        ));
        return undefined;
      }
      if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.conditional")) {
        return undefined;
      }
      const condition = planExpression(conditionNode, context);
      const whenTrue = planExpression(whenTrueNode, context);
      const whenFalse = planExpression(whenFalseNode, context);
      if (condition === undefined || whenTrue === undefined || whenFalse === undefined) {
        return undefined;
      }
      const conditional: RustExpr = { kind: "conditional", condition, whenTrue, whenFalse };
      if (!rustExpressionContainsStatementBlock(condition)) {
        return conditional;
      }
      const conditionName = allocateRustSyntheticName(
        context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
        "conditional_test",
      );
      return {
        kind: "block",
        bindings: [{ name: conditionName, value: condition }],
        value: {
          ...conditional,
          condition: { kind: "path", path: conditionName },
        },
      };
    }
    case KindTemplateExpression: {
      return planTemplateExpression(node, context);
    }
    case KindTypeOfExpression: {
      const fact = rustOperationFact(node, context);
      const operandNode = Node_Expression(context.input.program.source.ast, node);
      if (fact?.kind !== "typeof" || operandNode === undefined ||
        !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.typeof-carrier")) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.typeof",
          "typeof requires one exact finalized Rust runtime-category fact.",
        ));
        return undefined;
      }
      const operand = planExpression(operandNode, context);
      const discard = isRustUnitCarrier(expressionCarrier(operandNode, context)) ? "unit" : "value";
      return operand === undefined
        ? undefined
        : {
            kind: "evaluate-then",
            effect: discard === "value"
              ? planRustNonConsumingValue(operandNode, operand, context)
              : operand,
            discard,
            value: isRustJsStringCarrier(fact.resultCarrier)
              ? rustJsStringLiteral(fact.result)
              : { kind: "string-literal", value: fact.result },
          };
    }
    case KindVoidExpression: {
      const fact = rustOperationFact(node, context);
      const operandNode = Node_Expression(context.input.program.source.ast, node);
      if (fact?.kind !== "void-expression" || operandNode === undefined ||
        !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.void-carrier") ||
        !selectedOperationMatches(
          context.input.program.facts.getSelectedTargetOperator(node),
          fact.operationId,
          "operator",
          fact.resultCarrier,
          "void",
        )) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.void",
          "void requires one exact finalized operand and undefined-result operation.",
        ));
        return undefined;
      }
      const operand = planExpression(operandNode, context);
      context.usedAliases?.add("rt");
      return operand === undefined
        ? undefined
        : {
            kind: "evaluate-then",
            effect: operand,
            discard: isRustUnitCarrier(expressionCarrier(operandNode, context)) ? "unit" : "value",
            value: { kind: "path", path: "rt::Undefined" },
          };
    }
    case KindDeleteExpression:
      return planDeleteExpression(node, context);
    case "KindArrayLiteralExpression": {
      const fixedFact = rustOperationFact(node, context);
      if (fixedFact !== undefined && fixedFact.kind === "fixed-array-literal") {
        const elements: RustExpr[] = [];
        for (const element of context.input.program.source.ast.elements(node)) {
          if (element === undefined || ast.kindName(element) === "KindOmittedExpression") {
            context.diagnostics.push(missingFactDiagnostic(
              diagnosticInput(context, node),
              "rust.backend.fixed-array-element",
              "Fixed-array literal contains a missing or omitted element slot.",
            ));
            return undefined;
          }
          const planned = planExpression(element, context);
          if (planned === undefined) {
            return undefined;
          }
          elements.push(planned);
        }
        return { kind: "slice-literal", elements };
      }
      return planArrayLiteral(node, context);
    }
    case "KindObjectLiteralExpression": {
      return planRecordLiteral(node, context);
    }
    case "KindArrowFunction":
    case KindFunctionExpression:
    case "KindMethodDeclaration":
    case "KindGetAccessor":
    case "KindSetAccessor": {
      return planCallableExpression(node, context);
    }
    case "KindRegularExpressionLiteral": {
      return planRegExpCreate(node, context);
    }
    case "KindAwaitExpression": {
      const awaitFact = rustOperationFact(node, context);
      if (awaitFact === undefined || awaitFact.kind !== "await-op") {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.async",
          "Await expressions require a finalized future output fact.",
        ));
        return undefined;
      }
      if (!requireExpressionCarrier(node, awaitFact.resultCarrier, context, "rust.backend.await-carrier")) {
        return undefined;
      }
      const operand = Node_Expression(context.input.program.source.ast, node);
      const planned = operand === undefined ? undefined : planExpression(operand, context);
      if (planned === undefined) {
        return undefined;
      }
      let awaited: RustExpr = { kind: "await", expr: planned };
      const future = operand === undefined
        ? undefined
        : context.input.program.facts.getFact(operand, rustFutureValueFactKey);
      const operandCarrier = operand === undefined
        ? undefined
        : context.input.program.facts.getRuntimeCarrierFact(operand)?.carrier;
      if (future === undefined || !rustFutureValueMatchesCarrier(future, operandCarrier) ||
        !rustTargetTypeRefEquals(awaitFact.resultCarrier, future.outputCarrier)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.await-future-value",
          "Awaited expression requires one compatible finalized future-value fact.",
        ));
        return undefined;
      }
      if (future.awaiting === "fallible") {
        const activeErrorType = rustActiveErrorType(context);
        if (activeErrorType === undefined) {
          context.diagnostics.push(unsupportedConstructDiagnostic(
            diagnosticInput(context, node),
            "rust.error.call",
            "Fallible awaits require a finalized fallible lowering context.",
          ));
          return undefined;
        }
        if (future.errorBoundary === "none") {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.await-error-boundary",
            "A finalized fallible Rust future requires one exact error boundary.",
          ));
          return undefined;
        }
        awaited = applyRustErrorBoundary(
          awaited,
          future.errorBoundary,
          activeErrorType,
          rustTypeFromCarrierInContext(future.errorCarrier, context),
        );
      }
      const converted = applyFinalizedValueConversion(
        context,
        awaited,
        future.awaitedConversion,
        node,
        "operation-result",
      );
      if (converted === undefined || !isRustNeverCarrier(awaitFact.resultCarrier)) {
        return converted;
      }
      return future.awaiting === "fallible"
        ? rustBottomAfterEffect(converted, "fallible never await returned")
        : rustBottomExpression(converted);
    }
    case "KindYieldExpression": {
      const generator = context.generator;
      const fact = context.input.program.facts.getFact(node, rustYieldFactKey);
      if (generator === undefined || fact === undefined ||
        fact.generatorDeclaration !== generator.declaration ||
        !rustTargetTypeRefEquals(fact.yieldType, generator.protocol.yieldType) ||
        (fact.kind === "value" &&
          !rustTargetTypeRefEquals(fact.resultType, generator.protocol.nextType))) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.generator-yield",
          "Yield expressions require an exact finalized fact owned by the active generator.",
        ));
        return undefined;
      }
      if (fact.kind === "delegate") {
        const delegated = getRustGeneratorProtocol(fact.delegatedCarrier);
        const operand = Node_Expression(context.input.program.source.ast, node);
        if (delegated === undefined || operand === undefined ||
          !rustTargetTypeRefEquals(delegated.yieldType, generator.protocol.yieldType) ||
          !rustTargetTypeRefEquals(delegated.nextType, generator.protocol.nextType) ||
          !rustTargetTypeRefEquals(delegated.returnType, fact.resultType) ||
          !rustTargetTypeRefEquals(delegated.returnType, generator.protocol.returnType) ||
          (generator.protocol.kind === "sync" && delegated.kind !== "sync")) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.generator-delegation",
            "Delegated yield requires one compatible finalized Rust generator protocol.",
          ));
          return undefined;
        }
        if (!requireRustCarrierRequirements(delegated.nextType, ["default"], node, context) ||
          !requireRustCarrierRequirements(delegated.returnType, ["clone"], node, context)) {
          return undefined;
        }
        const delegate = planExpression(operand, context);
        if (delegate === undefined) {
          return undefined;
        }
        return planGeneratorResumeExpression({
          kind: "await",
          expr: {
            kind: "method-call",
            receiver: { kind: "path", path: generator.controllerName },
            method: delegated.kind === "sync" ? "yield_from" : "yield_from_async",
            args: [delegate],
          },
        }, context);
      }
      const operand = Node_Expression(context.input.program.source.ast, node);
      const value = operand === undefined
        ? ({ kind: "path", path: "()" } as const)
        : planExpression(operand, context);
      if (value === undefined) {
        return undefined;
      }
      return planGeneratorResumeExpression({
        kind: "await",
        expr: {
          kind: "method-call",
          receiver: { kind: "path", path: generator.controllerName },
          method: "yield_value",
          args: [value],
        },
      }, context);
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return planUnaryExpression(node, context, resultUse);
    }
    case KindBinaryExpression: {
      return planBinaryExpression(node, context);
    }
    case KindCallExpression: {
      return planCallExpression(node, context);
    }
    case KindNewExpression: {
      return planNewExpression(node, context);
    }
    case KindPropertyAccessExpression: {
      return planPropertyAccess(node, context);
    }
    case KindElementAccessExpression: {
      return planElementAccess(node, context);
    }
    default: {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.expression",
        "The Rust target does not support this expression.",
      ));
      return undefined;
    }
  }
}
