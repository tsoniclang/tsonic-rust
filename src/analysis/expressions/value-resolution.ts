import {
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
  KindBinaryExpression,
  KindCallExpression,
  KindConditionalExpression,
  KindElementAccessExpression,
  KindFalseKeyword,
  KindFunctionExpression,
  KindIdentifier,
  KindArrayLiteralExpression,
  KindBigIntLiteral,
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
  KindSpreadElement,
  KindTemplateExpression,
  KindTrueKeyword,
  KindTypeOfExpression,
  KindVoidExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import {
  rustFutureOutputCarrier,
  getRustGeneratorProtocol,
  isRustBigIntCarrier,
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustNullCarrier,
  isRustNumericCarrier,
  isRustNullishSourceCarrier,
  isRustOptionCarrier,
  isRustSourceStringConvertibleCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  isRustUndefinedCarrier,
  rustOptionElementCarrier,
  rustBigIntTargetType,
  rustNullTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUndefinedTargetType,
  rustSourceTypeCarrierValue,
} from "../../target-model/types/index.js";
import {
  rustGeneratorFactKey,
  rustTargetOperationFactKey,
  rustTargetOperationResultCarrier,
  rustYieldFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic, boolCarrier, checkedPropertySelectionInput, recordPolicySelection, rustOperationContext, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { parseSourceBigIntLiteral, sourceCharCodeUnit } from "../../target-model/syntax/literals.js";
import { rustTypeSemanticKey } from "../../target-model/semantics/index.js";
import { recordFinalizedOperatorSelection, resolvePostCheckBinaryCarrier, resolvePostCheckUnaryCarrier } from "../operations/operators.js";
import { recordTargetOperation, setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import { resolveArrayLiteralCarrier } from "../operations/inputs.js";
import { resolveCallLikeCarrier, resolveIdentifierCarrier } from "./references.js";
import { resolveExpressionCarrier } from "./carriers.js";
import { resolveFunctionExpressionCarrier } from "../callables/closures.js";
import { resolveRecordLiteralCarrier } from "./records.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectedSourceLiteralIsRepresentable, selectedSourceLiteralOperandIsRepresentable } from "../../policy/types/selected-numeric-literal.js";
import { selectRustCheckedPropertyAccess } from "../operations/provider/index.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function resolveExpressionCarrierUncached(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(expression);
  switch (kind) {
    case KindNumericLiteral: {
      const contextualExpected = expected !== undefined && isRustOptionCarrier(expected)
        ? rustOptionElementCarrier(expected)
        : expected;
      const effectiveExpected = contextualExpected ??
        rustSourcePrimitiveTargetType("float64");
      if (effectiveExpected !== undefined && isRustNumericCarrier(effectiveExpected) &&
        (!isRustIntegerCarrier(effectiveExpected) ||
          (selectedSourceLiteralIsRepresentable(
            expression,
            effectiveExpected.name,
            walk.context.ast,
          ) || selectedSourceLiteralOperandIsRepresentable(
            expression,
            effectiveExpected.name,
            walk.context.ast,
          )))) {
        return setCarrierFact(walk, expression, effectiveExpected);
      }
      if (effectiveExpected !== undefined && isRustIntegerCarrier(effectiveExpected)) {
        appendRustDiagnostic(
          walk,
          "RUST_INTEGER_LITERAL_NOT_EXACT",
          "Integer literal cannot be proven exact for the finalized Rust fixed-width carrier.",
          expression,
          [`target.carrier=${effectiveExpected.name}`],
        );
      }
      return undefined;
    }
    case KindBigIntLiteral: {
      const value = parseSourceBigIntLiteral(walk.context.ast.text(expression));
      if (value === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_BIGINT_LITERAL_INVALID",
          "BigInt literal text is not one exact TypeScript integer literal.",
          expression,
          ["target.capability=rust.syntax.bigint"],
        );
        return undefined;
      }
      const effectiveExpected = expected !== undefined && isRustOptionCarrier(expected)
        ? rustOptionElementCarrier(expected)
        : expected;
      if (effectiveExpected !== undefined && isRustIntegerCarrier(effectiveExpected)) {
        if (selectedSourceLiteralIsRepresentable(
          expression,
          effectiveExpected.name,
          walk.context.ast,
        ) || selectedSourceLiteralOperandIsRepresentable(
          expression,
          effectiveExpected.name,
          walk.context.ast,
        )) {
          return setCarrierFact(walk, expression, effectiveExpected);
        }
        appendRustDiagnostic(
          walk,
          "RUST_INTEGER_LITERAL_NOT_EXACT",
          "BigInt literal cannot be proven exact for the finalized Rust fixed-width carrier.",
          expression,
          [`target.carrier=${effectiveExpected.name}`],
        );
        return undefined;
      }
      const carrier = effectiveExpected ?? rustBigIntTargetType();
      if (!isRustBigIntCarrier(carrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_BIGINT_CARRIER_UNSUPPORTED",
          "BigInt literal requires the exact arbitrary-precision Rust BigInt carrier.",
          expression,
          ["target.capability=rust.syntax.bigint"],
        );
        return undefined;
      }
      return setCarrierFact(walk, expression, carrier);
    }
    case KindStringLiteral:
    case KindNoSubstitutionTemplateLiteral: {
      if (expected !== undefined) {
        if (expected.kind === "source-primitive" && expected.name === "char") {
          if (sourceCharCodeUnit(walk.context.ast.text(expression)) === undefined) {
            appendRustDiagnostic(
              walk,
              "RUST_CHAR_LITERAL_NOT_EXACT",
              "A neutral char literal must contain exactly one UTF-16 code unit.",
              expression,
              ["target.carrier=char"],
            );
            return undefined;
          }
          return setCarrierFact(walk, expression, expected);
        }
        const value = rustSourceTypeCarrierValue(expected);
        if (value !== undefined && value.shape === "enum") {
          const literal = walk.context.ast.text(expression);
          const variant = walk.sourceTypes.enumVariantForLiteral(expected, literal);
          if (variant !== undefined) {
            setRustOperationFact(walk, expression, {
              kind: "source-enum-member",
              operationId: `tsonic.rust.union.variant:${variant.name}`,
              name: variant.name,
              resultCarrier: expected,
            });
            return setCarrierFact(walk, expression, expected);
          }
        }
      }
      return setCarrierFact(walk, expression, rustStringTargetType());
    }
    case KindTemplateExpression: {
      return resolveTemplateExpressionCarrier(walk, expression, sourceFile);
    }
    case KindTrueKeyword:
    case KindFalseKeyword: {
      return setCarrierFact(walk, expression, boolCarrier);
    }
    case "KindNullKeyword": {
      return setCarrierFact(walk, expression, rustNullTargetType());
    }
    case "KindThisExpression":
    case "KindThisKeyword": {
      const thisCarrier = walk.currentThisCarrier;
      return thisCarrier === undefined ? undefined : setCarrierFact(walk, expression, thisCarrier);
    }
    case "KindSuperKeyword": {
      const superCarrier = walk.currentSuperCarrier;
      return superCarrier === undefined ? undefined : setCarrierFact(walk, expression, superCarrier);
    }
    case KindIdentifier: {
      return resolveIdentifierCarrier(walk, expression, sourceFile);
    }
    case KindArrayLiteralExpression: {
      return resolveArrayLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case "KindObjectLiteralExpression": {
      return resolveRecordLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case "KindArrowFunction":
    case KindFunctionExpression: {
      return resolveFunctionExpressionCarrier(walk, expression, sourceFile, expected);
    }
    case "KindRegularExpressionLiteral": {
      return undefined;
    }
    case "KindAwaitExpression": {
      const operand = Node_Expression(walk.context.ast, expression);
      const operandCarrier = operand === undefined
        ? undefined
        : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      const output = rustFutureOutputCarrier(operandCarrier);
      if (output === undefined) {
        return undefined;
      }
      setRustOperationFact(walk, expression, {
        kind: "await-op",
        operationId: "tsonic.rust.async.await",
        resultCarrier: output,
      });
      return setCarrierFact(walk, expression, output);
    }
    case "KindYieldExpression": {
      const generatorDeclaration = walk.currentGeneratorDeclaration;
      const source = walk.context.semantics(sourceFile).operations.yield(expression);
      if (generatorDeclaration === undefined || source === undefined ||
        source.generator.declaration !== generatorDeclaration) {
        appendRustDiagnostic(
          walk,
          "RUST_GENERATOR_YIELD_EVIDENCE_NOT_PROVEN",
          "Yield lowering requires exact TSTS evidence owned by the active generator declaration.",
          expression,
          ["target.capability=rust.generator.yield"],
        );
        return undefined;
      }
      const generator = walk.context.facts.get(generatorDeclaration, rustGeneratorFactKey);
      if (generator === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_GENERATOR_YIELD_PROTOCOL_CONFLICT",
          "The exact checked yield evidence conflicts with the active Rust generator protocol.",
          expression,
          ["target.capability=rust.generator.yield"],
        );
        return undefined;
      }
      const yieldType = generator.yieldType;
      const operand = source.operand?.expression;
      const delegatedCarrier = source.yieldKind === "delegate" && operand !== undefined
        ? resolveExpressionCarrier(walk, operand, sourceFile, undefined)
        : undefined;
      const delegatedProtocol = getRustGeneratorProtocol(delegatedCarrier);
      if (source.yieldKind === "delegate" &&
        (delegatedProtocol === undefined ||
          !rustTargetTypeRefEquals(delegatedProtocol.yieldType, generator.yieldType) ||
          !rustTargetTypeRefEquals(delegatedProtocol.nextType, generator.nextType) ||
          !rustTargetTypeRefEquals(delegatedProtocol.returnType, generator.returnType) ||
          (generator.kind === "sync" && delegatedProtocol.kind !== "sync"))) {
        appendRustDiagnostic(
          walk,
          "RUST_GENERATOR_DELEGATION_PROTOCOL_NOT_CLOSED",
          "The checked delegated yield has no compatible closed Rust generator protocol.",
          expression,
          ["target.capability=rust.generator.delegation"],
        );
        return undefined;
      }
      const resultType = source.yieldKind === "value"
        ? generator.nextType
        : delegatedProtocol?.returnType;
      if (resultType === undefined) {
        return undefined;
      }
      if (operand !== undefined) {
        resolveExpressionCarrier(
          walk,
          operand,
          sourceFile,
          source.yieldKind === "value" ? generator.yieldType : delegatedCarrier,
        );
      }
      walk.context.facts.set(expression, rustYieldFactKey, {
        generatorDeclaration,
        kind: source.yieldKind,
        yieldType,
        resultType,
        ...(delegatedCarrier === undefined ? {} : { delegatedCarrier }),
      }, [{ message: "rust checked yield" }]);
      return setCarrierFact(walk, expression, resultType);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
    }
    case "KindAsExpression":
    case "KindTypeAssertionExpression": {
      const inner = Node_Expression(walk.context.ast, expression);
      const constAssertion = walk.context.ast.isConstAssertion(expression);
      const defaultedExpected = expected === undefined && constAssertion &&
        inner !== undefined && walk.context.ast.kindName(inner) === KindNumericLiteral
        ? rustSourcePrimitiveTargetType("float64")
        : expected;
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, defaultedExpected);
      if (carrier === undefined) {
        return undefined;
      }
      if (constAssertion) {
        const fact: RustTargetOperationFact = {
          kind: "source-conversion",
          operationId: "tsonic.rust.assertion.const",
          resultCarrier: carrier,
        };
        setRustOperationFact(walk, expression, fact);
        recordFinalizedOperatorSelection(walk, expression, fact, carrier);
      }
      return setCarrierFact(walk, expression, carrier);
    }
    case KindSatisfiesExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      if (carrier === undefined) {
        return undefined;
      }
      const resultCarrier = expected ?? carrier;
      if (!rustTargetTypeRefEquals(carrier, resultCarrier)) {
        return undefined;
      }
      setRustOperationFact(walk, expression, {
        kind: "identity-expression",
        operationId: "tsonic.rust.syntax.satisfies",
        resultCarrier,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindNonNullExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const sourceCarrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, undefined);
      if (sourceCarrier === undefined) {
        return undefined;
      }
      const resultCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
      setRustOperationFact(walk, expression, {
        kind: "non-null-expression",
        operationId: rustTargetTypeRefEquals(sourceCarrier, resultCarrier)
          ? "tsonic.rust.syntax.non-null.identity"
          : "tsonic.rust.syntax.non-null.option-value",
        sourceCarrier,
        resultCarrier,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindSpreadElement: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined
        ? undefined
        : setCarrierFact(walk, expression, carrier);
    }
    case KindConditionalExpression: {
      const condition = ConditionalExpression_Condition(walk.context.ast, expression);
      const whenTrue = ConditionalExpression_WhenTrue(walk.context.ast, expression);
      const whenFalse = ConditionalExpression_WhenFalse(walk.context.ast, expression);
      if (condition === undefined || whenTrue === undefined || whenFalse === undefined) {
        return undefined;
      }
      const conditionCarrier = resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
      const semanticCarrier = expected ?? resolveRustTargetTypeRef(
        expression,
        rustResolutionContext(walk, expression),
        walk.operationOptions,
      );
      const trueCarrier = resolveExpressionCarrier(walk, whenTrue, sourceFile, semanticCarrier);
      const falseCarrier = resolveExpressionCarrier(walk, whenFalse, sourceFile, semanticCarrier ?? trueCarrier);
      const resultCarrier = semanticCarrier ?? trueCarrier;
      if (!isRustBoolCarrier(conditionCarrier) || resultCarrier === undefined ||
        trueCarrier === undefined || falseCarrier === undefined ||
        !rustTargetTypeRefEquals(trueCarrier, resultCarrier) ||
        !rustTargetTypeRefEquals(falseCarrier, resultCarrier)) {
        return undefined;
      }
      setRustOperationFact(walk, expression, {
        kind: "conditional",
        operationId: "tsonic.rust.syntax.conditional",
        resultCarrier,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindTypeOfExpression: {
      const operand = Node_Expression(walk.context.ast, expression);
      const operandCarrier = operand === undefined
        ? undefined
        : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      const result = operand === undefined || operandCarrier === undefined
        ? undefined
        : rustTypeofResult(operandCarrier);
      if (result === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_TYPEOF_CARRIER_UNSUPPORTED",
          "typeof requires one exact closed Rust carrier with preserved TypeScript runtime category.",
          expression,
          ["target.capability=rust.syntax.typeof"],
        );
        return undefined;
      }
      const resultCarrier = rustStringTargetType();
      setRustOperationFact(walk, expression, {
        kind: "typeof",
        operationId: `tsonic.rust.syntax.typeof.${result}`,
        resultCarrier,
        result,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindVoidExpression: {
      const operand = Node_Expression(walk.context.ast, expression);
      const operandCarrier = operand === undefined
        ? undefined
        : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      if (operand === undefined || operandCarrier === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_VOID_OPERAND_UNSUPPORTED",
          "void requires one exact operand with a finalized Rust runtime carrier.",
          expression,
          ["target.capability=rust.syntax.void"],
        );
        return undefined;
      }
      const resultCarrier = rustUndefinedTargetType();
      const operationId = "tsonic.rust.syntax.void";
      setRustOperationFact(walk, expression, {
        kind: "void-expression",
        operationId,
        resultCarrier,
      });
      recordTargetOperation(
        walk,
        expression,
        operationId,
        "operator",
        "void",
        resultCarrier,
      );
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return resolvePostCheckUnaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindBinaryExpression: {
      return resolvePostCheckBinaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindCallExpression:
    case KindNewExpression: {
      return resolveCallLikeCarrier(walk, expression, sourceFile, kind, expected);
    }
    case KindPropertyAccessExpression: {
      const semantics = walk.context.semanticsFor(expression);
      const source = semantics.operations.propertyAccess(expression);
      if (source === undefined || source.callCallee) {
        return undefined;
      }
      const receiverCarrier = resolveExpressionCarrier(
        walk,
        source.receiver.expression,
        sourceFile,
        undefined,
      );
      if (receiverCarrier === undefined) {
        return undefined;
      }
      let operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      if (operation === undefined) {
        recordPolicySelection(walk, expression, selectRustCheckedPropertyAccess(
          checkedPropertySelectionInput(walk, expression, source),
          rustOperationContext(walk, expression),
          walk.operationOptions,
        ));
        operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      }
      const resultCarrier = operation === undefined
        ? undefined
        : rustTargetOperationResultCarrier(operation);
      return resultCarrier === undefined
        ? undefined
        : setCarrierFact(walk, expression, resultCarrier);
    }
    case KindElementAccessExpression: {
      return undefined;
    }
    default: {
      return undefined;
    }
  }
}

function resolveTemplateExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const spans = TemplateExpression_TemplateSpans(walk.context.ast, expression);
  if (spans === undefined || !isDenseDataArray(spans) || spans.some((span) => span === undefined)) {
    appendRustDiagnostic(
      walk,
      "RUST_TEMPLATE_STRUCTURE_INVALID",
      "Template expression requires a dense checked template-span sequence.",
      expression,
      ["target.capability=rust.syntax.template"],
    );
    return undefined;
  }
  const substitutions: { expression: Node; carrier: TargetTypeRef }[] = [];
  for (const span of spans as readonly Node[]) {
    const substitution = TemplateSpan_Expression(walk.context.ast, span);
    const carrier = substitution === undefined
      ? undefined
      : resolveExpressionCarrier(walk, substitution, sourceFile, undefined);
    if (substitution === undefined || carrier === undefined ||
      !isRustSourceStringConvertibleCarrier(carrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_TEMPLATE_SUBSTITUTION_UNSUPPORTED",
        "Template substitution requires an exact closed primitive, string, or undefined carrier.",
        span,
        [
          "target.capability=rust.syntax.template",
          `substitution.carrier=${carrier === undefined ? "missing" : rustTypeSemanticKey(carrier)}`,
        ],
      );
      return undefined;
    }
    substitutions.push({ expression: substitution, carrier });
  }
  const resultCarrier = rustStringTargetType();
  setRustOperationFact(walk, expression, {
    kind: "template-string",
    operationId: "tsonic.rust.syntax.template-string",
    resultCarrier,
    substitutions,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function rustTypeofResult(
  carrier: TargetTypeRef,
): Extract<RustTargetOperationFact, { readonly kind: "typeof" }>["result"] | undefined {
  if (isRustNullCarrier(carrier)) {
    return "object";
  }
  if (carrier.kind === "source-primitive") {
    if (carrier.name === "bool") {
      return "boolean";
    }
    if (carrier.name === "int64" || carrier.name === "uint64") {
      return "bigint";
    }
    return isRustNumericCarrier(carrier) ? "number" : undefined;
  }
  if (isRustStringCarrier(carrier)) {
    return "string";
  }
  if (isRustBigIntCarrier(carrier)) {
    return "bigint";
  }
  if (isRustUnitCarrier(carrier) || isRustUndefinedCarrier(carrier)) {
    return "undefined";
  }
  if (carrier.kind === "function-pointer") {
    return "function";
  }
  const sourceType = rustSourceTypeCarrierValue(carrier);
  if (sourceType?.shape === "enum" || isRustNullishSourceCarrier(carrier) ||
    carrier.kind === "type-parameter" || carrier.kind === "associated-type") {
    return undefined;
  }
  return "object";
}
