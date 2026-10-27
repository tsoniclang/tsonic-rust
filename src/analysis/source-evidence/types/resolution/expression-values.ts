import { requireRustRecord } from "../../../program/records/required-records.js";
import { ConditionalExpression_Condition, ConditionalExpression_WhenFalse, ConditionalExpression_WhenTrue, KindBinaryExpression, KindCallExpression, KindConditionalExpression, KindElementAccessExpression, KindFalseKeyword, KindFunctionExpression, KindIdentifier, KindArrayLiteralExpression, KindBigIntLiteral, KindNewExpression, KindNoSubstitutionTemplateLiteral, KindNonNullExpression, KindNumericLiteral, KindParenthesizedExpression, KindPostfixUnaryExpression, KindPrefixUnaryExpression, KindPropertyAccessExpression, KindStringLiteral, KindSatisfiesExpression, KindSpreadElement, KindTemplateExpression, KindTrueKeyword, KindTypeOfExpression, KindVoidExpression, Node_Expression, sourceIntegerLiteralValue, sourceExpressionResultDisposition } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustNumericLiteralIsFinite } from "../../../numeric/literal-admission.js";
import { rustRuntimeUnionProjection } from "../../../../target-model/types/carriers/runtime-unions.js";
import { getRustTypeofRuntimeKind } from "../../../../policy/operations/syntax/runtime-kind.js";
import { rustUnparenthesizedExpression } from "../../../../target-model/syntax/expressions.js";
import { getRustGeneratorProtocol, isRustBigIntCarrier, isRustBoolCarrier, isRustIntegerCarrier, isRustNumericCarrier, isRustOptionCarrier, rustOptionElementCarrier, rustBigIntTargetType, rustAbsenceTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../../target-model/types/index.js";
import { rustTargetOperationResultCarrier, type RustTargetOperationFact } from "../../../../target-model/records/operations.js";
import { appendRustDiagnostic, boolCarrier, hasSelectedRuntimeCallableUse, rustResolutionContext, selectExpressionOperation, type RustFactWalk, rustOperationContext } from "../../../program/walk.js";
import { parseSourceBigIntLiteral, sourceCharCodeUnit } from "../../../../source/extension/literals.js";
import { resolvePostCheckBinaryCarrier, resolvePostCheckUnaryCarrier } from "../../../operations/operators.js";
import { setCarrierFact } from "../../../operations/project-calls.js";
import { resolveArrayLiteralCarrier } from "../../../operations/array-literals.js";
import { resolveCallLikeCarrier, resolveIdentifierCarrier } from "./references.js";
import { resolveExpressionCarrier } from "./expression-carriers.js";
import { createRustCarrierProbe } from "../../../program/carrier-probe.js";
import { resolveFunctionExpressionCarrier } from "../../../callables/values/closures.js";
import { resolveRecordLiteralCarrier } from "../../../objects/object-literals.js";
import { resolveRustTargetTypeRef } from "./source.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { isRustNumericLiteralCarrier, selectedSourceLiteralIsRepresentable, selectedSourceLiteralOperandIsRepresentable } from "../../../../policy/conversions/literals.js";
import { selectRustSourceValueConversion } from "../../../../policy/conversions/selection.js";
import { selectRustConditionalNumericCarrier } from "../../../../policy/types/conditional-numeric-carrier.js";
import { resolveRustBranchUnion } from "./branch-unions.js";
import { type Node, type SourceFile } from "@tsonic/tsts";
import { type TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustAwaitSelection, rustAwaitSelectionResultCarrier } from "../../../../policy/operations/flow/await.js";
import { rustEffectiveValueCarrier } from "../../../conversions/value-carrier-queries.js";
import { normalizeSelectedLiteralCarrier } from "./selected-literals.js";
import { resolveTemplateExpressionCarrier } from "../../../operations/template-strings.js";

export function resolveExpressionCarrierUncached(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  purpose: "value" | "operation",
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(expression);
  switch (kind) {
    case KindNumericLiteral: {
      if (!rustNumericLiteralIsFinite(walk.context.literalValues.literalValue.get(expression))) {
        return failTargetAnalysisInvariant("tsonic-rust",
          "Numeric literal admission must refuse a non-finite numeric literal before carrier resolution.", expression);
      }
      const contextualExpected = expected !== undefined && isRustOptionCarrier(expected)
        ? rustOptionElementCarrier(expected)
        : expected;
      const defaultCarrier = rustSourcePrimitiveTargetType("float64");
      if (walk.context.literalValues.literalValue.get(expression)?.numeric?.kind === "checked-float64") {
        return setCarrierFact(walk, expression, defaultCarrier);
      }
      const effectiveExpected = contextualExpected === undefined ||
          rustRuntimeUnionProjection(contextualExpected, defaultCarrier) !== undefined ||
          !isRustNumericLiteralCarrier(contextualExpected) &&
          selectRustSourceValueConversion(defaultCarrier, contextualExpected, walk.context.typeDefinitions) !== undefined
        ? defaultCarrier
        : contextualExpected;
      if (effectiveExpected !== undefined && isRustNumericLiteralCarrier(effectiveExpected) &&
        (selectedSourceLiteralIsRepresentable(
          walk.context.literalValues.literalValue.get(expression),
          effectiveExpected.name,
        ) || selectedSourceLiteralOperandIsRepresentable(
          expression,
          effectiveExpected.name,
          walk.context.ast,
          walk.context.literalValues,
        ))) {
        return setCarrierFact(walk, expression, effectiveExpected);
      }
      if (effectiveExpected !== undefined && isRustNumericLiteralCarrier(effectiveExpected)) {
        const carrierName = effectiveExpected.name;
        const integer = isRustIntegerCarrier(effectiveExpected);
        appendRustDiagnostic(
          walk,
          integer ? "RUST_INTEGER_LITERAL_NOT_EXACT" : "RUST_NUMERIC_LITERAL_OUT_OF_RANGE",
          integer
            ? "Integer literal cannot be proven exact for the finalized Rust fixed-width carrier."
            : `Numeric literal is outside the '${carrierName}' range.`,
          expression,
          [`target.carrier=${carrierName}`],
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
          walk.context.literalValues.literalValue.get(expression),
          effectiveExpected.name,
        ) || selectedSourceLiteralOperandIsRepresentable(
          expression,
          effectiveExpected.name,
          walk.context.ast,
          walk.context.literalValues,
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
      const defaultCarrier = rustBigIntTargetType();
      const carrier = effectiveExpected === undefined ||
          rustRuntimeUnionProjection(effectiveExpected, defaultCarrier) !== undefined ||
          !isRustBigIntCarrier(effectiveExpected) &&
          selectRustSourceValueConversion(defaultCarrier, effectiveExpected, walk.context.typeDefinitions) !== undefined
        ? defaultCarrier
        : effectiveExpected;
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
      }
      return setCarrierFact(walk, expression, normalizeSelectedLiteralCarrier(expression,
        rustStringTargetType(), expected, rustOperationContext(walk, expression), walk.operationOptions)!);
    }
    case KindTemplateExpression: {
      return resolveTemplateExpressionCarrier(walk, expression, sourceFile);
    }
    case KindTrueKeyword:
    case KindFalseKeyword: {
      return setCarrierFact(walk, expression, boolCarrier);
    }
    case "KindNullKeyword": {
      return setCarrierFact(walk, expression, rustAbsenceTargetType());
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
      return resolveIdentifierCarrier(walk, expression, sourceFile, expected);
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
      const selection = rustAwaitSelection(rustEffectiveValueCarrier(walk.context.records, operand) ?? operandCarrier,
        walk.context.typeDefinitions);
      const output = selection === undefined ? undefined : rustAwaitSelectionResultCarrier(selection) ??
        resolveRustTargetTypeRef(expression, rustResolutionContext(walk, expression), walk.operationOptions);
      if (output === undefined) {
        return undefined;
      }
      requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "await-op", "analysis/source-evidence/types/resolution/expression-values.ts");
      walk.context.records.targetOperations.source(expression, {
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
      const generator = walk.context.records.generator.get(generatorDeclaration);
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
      requireRustRecord(walk.context.requiredRecords, "yield", expression, source.yieldKind, "resolveExpressionCarrierUncached");
      if (source.yieldKind === "value") walk.context.records.yields.value(expression, generatorDeclaration, generator);
      else walk.context.records.yields.delegate(expression, generatorDeclaration, generator, delegatedCarrier!, resultType);
      return setCarrierFact(walk, expression, resultType);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected, purpose);
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
        requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/source-evidence/types/resolution/expression-values.ts");
        walk.context.records.targetOperations.source(expression, fact);
        requireRustRecord(walk.context.requiredRecords, "selectedOperation", expression, fact.kind, "resolveExpressionCarrierUncached");
        walk.context.records.selectedOperations.operator(expression, fact, carrier);
      }
      return setCarrierFact(walk, expression, carrier);
    }
    case KindSatisfiesExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected, purpose);
      if (carrier === undefined) {
        return undefined;
      }
      const resultCarrier = expected ?? carrier;
      if (!rustTargetTypeRefEquals(carrier, resultCarrier)) {
        return undefined;
      }
      requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "identity-expression", "analysis/source-evidence/types/resolution/expression-values.ts");
      walk.context.records.targetOperations.source(expression, {
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
      requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "non-null-expression", "analysis/source-evidence/types/resolution/expression-values.ts");
      walk.context.records.targetOperations.source(expression, {
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
      let semanticCarrier = expected ?? resolveRustTargetTypeRef(
        expression,
        rustResolutionContext(walk, expression),
        walk.operationOptions,
      );
      if (expected === undefined) {
        const probe = createRustCarrierProbe(walk);
        const left = resolveExpressionCarrier(probe, whenTrue, sourceFile, undefined);
        const right = resolveExpressionCarrier(probe, whenFalse, sourceFile, undefined);
        const nonnumericBranches = left !== undefined && right !== undefined &&
          !isRustNumericCarrier(rustOptionElementCarrier(left) ?? left) &&
          !isRustNumericCarrier(rustOptionElementCarrier(right) ?? right);
        if (left !== undefined && right !== undefined &&
          (!isRustNumericCarrier(rustOptionElementCarrier(semanticCarrier) ?? semanticCarrier) || nonnumericBranches)) {
          semanticCarrier = sourceExpressionResultDisposition(walk.context.ast, expression).kind === "discarded" &&
              rustTargetTypeRefEquals(left, right)
            ? left
            : resolveRustBranchUnion(expression, [
              { expression: whenTrue, carrier: left }, { expression: whenFalse, carrier: right },
            ], rustResolutionContext(walk, expression), walk.operationOptions) ?? semanticCarrier;
        }
        if (isRustNumericCarrier(rustOptionElementCarrier(semanticCarrier) ?? semanticCarrier)) {
          const numericLeft = sourceIntegerLiteralValue(walk.context.ast, whenTrue) === undefined ? left : undefined;
          const numericRight = sourceIntegerLiteralValue(walk.context.ast, whenFalse) === undefined ? right : undefined;
          semanticCarrier = selectRustConditionalNumericCarrier(whenTrue, whenFalse, numericLeft, numericRight,
            walk.context.literalValues) ?? semanticCarrier;
        }
      }
      const trueCarrier = resolveExpressionCarrier(walk, whenTrue, sourceFile, semanticCarrier);
      const falseCarrier = resolveExpressionCarrier(walk, whenFalse, sourceFile, semanticCarrier ?? trueCarrier);
      const resultCarrier = semanticCarrier ?? trueCarrier;
      if (!isRustBoolCarrier(conditionCarrier) || resultCarrier === undefined ||
        trueCarrier === undefined || falseCarrier === undefined ||
        !rustTargetTypeRefEquals(trueCarrier, resultCarrier) ||
        !rustTargetTypeRefEquals(falseCarrier, resultCarrier)) {
        return undefined;
      }
      requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "conditional", "analysis/source-evidence/types/resolution/expression-values.ts");
      walk.context.records.targetOperations.source(expression, {
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
      const physicalCarrier = operand === undefined || operandCarrier === undefined
        ? undefined : walk.context.records.runtimeCarrier.get(rustUnparenthesizedExpression(walk.context.ast, operand))?.carrier;
      const result = physicalCarrier === undefined
        ? undefined
        : getRustTypeofRuntimeKind(physicalCarrier, walk.context.typeDefinitions);
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
      requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "typeof", "analysis/source-evidence/types/resolution/expression-values.ts");
      walk.context.records.targetOperations.source(expression, {
        kind: "typeof",
        operationId: `tsonic.rust.syntax.typeof.${typeof result === "string" ? result : "runtime-union"}`,
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
      const resultCarrier = rustAbsenceTargetType();
      const operationId = "tsonic.rust.syntax.void";
      requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "void-expression", "analysis/source-evidence/types/resolution/expression-values.ts");
      walk.context.records.targetOperations.source(expression, {
        kind: "void-expression",
        operationId,
        resultCarrier,
      });
      requireRustRecord(walk.context.requiredRecords, "selectedOperation", expression, "void-expression", "resolveExpressionCarrierUncached");
      walk.context.records.selectedOperations.project(
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
      if (source === undefined || source.callCallee && !hasSelectedRuntimeCallableUse(walk, expression)) {
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
      let operation = walk.context.records.targetOperation.get(expression);
      if (operation === undefined) {
        selectExpressionOperation(walk, expression, sourceFile);
        operation = walk.context.records.targetOperation.get(expression);
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
