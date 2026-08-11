import type { Node } from "@tsonic/tsts";
import type {
  RustSelectedTargetOperation as TargetOperationFact,
  RustSelectedTargetSignature as SelectedTargetSignatureFact,
  TargetTypeRef,
} from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import {
  isRustBinaryOperator,
  rustBinaryOperatorTraitPath,
} from "../../common/rust-syntax.js";
import {
  KindBinaryExpression,
  KindBigIntLiteral,
  Node_Initializer,
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
  BinaryExpression_Left,
  BinaryExpression_Right,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
  Node_Operand,
  TemplateExpression_Head,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
  TemplateSpan_Literal,
} from "../../common/source-ast.js";
import {
  parseSourceBigIntLiteral,
  parseSourceIntegerLiteral,
} from "../../common/source-literal-values.js";
import { rustFutureValueFactKey, rustMutatedBindingFactKey, rustOptionWrapFactKey, rustPostCheckOperationKind, rustSourceBindingFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey, rustSourceTypeCarrierValue, rustTargetOperationFactKey, rustYieldFactKey } from "../../source/rust-facts/keys.js";
import type {
  RustArgumentMode,
  RustProviderConstantArgument,
  RustProviderChainStep,
  RustTargetOperationFact,
  RustValueConversion,
} from "../../source/rust-facts/keys.js";
import type {
  RustFinalizedSourceInput,
  RustFinalizedTargetInput,
  RustFinalizedValueConversion,
} from "../../source/rust-facts/finalized-operation-abi.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedConstantInput,
  isRustFinalizedSliceInput,
  validateRustFinalizedOperationAbi,
} from "../../source/rust-facts/finalized-operation-abi.js";
import { rustFutureValueMatchesCarrier } from "../../source/rust-facts/future-values.js";
import { rustValueConversionContract } from "../../source/rust-facts/value-conversions.js";
import {
  rustFinalizedCarrierTransitionMatches,
  rustTargetOperationText,
} from "../../source/rust-facts/target-operation.js";
import {
  rustArgumentPassingMode,
} from "../../source/rust-facts/parameter-passing.js";
import type { RustExpr } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { diagnosticInput, isValidRustIdentifier, registerAliasFromPath, rustSourceName, rustPublicName, sourceTypePath } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { isFloatCarrier, rustTypeFromCarrierInContext } from "./render-types.js";
import { getRustGeneratorProtocol, isRustBigIntCarrier, isRustBoolCarrier, isRustIntegerCarrier, isRustUnitCarrier, rustFutureOutputCarrier, rustPrimitiveTypeName, rustValueCarrierRequiresCloneOnRead, substituteRustTargetTypeParameters } from "../../source/rust-target-types.js";
import { requireRustCarrierRequirements } from "./generic-requirements.js";
import {
  planRustIdentifierValue,
  planRustNonConsumingValue,
  planRustPromotedStorageLocation,
  planRustTypedLocationCall,
} from "./typed-locations.js";
import {
  applyRustProviderLocationScope,
  planRustProviderLocationScope,
} from "./provider-location-scope.js";
import type {
  RustFinalizedInputPlanOverrides,
} from "./provider-location-scope.js";
import {
  applyRustSourceCallableRequirements,
} from "./source-callable-contracts.js";
import { applyRustTailShape, rustBlockTerminates } from "./block-flow.js";

export function planExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const diagnosticCount = context.diagnostics.length;
  const planned = planExpressionInner(node, context);
  if (planned === undefined) {
    if (context.diagnostics.length === diagnosticCount) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node ?? context.sourceFile),
        "rust.backend.expression-finalization",
        "Expression planning returned no Rust AST and no specific diagnostic.",
      ));
    }
    return undefined;
  }
  const wrap = context.input.facts.getFact(node, rustOptionWrapFactKey);
  return wrap?.wrap === true ? { kind: "call", path: "Some", args: [planned] } : planned;
}

function planExpressionInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const { ast } = context.input;
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
      return { kind: "string-literal", value: ast.text(node) };
    }
    case KindTrueKeyword: {
      return { kind: "bool-literal", value: true };
    }
    case KindFalseKeyword: {
      return { kind: "bool-literal", value: false };
    }
    case "KindThisExpression":
    case "KindThisKeyword": {
      return { kind: "path", path: "self" };
    }
    case "KindNullKeyword": {
      const fact = rustOperationFact(node, context);
      if (fact === undefined || fact.kind !== "option-none") {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.nullish",
          "null literals require a finalized Option lane fact.",
        ));
        return undefined;
      }
      return { kind: "none" };
    }
    case KindIdentifier: {
      const identifierFact = rustOperationFact(node, context);
      if (identifierFact !== undefined && identifierFact.kind === "option-none") {
        return { kind: "none" };
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
        const planned = planProviderOperationExpression(context, identifierFact, undefined, [], node);
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
      const binding = context.input.facts.getFact(node, rustSourceBindingFactKey);
      if (binding === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.value-reference",
          "Identifier expression has no finalized project-source binding or selected target value operation.",
        ));
        return undefined;
      }
      const name = rustSourceName(context, binding.sourceName);
      if (!isValidRustIdentifier(name)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.identifier",
          `Identifier '${ast.text(node)}' does not lower to a valid Rust identifier.`,
        ));
        return undefined;
      }
      const declarationModule = context.moduleNameByFileName.get(binding.fileName);
      return planRustIdentifierValue(
        node,
        declarationModule !== undefined && declarationModule !== context.moduleName
          ? `crate::${declarationModule}::${name}`
          : name,
        context,
      );
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(context.input.ast, node);
      return inner === undefined ? undefined : planExpression(inner, context);
    }
    case "KindAsExpression":
    case "KindTypeAssertionExpression": {
      return planSourceConversion(node, context);
    }
    case KindSatisfiesExpression:
    case KindNonNullExpression: {
      const fact = rustOperationFact(node, context);
      const inner = Node_Expression(context.input.ast, node);
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
    case KindConditionalExpression: {
      const fact = rustOperationFact(node, context);
      const conditionNode = ConditionalExpression_Condition(context.input.ast, node);
      const whenTrueNode = ConditionalExpression_WhenTrue(context.input.ast, node);
      const whenFalseNode = ConditionalExpression_WhenFalse(context.input.ast, node);
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
      return condition === undefined || whenTrue === undefined || whenFalse === undefined
        ? undefined
        : { kind: "conditional", condition, whenTrue, whenFalse };
    }
    case KindTemplateExpression: {
      return planTemplateExpression(node, context);
    }
    case KindTypeOfExpression: {
      const fact = rustOperationFact(node, context);
      const operandNode = Node_Expression(context.input.ast, node);
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
      return operand === undefined
        ? undefined
        : {
            kind: "evaluate-then",
            effect: operand,
            discard: isRustUnitCarrier(expressionCarrier(operandNode, context)) ? "unit" : "value",
            value: { kind: "string-literal", value: fact.result },
          };
    }
    case KindVoidExpression: {
      const fact = rustOperationFact(node, context);
      const operandNode = Node_Expression(context.input.ast, node);
      if (fact?.kind !== "void-expression" || operandNode === undefined ||
        !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.void-carrier") ||
        !selectedOperationMatches(
          context.input.facts.getSelectedTargetOperator(node),
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
        for (const element of context.input.ast.elements(node)) {
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
    case KindFunctionExpression: {
      const closureFact = rustOperationFact(node, context);
      if (closureFact === undefined || closureFact.kind !== "closure") {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure",
          "Callable expressions require a finalized closure fact.",
        ));
        return undefined;
      }
      if (!requireExpressionCarrier(node, closureFact.resultCarrier, context, "rust.backend.closure-carrier")) {
        return undefined;
      }
      const sourceParams = context.input.ast.parameters(node);
      if (closureFact.byRefCopyParams.length !== sourceParams.length) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-abi",
          "Callable-expression parameter count does not match its finalized Rust closure ABI.",
        ));
        return undefined;
      }
      const params: { name: string; byRefCopy: boolean }[] = [];
      for (const [index, parameter] of sourceParams.entries()) {
        if (parameter === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.closure-parameter",
            "Callable expression contains an undefined parameter slot.",
          ));
          return undefined;
        }
        const parameterName = rustSourceName(context, ast.text(ast.name(parameter) ?? parameter));
        if (!isValidRustIdentifier(parameterName)) {
          return undefined;
        }
        params.push({ name: parameterName, byRefCopy: closureFact.byRefCopyParams[index] === true });
      }
      const bodyNode = context.input.ast.body(node);
      if (bodyNode === undefined) {
        return undefined;
      }
      const closureContext: RustPlanContext = {
        ...context,
        emittedLocalNames: new Set(params.map((parameter) => parameter.name)),
        controlFlow: { nextLoopId: 0 },
        controlTargets: undefined,
        completionBoundary: undefined,
        fallibleContext: false,
        asyncContext: false,
        generator: undefined,
      };
      if (context.input.ast.kindName(bodyNode) !== "KindBlock") {
        const body = planExpression(bodyNode, closureContext);
        return body === undefined ? undefined : { kind: "closure", params, body };
      }
      const resultCarrier = closureFact.resultCarrier.kind === "function-pointer"
        ? closureFact.resultCarrier.result
        : undefined;
      const resultType = rustTypeFromCarrierInContext(resultCarrier, context);
      if (resultCarrier === undefined || resultType === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-result",
          "Block-bodied callable expressions require one finalized renderable result carrier.",
        ));
        return undefined;
      }
      const block = context.planBlock(bodyNode, {
        ...closureContext,
        functionReturnType: resultType,
      });
      if (block === undefined) {
        return undefined;
      }
      if (!isRustUnitCarrier(resultCarrier) && !rustBlockTerminates(block)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, bodyNode),
          "rust.backend.closure-return-flow",
          "Value-returning callable expressions require finalized control flow that returns on every path.",
        ));
        return undefined;
      }
      const blockParams = params.map((parameter, index) => ({
        name: parameter.name,
        mutable: sourceParams[index] !== undefined &&
          context.input.facts.getFact(sourceParams[index]!, rustMutatedBindingFactKey) !== undefined,
        byRefCopy: parameter.byRefCopy,
      }));
      const finalizedBlock = applyRustTailShape(block, !isRustUnitCarrier(resultCarrier));
      const onlyStatement = finalizedBlock.statements.length === 1
        ? finalizedBlock.statements[0]
        : undefined;
      if (onlyStatement?.kind === "tail" && blockParams.every((parameter) => !parameter.mutable)) {
        return {
          kind: "closure",
          params,
          body: onlyStatement.expr,
        };
      }
      return {
        kind: "closure-block",
        params: blockParams,
        move: false,
        async: false,
        body: finalizedBlock,
      };
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
      const operand = Node_Expression(context.input.ast, node);
      const planned = operand === undefined ? undefined : planExpression(operand, context);
      if (planned === undefined) {
        return undefined;
      }
      let awaited: RustExpr = { kind: "await", expr: planned };
      const future = operand === undefined
        ? undefined
        : context.input.facts.getFact(operand, rustFutureValueFactKey);
      const operandCarrier = operand === undefined
        ? undefined
        : context.input.facts.getRuntimeCarrierFact(operand)?.carrier;
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
        if (context.fallibleContext !== true) {
          context.diagnostics.push(unsupportedConstructDiagnostic(
            diagnosticInput(context, node),
            "rust.error.call",
            "Fallible awaits require a finalized fallible lowering context.",
          ));
          return undefined;
        }
        awaited = { kind: "try", expr: awaited };
      }
      return applyFinalizedValueConversion(
        context,
        awaited,
        future.awaitedConversion,
        node,
        "operation-result",
      );
    }
    case "KindYieldExpression": {
      const generator = context.generator;
      const fact = context.input.facts.getFact(node, rustYieldFactKey);
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
        const operand = Node_Expression(context.input.ast, node);
        if (delegated === undefined || operand === undefined ||
          !rustTargetTypeRefEquals(delegated.yieldType, generator.protocol.yieldType) ||
          !rustTargetTypeRefEquals(delegated.nextType, generator.protocol.nextType) ||
          !rustTargetTypeRefEquals(delegated.returnType, fact.resultType) ||
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
        return {
          kind: "await",
          expr: {
            kind: "method-call",
            receiver: { kind: "path", path: generator.controllerName },
            method: delegated.kind === "sync" ? "yield_from" : "yield_from_async",
            args: [delegate],
          },
        };
      }
      const operand = Node_Expression(context.input.ast, node);
      const value = operand === undefined
        ? ({ kind: "path", path: "()" } as const)
        : planExpression(operand, context);
      if (value === undefined) {
        return undefined;
      }
      return {
        kind: "await",
        expr: {
          kind: "method-call",
          receiver: { kind: "path", path: generator.controllerName },
          method: "yield_value",
          args: [value],
        },
      };
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return planUnaryExpression(node, context);
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
      const fixedIndexFact = rustOperationFact(node, context);
      if (fixedIndexFact !== undefined && fixedIndexFact.kind === "fixed-index") {
        const selected = context.input.facts.getSelectedTargetElementAccess(node);
        const resultCarrier = expressionCarrier(node, context);
        if (resultCarrier === undefined || !selectedOperationMatches(
          selected,
          fixedIndexFact.operationId,
          "indexer",
          resultCarrier,
        )) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.fixed-index-selected-evidence",
            "Fixed-array index fact conflicts with the TSTS-selected element-access fact.",
          ));
          return undefined;
        }
        const fixedReceiverNode = Node_Expression(context.input.ast, node);
        const fixedReceiver = fixedReceiverNode === undefined ? undefined : planExpression(fixedReceiverNode, context);
        const indexNode = ElementAccessExpression_ArgumentExpression(context.input.ast, node);
        if (fixedReceiver === undefined || indexNode === undefined) {
          return undefined;
        }
        const index = ast.kindName(indexNode) === KindNumericLiteral
          ? { kind: "int-literal" as const, text: String(fixedIndexFact.index) }
          : planExpression(indexNode, context);
        if (index === undefined) {
          return undefined;
        }
        const value: RustExpr = {
          kind: "index",
          receiver: fixedReceiver,
          index: { kind: "int-literal", text: String(fixedIndexFact.index) },
        };
        return ast.kindName(indexNode) === KindNumericLiteral
          ? value
          : { kind: "evaluate-then", effect: index, discard: "value", value };
      }
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

function planTemplateExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  const head = TemplateExpression_Head(context.input.ast, node);
  const spans = TemplateExpression_TemplateSpans(context.input.ast, node);
  if (fact?.kind !== "template-string" || head === undefined || spans === undefined ||
    !isDenseDataArray(spans) || spans.some((span) => span === undefined) ||
    spans.length !== fact.substitutions.length ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.template-carrier")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.template",
      "Template expression requires one exact finalized substitution contract.",
    ));
    return undefined;
  }
  const parts: RustExpr[] = [{ kind: "string-literal", value: context.input.ast.text(head) }];
  for (const [index, span] of (spans as readonly Node[]).entries()) {
    const expression = TemplateSpan_Expression(context.input.ast, span);
    const literal = TemplateSpan_Literal(context.input.ast, span);
    const substitution = fact.substitutions[index];
    const actualCarrier = expression === undefined
      ? undefined
      : context.input.facts.getRuntimeCarrierFact(expression)?.carrier;
    if (expression === undefined || literal === undefined || substitution === undefined ||
      substitution.expression !== expression || actualCarrier === undefined ||
      !rustTargetTypeRefEquals(actualCarrier, substitution.carrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, span),
        "rust.backend.template-substitution",
        "Template substitution conflicts with its finalized expression identity or carrier.",
      ));
      return undefined;
    }
    const value = planExpression(expression, context);
    if (value === undefined) {
      return undefined;
    }
    context.usedAliases?.add("rt");
    parts.push({
      kind: "call",
      path: "rt::source_string",
      args: [{ kind: "reference", expr: value }],
    });
    parts.push({ kind: "string-literal", value: context.input.ast.text(literal) });
  }
  return { kind: "string-concat", parts };
}

function planDeleteExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  const operand = Node_Expression(context.input.ast, node);
  const receiver = operand === undefined ? undefined : Node_Expression(context.input.ast, operand);
  const index = operand === undefined
    ? undefined
    : ElementAccessExpression_ArgumentExpression(context.input.ast, operand);
  if (fact?.kind !== "provider-operation" || fact.abi.operationKind !== "indexer" ||
    operand === undefined || context.input.ast.kindName(operand) !== KindElementAccessExpression ||
    receiver === undefined || index === undefined ||
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.delete-carrier") ||
    !selectedOperationMatches(
      context.input.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "indexer",
      fact.resultCarrier,
    ) || !requireProviderArgumentPassingFacts(context, fact, [index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.delete",
      "delete requires one exact finalized mutable JavaScript Array index operation.",
    ));
    return undefined;
  }
  const planned = planProviderOperationExpression(context, fact, receiver, [index], node);
  return planned === undefined
    ? undefined
    : finishProviderOperationExpression(context, fact, planned, node);
}

export function expressionCarrier(node: Node, context: RustPlanContext): TargetTypeRef | undefined {
  return context.input.facts.getRuntimeCarrierFact(node)?.carrier;
}

function requireExpressionCarrier(
  node: Node,
  expected: TargetTypeRef,
  context: RustPlanContext,
  capability: string,
): boolean {
  const actual = expressionCarrier(node, context);
  if (actual !== undefined && rustTargetTypeRefEquals(actual, expected)) {
    return true;
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    capability,
    "Finalized Rust operation result conflicts with the expression runtime carrier fact.",
  ));
  return false;
}

function rustOperationFact(node: Node, context: RustPlanContext): RustTargetOperationFact | undefined {
  return context.input.facts.getFact(node, rustTargetOperationFactKey);
}

function selectedOperationMatches(
  selected: TargetOperationFact | undefined,
  operationId: string,
  operationKind: TargetOperationFact["operationKind"],
  resultCarrier: TargetTypeRef,
  targetOperation?: string,
): boolean {
  const pendingKind = selected === undefined ? undefined : rustPostCheckOperationKind(selected.operationId);
  if (pendingKind === "binary") {
    return selected?.operationKind === operationKind && operationKind === "operator" &&
      selected.resultType === undefined && selected.targetOperation === "post-check-finalization";
  }
  const resultMatches = selected?.resultType !== undefined
    ? rustTargetTypeRefEquals(selected.resultType, resultCarrier)
    : pendingKind === "unary-minus" || pendingKind === "unary-plus";
  return selected !== undefined && selected.operationId === operationId &&
    selected.operationKind === operationKind && resultMatches &&
    (targetOperation === undefined || selected.targetOperation === targetOperation);
}

export function providerSelectedCallMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  context: RustPlanContext,
): boolean {
  if (!validateRustFinalizedOperationAbi(fact.abi)) {
    return false;
  }
  const selected = context.input.facts.getSelectedTargetCall(node);
  const expectedMemberKind = fact.abi.operationKind === "constructor" ? "constructor" : "method";
  return selected !== undefined && selected.member.id === fact.operationId &&
    selected.member.kind === expectedMemberKind && selected.member.returnType !== undefined &&
    rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) &&
    selected.member.parameters.length === fact.abi.sourceArguments.length &&
    selected.member.parameters.every((parameter, index) => {
      const sourceArgument = fact.abi.sourceArguments[index];
      return sourceArgument !== undefined && rustTargetTypeRefEquals(parameter.type, sourceArgument.carrier) &&
        parameter.passingMode === rustArgumentPassingMode(sourceArgument.mode);
    });
}

function planSourceConversion(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact === undefined || fact.kind !== "source-conversion") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.conversion",
      "Source assertion requires a finalized Rust conversion fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.conversion-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      fact.conversion === undefined ? "identity" : "runtime-conversion",
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.conversion-selected-evidence",
      "Source assertion conversion conflicts with its finalized runtime carrier or TSTS-selected operation fact.",
    ));
    return undefined;
  }
  const operand = Node_Expression(context.input.ast, node);
  const planned = operand === undefined ? undefined : planExpression(operand, context);
  if (planned === undefined || fact.conversion === undefined) {
    return planned;
  }
  return applyRustValueConversion(context, planned, fact.conversion, operand);
}

export function planNumericLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const carrier = context.input.facts.getFact(node, rustOptionWrapFactKey)?.wrap === true
    ? expressionCarrier(node, context)
    : context.input.facts.getTargetConversionFact(node)?.convertedType ?? expressionCarrier(node, context);
  if (carrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.literal-carrier",
      "Numeric literal has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  return planNumericLiteralWithCarrier(node, carrier, context);
}

function planBigIntLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const carrier = expressionCarrier(node, context);
  const value = parseSourceBigIntLiteral(context.input.ast.text(node));
  if (!isRustBigIntCarrier(carrier) || value === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.bigint-literal",
      "BigInt literal requires exact canonical text and a finalized arbitrary-precision Rust carrier.",
    ));
    return undefined;
  }
  context.usedAliases?.add("rt");
  return {
    kind: "call",
    path: "rt::BigInt::from_decimal_literal",
    args: [{ kind: "str-literal", value: value.toString(10) }],
  };
}

function planNumericLiteralWithCarrier(
  node: Node,
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const text = context.input.ast.text(node);
  if (isFloatCarrier(carrier)) {
    const floatText = text.includes(".") || text.includes("e") || text.includes("E") ? text : `${text}.0`;
    return { kind: "float-literal", text: floatText };
  }
  if (isRustIntegerCarrier(carrier)) {
    const value = parseSourceIntegerLiteral(text);
    if (value === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.literal-carrier",
        `Numeric literal '${text}' cannot lower to integer carrier.`,
      ));
      return undefined;
    }
    return { kind: "int-literal", text: value.toString(10) };
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.literal-carrier",
    "Numeric literal carrier is not a supported Rust numeric carrier.",
  ));
  return undefined;
}

function planUnaryExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  const operandNode = Node_Operand(context.input.ast, node);
  if (fact !== undefined && fact.kind === "source-conversion" && fact.conversion === undefined) {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.operator-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      fact.operationId,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.operator-selected-evidence",
        "Unary identity operation conflicts with the TSTS-selected operator fact.",
      ));
      return undefined;
    }
    return operandNode === undefined
      ? undefined
      : context.input.ast.kindName(operandNode) === KindNumericLiteral
        ? planNumericLiteralWithCarrier(operandNode, fact.resultCarrier, context)
        : planExpression(operandNode, context);
  }
  if (fact === undefined || fact.kind !== "operator-token") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      "Unary expression requires a finalized Rust operator fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.operator-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.facts.getSelectedTargetOperator(node),
    fact.operationId,
    "operator",
    fact.resultCarrier,
    fact.operator,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator-selected-evidence",
      "Unary Rust operator fact conflicts with the TSTS-selected operator fact.",
    ));
    return undefined;
  }
  if (fact.operator !== "-" && fact.operator !== "!") {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      `Unary operator '${fact.operator}' is only supported in statement position.`,
    ));
    return undefined;
  }
  const operand = operandNode === undefined
    ? undefined
    : context.input.ast.kindName(operandNode) === KindNumericLiteral
      ? planNumericLiteralWithCarrier(operandNode, fact.resultCarrier, context)
      : planExpression(operandNode, context);
  return operand === undefined ? undefined : { kind: "unary", operator: fact.operator, operand };
}

function planBinaryExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if ((fact?.kind === "operator-token" || fact?.kind === "string-concat") &&
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.operator-carrier")) {
    return undefined;
  }
  if ((fact?.kind === "operator-token" || fact?.kind === "string-concat") &&
    !selectedOperationMatches(
      context.input.facts.getSelectedTargetOperator(node),
      fact.operationId,
      "operator",
      fact.resultCarrier,
      rustTargetOperationText(fact),
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator-selected-evidence",
      "Binary Rust operator fact conflicts with the TSTS-selected operator fact.",
    ));
    return undefined;
  }
  if (fact !== undefined && fact.kind === "nullish-identity") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.nullish-carrier")) {
      return undefined;
    }
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    return leftNode === undefined ? undefined : planExpression(leftNode, context);
  }
  if (fact !== undefined && fact.kind === "option-coalesce") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const rightNode = BinaryExpression_Right(context.input.ast, node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
    if (left === undefined || right === undefined) {
      return undefined;
    }
    return { kind: "method-call", receiver: left, method: "unwrap_or", args: [right] };
  }
  if (fact !== undefined && fact.kind === "option-check") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const rightNode = BinaryExpression_Right(context.input.ast, node);
    const optionNode = fact.optionOperand === "left" ? leftNode : rightNode;
    const value = optionNode === undefined ? undefined : planExpression(optionNode, context);
    if (value === undefined) {
      return undefined;
    }
    return { kind: "method-call", receiver: value, method: fact.negated ? "is_some" : "is_none", args: [] };
  }
  if (fact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.operator",
      "Binary expression requires a finalized Rust operator fact.",
    ));
    return undefined;
  }
  const leftNode = BinaryExpression_Left(context.input.ast, node);
  const rightNode = BinaryExpression_Right(context.input.ast, node);
  const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
  const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
  if (left === undefined || right === undefined) {
    return undefined;
  }
  if (fact.kind === "string-concat") {
    const parts: RustExpr[] = [];
    for (const side of [left, right]) {
      if (side.kind === "string-concat") {
        parts.push(...side.parts);
      } else {
        parts.push(side);
      }
    }
    return { kind: "string-concat", parts };
  }
  if (fact.kind === "operator-token") {
    // Owned-String literals in comparison position lower as &str literals so
    // generated code stays clippy-clean (cmp_owned).
    const comparison = fact.operator === "==" || fact.operator === "!=";
    const comparisonLeft = comparison && leftNode !== undefined
      ? planRustNonConsumingValue(leftNode, left, context)
      : left;
    const comparisonRight = comparison && rightNode !== undefined
      ? planRustNonConsumingValue(rightNode, right, context)
      : right;
    const borrowLiteral = (side: RustExpr): RustExpr =>
      comparison && side.kind === "string-literal" ? { kind: "str-literal", value: side.value } : side;
    if (!isRustBinaryOperator(fact.operator)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.operator",
        "Binary expression selected a non-binary Rust operator fact.",
      ));
      return undefined;
    }
    const booleanComparison = planBooleanLiteralComparison(
      fact.operator,
      comparisonLeft,
      comparisonRight,
      leftNode,
      rightNode,
      context,
    );
    if (booleanComparison !== undefined) {
      return booleanComparison;
    }
    return {
      kind: "binary",
      operator: fact.operator,
      left: borrowLiteral(comparisonLeft),
      right: borrowLiteral(comparisonRight),
    };
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.operator",
    "Binary expression selected a non-operator Rust operation.",
  ));
  return undefined;
}

function planBooleanLiteralComparison(
  operator: string,
  left: RustExpr,
  right: RustExpr,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (operator !== "==" && operator !== "!=") {
    return undefined;
  }
  const literal = left.kind === "bool-literal"
    ? { value: left.value, other: right, otherNode: rightNode }
    : right.kind === "bool-literal"
      ? { value: right.value, other: left, otherNode: leftNode }
      : undefined;
  if (literal === undefined || literal.otherNode === undefined ||
    !isRustBoolCarrier(expressionCarrier(literal.otherNode, context))) {
    return undefined;
  }
  const negated = operator === "==" ? !literal.value : literal.value;
  return negated
    ? { kind: "unary", operator: "!", operand: literal.other }
    : literal.other;
}

function planArguments(node: Node, context: RustPlanContext): readonly RustExpr[] | undefined {
  const args: RustExpr[] = [];
  for (const argument of context.input.ast.arguments(node)) {
    if (argument === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.call-argument",
        "Call expression contains an undefined argument slot.",
      ));
      return undefined;
    }
    const planned = planExpression(argument, context);
    if (planned === undefined) {
      return undefined;
    }
    args.push(planned);
  }
  return args;
}

// An expression already borrowing (&str-carried identifiers) is passed
// bare; owned expressions take &.
function refShape(context: RustPlanContext, argument: RustExpr, node: Node | undefined): RustExpr {
  if (argument.kind === "string-literal") {
    return { kind: "str-literal", value: argument.value };
  }
  if (argument.kind === "vec-literal") {
    return { kind: "reference", expr: { kind: "slice-literal", elements: argument.elements } };
  }
  const carrier = node === undefined ? undefined : context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  if (carrier?.kind === "pointer") {
    return argument;
  }
  return { kind: "reference", expr: argument };
}

export function applyRustArgumentMode(
  context: RustPlanContext,
  argument: RustExpr,
  mode: RustArgumentMode,
  node: Node | undefined,
): RustExpr {
  if (mode === "ref") {
    return refShape(context, argument, node);
  }
  if (mode === "mut-ref") {
    return { kind: "reference", expr: argument, mutable: true };
  }
  return argument;
}

export function applyRustValueConversion(
  context: RustPlanContext,
  expression: RustExpr,
  conversion: RustValueConversion | undefined,
  node: Node | undefined,
  validateSourceCarrier = true,
): RustExpr | undefined {
  if (conversion === undefined) {
    return expression;
  }
  const contract = rustValueConversionContract(conversion);
  if (contract === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.value-conversion-contract",
      "Target value conversion has no closed Rust semantic conversion contract.",
    ));
    return undefined;
  }
  if (validateSourceCarrier) {
    const sourceCarrier = node === undefined
      ? undefined
      : context.input.facts.getRuntimeCarrierFact(node)?.carrier;
    if (sourceCarrier === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node ?? context.sourceFile),
        "rust.backend.value-conversion-source",
        "Target value conversion has no finalized source carrier evidence.",
      ));
      return undefined;
    }
    if (!rustTargetTypeRefEquals(sourceCarrier, contract.source)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node ?? context.sourceFile),
        "rust.backend.value-conversion-source",
        "Target value conversion source does not match the finalized source carrier.",
      ));
      return undefined;
    }
  }
  registerAliasFromPath(context, contract.path);
  const nonConsumingSource = contract.sourceMode === "ref" && node !== undefined
    ? planRustNonConsumingValue(node, expression, context)
    : expression;
  const source = contract.sourceMode === "ref"
    ? applyRustArgumentMode(context, nonConsumingSource, "ref", node)
    : nonConsumingSource;
  const call: RustExpr = { kind: "call", path: contract.path, args: [source] };
  if (!contract.fallible) {
    return call;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.value-conversion",
      "Fallible target value conversion requires a finalized fallible lowering context.",
    ));
    return undefined;
  }
  return { kind: "try", expr: call };
}

function providerConstantExpression(argument: RustProviderConstantArgument): RustExpr {
  switch (argument.kind) {
    case "integer":
      return { kind: "int-literal", text: String(argument.value) };
    case "string":
      return { kind: "str-literal", value: argument.value };
    case "boolean":
      return { kind: "bool-literal", value: argument.value };
    case "none":
      return { kind: "none" };
  }
}

function planProviderOperationExpression(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
): RustExpr | undefined {
  if (!validateRustFinalizedOperationAbi(fact.abi)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-operation-abi",
      "Provider operation fact does not contain one valid total Rust operation ABI.",
    ));
    return undefined;
  }
  const abiResultCarrier = fact.abi.result.kind === "async"
    ? fact.abi.result.futureCarrier
    : fact.abi.result.carrier;
  if (!rustTargetTypeRefEquals(fact.resultCarrier, abiResultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-operation-result",
      "Provider operation result carrier conflicts with its finalized Rust operation ABI.",
    ));
    return undefined;
  }
  const locationScope = planRustProviderLocationScope(
    context,
    fact,
    receiverNode,
    argumentNodes,
    planExpression,
  );
  if (locationScope.kind === "failed") {
    return undefined;
  }
  const overrides = locationScope.kind === "selected"
    ? locationScope.overrides
    : undefined;
  const receiver = fact.abi.targetReceiver.kind === "input"
    ? planFinalizedSourceInput(
        context,
        fact.abi.targetReceiver.input,
        receiverNode,
        argumentNodes,
        operationNode,
        "target-receiver",
        overrides,
      )
    : undefined;
  if (fact.abi.targetReceiver.kind === "input" && receiver === undefined) {
    return undefined;
  }
  const args: RustExpr[] = [];
  for (const input of fact.abi.targetArguments) {
    const planned = planFinalizedTargetInput(
      context,
      input,
      receiverNode,
      argumentNodes,
      operationNode,
      overrides,
    );
    if (planned === undefined) {
      return undefined;
    }
    args.push(planned);
  }
  const form = fact.abi.target;
  const scoped = (expression: RustExpr | undefined): RustExpr | undefined =>
    expression === undefined || locationScope.kind !== "selected"
      ? expression
      : applyRustProviderLocationScope(expression, locationScope);
  switch (form.form) {
    case "marker":
      return undefined;
    case "arg-method": {
      if (receiver === undefined || fact.abi.targetReceiver.kind !== "input") {
        return undefined;
      }
      const typedReceiver = typeNumericMethodReceiverLiteral(
        receiver,
        fact.abi.targetReceiver.input.parameterCarrier,
      );
      if (typedReceiver === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, operationNode),
          "rust.backend.arg-method-receiver-type",
          "Argument-method literal receiver requires an explicit finalized Rust numeric receiver carrier.",
        ));
        return undefined;
      }
      return scoped({ kind: "method-call", receiver: typedReceiver, method: form.name, args });
    }
    case "call": {
      registerAliasFromPath(context, form.path);
      return scoped(applyProviderOperationChain({ kind: "call", path: form.path, args }, form.chain));
    }
    case "call-value-slice":
    case "call-value-array":
    case "call-str-slice":
    case "free-call-str-slice":
    case "free-call": {
      registerAliasFromPath(context, form.path);
      return scoped({ kind: "call", path: form.path, args });
    }
    case "path": {
      registerAliasFromPath(context, form.path);
      return scoped(args.length === 0 ? { kind: "path", path: form.path } : undefined);
    }
    case "method":
    case "arg-receiver-method":
    case "receiver-value-array":
      return scoped(receiver === undefined
        ? undefined
        : { kind: "method-call", receiver, method: form.name, args });
    case "receiver-method":
      return receiver === undefined
        ? undefined
        : scoped(applyProviderOperationChain(
            { kind: "method-call", receiver, method: form.name, args },
            form.chain,
          ));
    case "field": {
      return scoped(receiver === undefined || args.length !== 0
        ? undefined
        : { kind: "field", receiver, name: form.name });
    }
    case "index": {
      if (receiver === undefined || args.length !== 1) {
        return undefined;
      }
      const index = args[0];
      return scoped(index === undefined
        ? undefined
        : { kind: "index", receiver, index });
    }
    case "binary-operator": {
      const [left, right] = args;
      if (left === undefined || right === undefined || args.length !== 2) {
        return undefined;
      }
      if (rustBinaryOperatorTraitPath(form.operator) !== form.trait) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, receiverNode ?? argumentNodes[0] ?? context.sourceFile),
          "rust.backend.provider-operator-trait",
          "Provider binary operation does not carry the exact finalized Rust trait identity for its operator.",
        ));
        return undefined;
      }
      return scoped({ kind: "binary", operator: form.operator, left, right });
    }
  }
}

function typeNumericMethodReceiverLiteral(
  expression: RustExpr,
  carrier: TargetTypeRef,
): RustExpr | undefined {
  if (expression.kind === "unary" && expression.operator === "-") {
    const operand = typeNumericMethodReceiverLiteral(expression.operand, carrier);
    return operand === undefined ? undefined : { ...expression, operand };
  }
  if (expression.kind !== "float-literal" && expression.kind !== "int-literal") {
    return expression;
  }
  if (carrier.kind !== "source-primitive") {
    return undefined;
  }
  const suffix = rustPrimitiveTypeName(carrier.name);
  return suffix === undefined
    ? undefined
    : { ...expression, text: `${expression.text}${suffix}` };
}

function applyProviderOperationChain(
  expression: RustExpr,
  chain: readonly RustProviderChainStep[] | undefined,
): RustExpr | undefined {
  let result = expression;
  for (const step of chain ?? []) {
    if (step.kind !== "method") {
      return undefined;
    }
    result = { kind: "method-call", receiver: result, method: step.name, args: [] };
  }
  return result;
}

function finishProviderOperationExpression(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  expression: RustExpr,
  node: Node,
): RustExpr | undefined {
  let raw = expression;
  if (fact.abi.effects.invocation === "fallible") {
    if (context.fallibleContext !== true) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.error.call",
        "Fallible operations require a finalized fallible lowering context.",
      ));
      return undefined;
    }
    raw = { kind: "try", expr: raw };
  }
  return fact.abi.result.kind === "async"
    ? raw
    : applyFinalizedValueConversion(context, raw, fact.abi.result.conversion, node, "operation-result");
}

export function planFinalizedTargetInput(
  context: RustPlanContext,
  input: RustFinalizedTargetInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  overrides?: RustFinalizedInputPlanOverrides,
): RustExpr | undefined {
  if (isRustFinalizedConstantInput(input)) {
    return providerConstantExpression(input.source.value);
  }
  if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
    const elements: RustExpr[] = [];
    for (const element of input.elements) {
      const planned = planFinalizedSourceInput(
        context,
        element,
        receiverNode,
        argumentNodes,
        operationNode,
        "target-argument",
        overrides,
      );
      if (planned === undefined) {
        return undefined;
      }
      const asTargetElement = element.parameterCarrier.kind === "pointer" &&
        element.parameterCarrier.pointee.kind === "target-named" &&
        element.parameterCarrier.pointee.id === "rust.std.String"
        ? planned.kind === "string-literal"
          ? { kind: "str-literal", value: planned.value } as RustExpr
          : planned.kind === "reference"
            ? { kind: "method-call", receiver: planned.expr, method: "as_str", args: [] } as RustExpr
            : planned
        : planned;
      elements.push(asTargetElement);
    }
    return isRustFinalizedSliceInput(input)
      ? { kind: "reference", expr: { kind: "slice-literal", elements } }
      : { kind: "slice-literal", elements };
  }
  return planFinalizedSourceInput(
    context,
    input,
    receiverNode,
    argumentNodes,
    operationNode,
    "target-argument",
    overrides,
  );
}

export function planFinalizedSourceInput(
  context: RustPlanContext,
  input: RustFinalizedSourceInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  position: "target-argument" | "target-receiver" = "target-argument",
  overrides?: RustFinalizedInputPlanOverrides,
): RustExpr | undefined {
  const sourceNode = input.source.kind === "receiver"
    ? receiverNode
    : argumentNodes[input.source.sourceIndex];
  if (sourceNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-operation-input",
      "Finalized Rust operation input has no corresponding source node.",
    ));
    return undefined;
  }
  const sourceCarrier = context.input.facts.getRuntimeCarrierFact(sourceNode)?.carrier;
  const convertedCarrier = context.input.facts.getTargetConversionFact(sourceNode)?.convertedType;
  if (sourceCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-source-carrier",
      "Finalized Rust operation input has no independent source carrier fact.",
    ));
    return undefined;
  }
  if (!rustFinalizedCarrierTransitionMatches(sourceCarrier, convertedCarrier, input.sourceCarrier)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-input-carrier",
      "Finalized Rust operation input conflicts with its independent source or selected call-argument carrier fact.",
    ));
    return undefined;
  }
  const inputOverride = overrides?.inputs.get(input);
  if (inputOverride !== undefined) {
    return inputOverride;
  }
  const plannedExpression = overrides?.sourceValues.get(sourceNode) ??
    planExpression(sourceNode, context);
  if (plannedExpression === undefined) {
    return undefined;
  }
  const expression = input.conversion.kind === "identity" &&
      (position === "target-receiver" || input.mode !== "value")
    ? planRustNonConsumingValue(sourceNode, plannedExpression, context)
    : plannedExpression;
  const converted = applyFinalizedValueConversion(context, expression, input.conversion, sourceNode, "source-input");
  return converted === undefined
    ? undefined
    : position === "target-receiver"
      ? converted
      : applyFinalizedArgumentMode(
          converted,
          input,
          context.input.facts.getFact(sourceNode, rustSourceParameterAbiFactKey),
        );
}

function applyFinalizedArgumentMode(
  expression: RustExpr,
  input: RustFinalizedSourceInput,
  sourceParameterAbi: import("../../source/rust-facts/keys.js").RustSourceParameterAbiFact | undefined,
): RustExpr {
  if (input.mode === "value" || input.conversion.targetCarrier.kind === "pointer") {
    return expression;
  }
  if (sourceParameterAbi?.mode === input.mode &&
    rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, input.parameterCarrier)) {
    return expression;
  }
  if (input.mode === "mut-ref") {
    return { kind: "reference", expr: expression, mutable: true };
  }
  if (expression.kind === "string-literal") {
    return { kind: "str-literal", value: expression.value };
  }
  if (expression.kind === "vec-literal") {
    return { kind: "reference", expr: { kind: "slice-literal", elements: expression.elements } };
  }
  return { kind: "reference", expr: expression };
}

export function applyFinalizedValueConversion(
  context: RustPlanContext,
  expression: RustExpr,
  conversion: RustFinalizedValueConversion,
  node: Node,
  position: "source-input" | "operation-result",
): RustExpr | undefined {
  return conversion.kind === "identity"
    ? expression
    : applyRustValueConversion(
        context,
        expression,
        conversion.conversion,
        node,
        position === "source-input",
      );
}

function planCallExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const { ast } = context.input;
  const fact = rustOperationFact(node, context);
  const callCarrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const selectedResultCarrier = fact?.kind === "source-call" ||
      fact?.kind === "provider-operation" || fact?.kind === "typed-location"
    ? fact.resultCarrier
    : undefined;
  if (selectedResultCarrier !== undefined &&
    (callCarrier === undefined || !rustTargetTypeRefEquals(callCarrier, selectedResultCarrier))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.call-result-carrier",
      "Call runtime carrier conflicts with its finalized selected operation result carrier.",
    ));
    return undefined;
  }
  const sourceCallEffects = fact?.kind === "source-call"
    ? context.input.facts.getFact(node, rustSourceCallEffectsFactKey)
    : undefined;
  if (fact?.kind === "source-call" && !sourceCallEffectsMatch(fact, sourceCallEffects)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-effects",
      "Project-source call requires one structurally consistent finalized invocation/await effect fact.",
    ));
    return undefined;
  }
  const callee = Node_Expression(context.input.ast, node);
  if (fact?.kind === "typed-location") {
    return planRustTypedLocationCall(node, fact, context, planExpression);
  }
  if (fact !== undefined && fact.kind === "flow-marker") {
    const args = planArguments(node, context);
    if (args === undefined || args.length !== 1) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-marker",
        "Flow marker call requires exactly one finalized argument expression.",
      ));
      return undefined;
    }
    // Flow marker calls erase to their argument; passing shape comes from the
    // consuming position's finalized argument modes.
    const [argument] = args;
    return argument;
  }
  if (fact !== undefined && fact.kind === "source-call") {
    const args = planArguments(node, context);
    if (args === undefined) {
      return undefined;
    }
    return planSelectedSourceCall(node, callee, args, fact, context);
  }
  if (fact !== undefined && fact.kind === "provider-operation") {
    if (fact.abi.operationKind !== "method") {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.provider.call-kind",
        `Call expression requires a finalized provider method fact, received '${fact.abi.operationKind}'.`,
      ));
      return undefined;
    }
    if (!providerSelectedCallMatches(node, fact, context)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.provider-call-selected-signature",
        "Provider call ABI conflicts with the TSTS-selected target member ABI.",
      ));
      return undefined;
    }
    const receiverNode = callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression
      ? Node_Expression(context.input.ast, callee)
      : undefined;
    const providerArgumentNodes = [...context.input.ast.arguments(node)];
    if (providerArgumentNodes.length !== fact.abi.sourceArguments.length) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.provider-call-arity",
        `Provider call has ${providerArgumentNodes.length} source arguments but its finalized ABI requires ${fact.abi.sourceArguments.length}.`,
      ));
      return undefined;
    }
    if (!requireProviderArgumentPassingFacts(context, fact, providerArgumentNodes)) {
      return undefined;
    }
    const diagnosticCount = context.diagnostics.length;
    const planned = planProviderOperationExpression(
      context,
      fact,
      receiverNode,
      providerArgumentNodes,
      node,
    );
    if (planned === undefined && context.diagnostics.length === diagnosticCount) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.provider.call",
        "Provider call operation could not be lowered.",
      ));
    }
    if (planned === undefined) {
      return undefined;
    }
    return finishProviderOperationExpression(context, fact, planned, node);
  }
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.call",
    "Call expression has no finalized Rust operation fact.",
  ));
  return undefined;
}

function sourceCallEffectsMatch(
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  effects: import("../../source/rust-facts/keys.js").RustSourceCallEffectsFact | undefined,
): boolean {
  if (effects === undefined ||
    (effects.invocation !== "infallible" && effects.invocation !== "fallible") ||
    (effects.awaiting !== "not-applicable" && effects.awaiting !== "infallible" && effects.awaiting !== "fallible")) {
    return false;
  }
  const isAsync = rustFutureOutputCarrier(fact.resultCarrier) !== undefined;
  return isAsync
    ? effects.invocation === "infallible" && effects.awaiting !== "not-applicable"
    : effects.awaiting === "not-applicable";
}

function planSelectedSourceCall(
  node: Node,
  callee: Node | undefined,
  args: readonly RustExpr[],
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.facts.getSelectedTargetCall(node);
  const selectedMatches = selected !== undefined && sourceCallSelectedMemberMatches(fact, selected);
  if (!selectedMatches) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-selected-signature",
      "Selected project-source call fact conflicts with the TSTS-selected target member ABI.",
    ));
    return undefined;
  }
  if (!applyRustSourceCallableRequirements(node, selected, fact, context)) {
    return undefined;
  }
  if (fact.parameterCarriers.length !== fact.argumentModes.length || args.length !== fact.parameterCarriers.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-abi",
      "Selected project-source call has an incomplete finalized Rust parameter ABI.",
    ));
    return undefined;
  }
  const rawArgumentNodes = context.input.ast.arguments(node);
  if (!isDenseDataArray(rawArgumentNodes) || rawArgumentNodes.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-arguments",
      "Selected project-source call contains an undefined or non-data argument slot.",
    ));
    return undefined;
  }
  const argumentNodes = rawArgumentNodes as readonly Node[];
  if (argumentNodes.length !== args.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-arguments",
      "Selected project-source call arguments do not match the finalized Rust expression plan.",
    ));
    return undefined;
  }
  const shaped: RustExpr[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const argumentNode = argumentNodes[index];
    const parameterCarrier = fact.parameterCarriers[index];
    const mode = fact.argumentModes[index];
    if (argument === undefined || argumentNode === undefined || parameterCarrier === undefined || mode === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, argumentNode ?? node),
        "rust.backend.source-call-abi",
        `Selected project-source call argument ${index} has incomplete finalized ABI evidence.`,
      ));
      return undefined;
    }
    const convertedCarrier = context.input.facts.getTargetConversionFact(argumentNode)?.convertedType;
    const sourceCarrier = context.input.facts.getRuntimeCarrierFact(argumentNode)?.carrier;
    if (sourceCarrier === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, argumentNode),
        "rust.backend.source-call-argument-carrier",
        `Project-source call argument ${index} has no finalized source carrier.`,
      ));
      return undefined;
    }
    const expectedPassingMode = rustArgumentPassingMode(mode);
    const passingFact = context.input.facts.getArgumentPassingFact(argumentNode);
    if (passingFact === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, argumentNode),
        "rust.backend.source-call-parameter-passing",
        `Project-source call argument ${index} requires finalized parameter-passing mode '${expectedPassingMode}'.`,
      ));
      return undefined;
    }
    if (passingFact.mode !== expectedPassingMode) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, argumentNode),
        "rust.backend.source-call-parameter-passing",
        `Project-source call argument ${index} has parameter-passing mode '${passingFact.mode}', expected '${expectedPassingMode}'.`,
      ));
      return undefined;
    }
    if (mode === "value") {
      if (!rustFinalizedCarrierTransitionMatches(sourceCarrier, convertedCarrier, parameterCarrier)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, argumentNode),
          "rust.backend.source-call-argument-carrier",
          `Project-source call argument ${index} does not match its finalized by-value parameter carrier.`,
        ));
        return undefined;
      }
      shaped.push(argument);
      continue;
    }
    if (parameterCarrier.kind !== "pointer") {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, argumentNode),
        "rust.backend.source-call-parameter-mode",
        `Project-source call argument ${index} has a borrow mode without a pointer parameter carrier.`,
      ));
      return undefined;
    }
    const mutable = mode === "mut-ref";
    if ((parameterCarrier.mutability === "mut") !== mutable) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, argumentNode),
        "rust.backend.source-call-parameter-mode",
        `Project-source call argument ${index} has inconsistent finalized pointer mutability and passing mode.`,
      ));
      return undefined;
    }
    if (sourceCarrier === undefined || !rustTargetTypeRefEquals(sourceCarrier, parameterCarrier.pointee)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, argumentNode),
        "rust.backend.source-call-argument-carrier",
        `Project-source call argument ${index} cannot borrow into its finalized pointer parameter carrier.`,
      ));
      return undefined;
    }
    if (convertedCarrier !== undefined && !rustTargetTypeRefEquals(convertedCarrier, parameterCarrier)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, argumentNode),
        "rust.backend.source-call-converted-carrier",
        `Project-source call argument ${index} has a finalized converted carrier inconsistent with its borrow parameter carrier.`,
      ));
      return undefined;
    }
    const sourceParameterAbi = context.input.facts.getFact(argumentNode, rustSourceParameterAbiFactKey);
    shaped.push(sourceParameterAbi?.mode === mode &&
      rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, parameterCarrier)
      ? argument
      : argument.kind === "string-literal" && !mutable
        ? { kind: "str-literal", value: argument.value }
        : { kind: "reference", expr: argument, ...(mutable ? { mutable: true } : {}) });
  }

  let planned: RustExpr | undefined;
  switch (fact.target.form) {
    case "function": {
      const moduleName = context.moduleNameByFileName.get(fact.target.fileName);
      if (moduleName === undefined || !isValidRustIdentifier(fact.target.name)) {
        break;
      }
      planned = {
        kind: "call",
        path: moduleName === context.moduleName
          ? fact.target.name
          : `crate::${moduleName}::${fact.target.name}`,
        args: shaped,
      };
      break;
    }
    case "method": {
      const receiverNode = callee !== undefined && context.input.ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(context.input.ast, callee)
        : undefined;
      const promoted = receiverNode === undefined || !fact.target.mutatesSelf
        ? { kind: "not-promoted" as const }
        : planRustPromotedStorageLocation(
            receiverNode,
            context,
            planExpression,
            shaped.length > 0,
          );
      if (promoted.kind === "promoted") {
        if (promoted.expression === undefined) {
          break;
        }
        planned = planPromotedSourceMethodCall(
          promoted.expression,
          fact.target.name,
          shaped,
        );
        break;
      }
      const receiver = receiverNode === undefined
        ? undefined
        : planExpression(receiverNode, context);
      if (receiver !== undefined) {
        planned = {
          kind: "method-call",
          receiver,
          method: fact.target.name,
          args: shaped,
        };
      }
      break;
    }
    case "static-method": {
      const value = rustSourceTypeCarrierValue(fact.target.typeCarrier);
      const typePath = value === undefined ? undefined : sourceTypePath(context, value);
      if (typePath !== undefined) {
        planned = { kind: "call", path: `${typePath}::${fact.target.name}`, args: shaped };
      }
      break;
    }
    case "constructor": {
      const value = rustSourceTypeCarrierValue(fact.target.typeCarrier);
      const typePath = value === undefined ? undefined : sourceTypePath(context, value);
      if (typePath !== undefined) {
        planned = { kind: "call", path: `${typePath}::new`, args: shaped };
      }
      break;
    }
  }
  if (planned === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-target",
      "Selected project-source call target does not resolve to a finalized Rust path or receiver operation.",
    ));
    return undefined;
  }
  const effects = context.input.facts.getFact(node, rustSourceCallEffectsFactKey);
  if (effects === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-effects",
      "Project-source call requires finalized post-fixpoint invocation and await effects.",
    ));
    return undefined;
  }
  if (effects.invocation === "infallible") {
    return planned;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.call",
      "Fallible calls require a fallible lowering context (a throwing function or a try block).",
    ));
    return undefined;
  }
  return { kind: "try", expr: planned };
}

function planPromotedSourceMethodCall(
  location: RustExpr,
  method: string,
  arguments_: readonly RustExpr[],
): RustExpr {
  const locationName = "__tsonic_location";
  const ownerName = "__tsonic_location_value";
  const argumentBindings = arguments_.map((value, index) => ({
    name: `__tsonic_location_argument_${index}`,
    value,
  }));
  const locationReceiver: RustExpr = arguments_.length === 0
    ? location
    : { kind: "path", path: locationName };
  const call: RustExpr = {
    kind: "method-call",
    receiver: { kind: "path", path: ownerName },
    method,
    args: argumentBindings.map((binding) => ({
      kind: "path",
      path: binding.name,
    })),
  };
  const mutation: RustExpr = {
    kind: "method-call",
    receiver: locationReceiver,
    method: "with_mut",
    args: [{
      kind: "closure",
      params: [{ name: ownerName, byRefCopy: false }],
      body: call,
    }],
  };
  return arguments_.length === 0
    ? mutation
    : {
        kind: "block",
        bindings: [{ name: locationName, value: location }, ...argumentBindings],
        value: mutation,
      };
}

export function sourceCallSelectedMemberMatches(
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  selected: SelectedTargetSignatureFact,
): boolean {
  const member = selected.member;
  const sourceTypeArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const targetTypeArguments = fact.targetTypeArguments ?? [];
  if (sourceTypeArguments.length !== targetTypeArguments.length) {
    return false;
  }
  const substitutions = new Map<string, TargetTypeRef>();
  for (let index = 0; index < sourceTypeArguments.length; index += 1) {
    substitutions.set(sourceTypeArguments[index]!.typeParameterName, targetTypeArguments[index]!);
  }
  const expectedKind = fact.target.form === "constructor" ? "constructor" : "method";
  const expectedTargetName = fact.target.form === "constructor" ? member.sourceName : fact.target.name;
  const selectedReturn = member.returnType === undefined
    ? undefined
    : substituteRustTargetTypeParameters(member.returnType, substitutions);
  return member.id === fact.operationId &&
    member.kind === expectedKind &&
    member.targetName === expectedTargetName &&
    selectedReturn !== undefined && rustTargetTypeRefEquals(selectedReturn, fact.resultCarrier) &&
    isDenseDataArray(member.parameters) && member.parameters.length === fact.parameterCarriers.length &&
    member.parameters.every((parameter, index) => {
      const mode = parameter.passingMode === "borrow-mut"
        ? "mut-ref"
        : parameter.passingMode === "borrow-shared"
          ? "ref"
          : "value";
      return rustTargetTypeRefEquals(
        substituteRustTargetTypeParameters(parameter.type, substitutions),
        fact.parameterCarriers[index],
      ) && mode === fact.argumentModes[index];
    });
}

export function requireProviderArgumentPassingFacts(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  arguments_: readonly (Node | undefined)[],
): boolean {
  if (!validateRustFinalizedOperationAbi(fact.abi) || arguments_.length !== fact.abi.sourceArguments.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, arguments_.find((candidate): candidate is Node => candidate !== undefined) ?? context.sourceFile),
      "rust.backend.provider-argument-abi",
      "Provider arguments require one valid total Rust operation ABI with exact source arity.",
    ));
    return false;
  }
  let valid = true;
  const requiresSelectedParameterPassingFact = fact.abi.operationKind === "method" ||
    fact.abi.operationKind === "constructor";
  for (const sourceArgument of fact.abi.sourceArguments) {
    const index = sourceArgument.sourceIndex;
    const argument = arguments_[index];
    if (argument === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, arguments_.find((candidate): candidate is Node => candidate !== undefined) ?? context.sourceFile),
        "rust.backend.provider-argument",
        `Provider operation selects missing source argument ${index}.`,
      ));
      valid = false;
      continue;
    }
    if (sourceArgument.disposition === "compile-time") {
      continue;
    }
    if (requiresSelectedParameterPassingFact) {
      const expected = rustArgumentPassingMode(sourceArgument.mode);
      const actual = context.input.facts.getArgumentPassingFact(argument);
      if (actual === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, argument),
          "rust.backend.parameter-passing",
          `Provider argument ${index} requires finalized Rust parameter-passing mode '${expected}'.`,
        ));
        valid = false;
        continue;
      }
      if (actual.mode !== expected) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, argument),
          "rust.backend.parameter-passing",
          `Provider argument ${index} has finalized parameter-passing mode '${actual.mode}', expected '${expected}'.`,
        ));
        valid = false;
      }
    }
    const sourceCarrier = context.input.facts.getRuntimeCarrierFact(argument)?.carrier;
    const convertedCarrier = context.input.facts.getTargetConversionFact(argument)?.convertedType;
    if (sourceCarrier === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, argument),
        "rust.backend.provider-argument-carrier",
        `Provider argument ${index} has no finalized source carrier fact.`,
      ));
      valid = false;
      continue;
    }
    if (!rustFinalizedCarrierTransitionMatches(sourceCarrier, convertedCarrier, sourceArgument.carrier)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, argument),
        "rust.backend.provider-argument-carrier",
        `Provider argument ${index} does not match its finalized source parameter carrier.`,
      ));
      valid = false;
    }
  }
  return valid;
}

function planRegExpCreate(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact === undefined || fact.kind !== "regexp-create") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.js.regexp",
      "RegExp expressions require a finalized constant-pattern fact.",
    ));
    return undefined;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.call",
      "Fallible calls require a fallible lowering context (a throwing function or a try block).",
    ));
    return undefined;
  }
  registerAliasFromPath(context, "js_abi::JsRegExp::new");
  return {
    kind: "try",
    expr: {
      kind: "call",
      path: "js_abi::JsRegExp::new",
      args: [
        { kind: "str-literal", value: fact.pattern },
        { kind: "str-literal", value: fact.flags },
      ],
    },
  };
}

function planNewExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "regexp-create") {
    return planRegExpCreate(node, context);
  }
  if (fact !== undefined && fact.kind === "source-call" && fact.target.form === "constructor") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.source-constructor-carrier")) {
      return undefined;
    }
    const args = planArguments(node, context);
    return args === undefined
      ? undefined
      : planSelectedSourceCall(node, Node_Expression(context.input.ast, node), args, fact, context);
  }
  if (fact === undefined || fact.kind !== "provider-operation" || fact.abi.operationKind !== "constructor") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.constructor",
      "Constructor expression requires a finalized provider constructor fact.",
    ));
    return undefined;
  }
  if (!providerSelectedCallMatches(node, fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-constructor-selected-signature",
      "Provider constructor ABI conflicts with the TSTS-selected target member ABI.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.provider-constructor-carrier")) {
    return undefined;
  }
  const argumentNodes = [...context.input.ast.arguments(node)];
  if (argumentNodes.length !== fact.abi.sourceArguments.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-constructor-arity",
      `Provider constructor has ${argumentNodes.length} source arguments but its finalized ABI requires ${fact.abi.sourceArguments.length}.`,
    ));
    return undefined;
  }
  if (!requireProviderArgumentPassingFacts(context, fact, argumentNodes)) {
    return undefined;
  }
  const diagnosticCount = context.diagnostics.length;
  const planned = planProviderOperationExpression(
    context,
    fact,
    undefined,
    argumentNodes,
    node,
  );
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.constructor",
      "Provider constructor operation could not be lowered.",
    ));
  }
  if (planned === undefined) {
    return undefined;
  }
  return finishProviderOperationExpression(context, fact, planned, node);
}

function planPropertyAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-field") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.source-field-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetProperty(node),
      fact.operationId,
      "property",
      fact.resultCarrier,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-field-selected-evidence",
        "Project-source field fact conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(context.input.ast, node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiver === undefined) {
      return undefined;
    }
    const field: RustExpr = { kind: "field", receiver, name: fact.name };
    return rustValueCarrierRequiresCloneOnRead(fact.resultCarrier)
      ? { kind: "method-call", receiver: field, method: "clone", args: [] }
      : field;
  }
  if (fact !== undefined && fact.kind === "source-enum-member") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.enum-member-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetProperty(node),
      fact.operationId,
      "property",
      fact.resultCarrier,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum-member-selected-evidence",
        "Project-source enum member fact conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const value = rustSourceTypeCarrierValue(fact.resultCarrier);
    const typePath = value === undefined ? undefined : sourceTypePath(context, value);
    if (typePath === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum",
        "Enum member access does not resolve to a generated Rust enum path.",
      ));
      return undefined;
    }
    return { kind: "path", path: `${typePath}::${fact.name}` };
  }
  if (fact === undefined || fact.kind !== "provider-operation" || fact.abi.operationKind !== "property") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.property",
      "Property access requires a finalized provider property fact.",
    ));
    return undefined;
  }
  const propertyResult = fact.abi.result.kind === "sync" ? fact.abi.result.carrier : fact.abi.result.futureCarrier;
  if (!requireExpressionCarrier(node, propertyResult, context, "rust.backend.provider-property-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    propertyResult,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-property-selected-evidence",
      "Provider property ABI conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  if (fact.abi.sourceArguments.length !== 0) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-property-abi",
      "Provider property access requires a finalized zero-argument ABI.",
    ));
    return undefined;
  }
  const diagnosticCount = context.diagnostics.length;
  const planned = planProviderOperationExpression(context, fact, Node_Expression(context.input.ast, node), [], node);
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.property",
      "Provider property operation could not be lowered.",
    ));
  }
  if (planned === undefined) {
    return undefined;
  }
  return finishProviderOperationExpression(context, fact, planned, node);
}

function planElementAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "tuple-index") {
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.ast, node);
    if (indexNode === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.tuple-index-source",
        "Tuple element fact has no concrete source index expression.",
      ));
      return undefined;
    }
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.tuple-index-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetElementAccess(node),
      fact.operationId,
      "indexer",
      fact.resultCarrier,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.tuple-index-selected-evidence",
        "Tuple element fact lacks a matching source index expression and TSTS-selected element-access fact.",
      ));
      return undefined;
    }
    const receiver = Node_Expression(context.input.ast, node);
    const planned = receiver === undefined ? undefined : planExpression(receiver, context);
    if (planned === undefined) {
      return undefined;
    }
    const value: RustExpr = { kind: "field", receiver: planned, name: String(fact.index) };
    if (context.input.ast.kindName(indexNode) === KindNumericLiteral) {
      return value;
    }
    const effect = planExpression(indexNode, context);
    return effect === undefined
      ? undefined
      : { kind: "evaluate-then", effect, discard: "value", value };
  }
  if (fact === undefined || fact.kind !== "provider-operation" || fact.abi.operationKind !== "indexer") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.indexer",
      "Element access requires a finalized provider indexer fact.",
    ));
    return undefined;
  }
  const elementResult = fact.abi.result.kind === "sync" ? fact.abi.result.carrier : fact.abi.result.futureCarrier;
  if (!requireExpressionCarrier(node, elementResult, context, "rust.backend.provider-indexer-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.facts.getSelectedTargetElementAccess(node),
    fact.operationId,
    "indexer",
    elementResult,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-indexer-selected-evidence",
      "Provider indexer ABI conflicts with the TSTS-selected element-access fact.",
    ));
    return undefined;
  }
  const argumentNode = ElementAccessExpression_ArgumentExpression(context.input.ast, node);
  if (fact.abi.sourceArguments.length !== 1) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-indexer-abi",
      "Provider indexer access requires a finalized one-argument ABI.",
    ));
    return undefined;
  }
  if (!requireProviderArgumentPassingFacts(context, fact, [argumentNode])) {
    return undefined;
  }
  const diagnosticCount = context.diagnostics.length;
  const planned = planProviderOperationExpression(context, fact, Node_Expression(context.input.ast, node), [argumentNode], node);
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.provider.indexer",
      "Provider indexer operation could not be lowered.",
    ));
  }
  if (planned === undefined) {
    return undefined;
  }
  return finishProviderOperationExpression(context, fact, planned, node);
}

export function planArrayLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "tuple-literal") {
    if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.tuple-literal-carrier")) {
      return undefined;
    }
    const elements: RustExpr[] = [];
    for (const element of context.input.ast.elements(node)) {
      if (element === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.tuple-element",
          "Tuple literal contains an undefined element slot.",
        ));
        return undefined;
      }
      const planned = planExpression(element, context);
      if (planned === undefined) {
        return undefined;
      }
      elements.push(planned);
    }
    return { kind: "tuple-literal", elements };
  }
  if (fact === undefined || fact.kind !== "array-literal") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.array-literal",
      "Array literals require a finalized Rust array lane fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.array-literal-carrier")) {
    return undefined;
  }
  const sourceElements = context.input.ast.elements(node);
  const hasHoles = sourceElements.some((element) =>
    element !== undefined && context.input.ast.kindName(element) === "KindOmittedExpression");
  const elements: RustExpr[] = [];
  for (const [index, element] of sourceElements.entries()) {
    if (element === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.array-element",
        "Array literal contains an undefined element slot.",
      ));
      return undefined;
    }
    if (context.input.ast.kindName(element) === "KindOmittedExpression") {
      continue;
    }
    const planned = planExpression(element, context);
    if (planned === undefined) {
      return undefined;
    }
    elements.push(fact.lane === "js" && hasHoles
      ? { kind: "tuple-literal", elements: [{ kind: "int-literal", text: String(index) }, planned] }
      : planned);
  }
  if (fact.lane === "native") {
    return { kind: "vec-literal", elements };
  }
  context.usedAliases?.add("js_abi");
  return {
    kind: "call",
    path: hasHoles ? "js_abi::JsArray::from_sparse" : "js_abi::JsArray::from_dense",
    args: hasHoles
      ? [{ kind: "int-literal", text: String(fact.length) }, { kind: "vec-literal", elements }]
      : [{ kind: "vec-literal", elements }],
  };
}

function planRecordLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact === undefined || fact.kind !== "record-literal") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Object literals require a finalized record shape fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.record-literal-carrier")) {
    return undefined;
  }
  const value = rustSourceTypeCarrierValue(fact.resultCarrier);
  const typePath = value === undefined ? undefined : sourceTypePath(context, value);
  if (typePath === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Object literal shape does not resolve to a generated Rust struct.",
    ));
    return undefined;
  }
  const { ast } = context.input;
  const fieldsBySourceName = new Map<string, RustExpr>();
  for (const property of ast.properties(node)) {
    if (property === undefined || ast.kindName(property) !== "KindPropertyAssignment") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, property ?? node),
        "rust.backend.record-fields",
        "Object literal contains a property without a finalized record-field assignment.",
      ));
      return undefined;
    }
    const nameNode = ast.name(property);
    const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
    const initializer = Node_Initializer(context.input.ast, property);
    const planned = initializer === undefined ? undefined : planExpression(initializer, context);
    if (sourceName.length === 0 || fieldsBySourceName.has(sourceName) || planned === undefined) {
      return undefined;
    }
    fieldsBySourceName.set(sourceName, planned);
  }
  if (fieldsBySourceName.size !== fact.fieldNames.length ||
    fact.fieldNames.some((fieldName) => !fieldsBySourceName.has(fieldName)) ||
    new Set(fact.fieldNames).size !== fact.fieldNames.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-fields",
      "Object literal properties do not match the finalized ordered record-field fact.",
    ));
    return undefined;
  }
  const fields: { name: string; value: RustExpr }[] = [];
  for (const sourceName of fact.fieldNames) {
    const fieldName = rustPublicName(sourceName).name;
    const value = fieldsBySourceName.get(sourceName);
    if (!isValidRustIdentifier(fieldName) || value === undefined) {
      return undefined;
    }
    fields.push({ name: fieldName, value });
  }
  return { kind: "struct-literal", path: typePath, fields };
}
