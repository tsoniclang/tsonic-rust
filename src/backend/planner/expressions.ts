import type { Node } from "@tsonic/tsts";
import type {
  RustSelectedTargetOperation as TargetOperationFact,
  RustSelectedTargetSignature as SelectedTargetSignatureFact,
  TargetTypeRef,
} from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import { rustVecRestAssembly } from "../../policy/intrinsics.js";
import { rustArgumentPassingKey } from "../../policy/model.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import {
  isRustBinaryOperator,
  rustBinaryOperatorTraitPath,
} from "../../common/rust-syntax.js";
import {
  KindBinaryExpression,
  KindBigIntLiteral,
  KindArrayBindingPattern,
  Node_Initializer,
  KindCallExpression,
  KindConditionalExpression,
  KindDeleteExpression,
  KindElementAccessExpression,
  KindFalseKeyword,
  KindFunctionExpression,
  KindIdentifier,
  KindObjectBindingPattern,
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
  KindSpreadAssignment,
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
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
  TemplateExpression_Head,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
  TemplateSpan_Literal,
} from "../../common/source-ast.js";
import {
  parseSourceBigIntLiteral,
  parseSourceIntegerLiteral,
  sourceCharCodeUnit,
} from "../../common/source-literal-values.js";
import { rustClosureCaptureFactKey, rustContextualValueConversionFactKey, rustFallibleFactKey, rustFlowReadProjectionFactKey, rustFutureValueFactKey, rustMutatedBindingFactKey, rustOptionalChainFactKey, rustOptionProjectionFactKey, rustPostCheckOperationKind, rustProjectDowncastFactKey, rustProjectUpcastFactKey, rustSourceAccessorEffectsFactKey, rustSourceBindingFactKey, rustSourceCallableValueFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey, rustTargetOperationFactKey, rustYieldFactKey } from "../../source/rust-facts/keys.js";
import type {
  RustArgumentMode,
  RustOptionalChainFact,
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
  isRustFinalizedSourceInput,
  isRustFinalizedTaggedArrayInput,
  validateRustFinalizedOperationAbi,
} from "../../source/rust-facts/finalized-operation-abi.js";
import { rustFutureValueMatchesCarrier } from "../../source/rust-facts/future-values.js";
import { rustValueConversionContract } from "../../source/rust-facts/value-conversions.js";
import {
  rustFinalizedCarrierTransitionMatches,
  rustTargetOperationIsDirectLocation,
  rustTargetOperationText,
} from "../../source/rust-facts/target-operation.js";
import {
  rustArgumentPassingMode,
} from "../../source/rust-facts/parameter-passing.js";
import type { RustExpr, RustStmt, RustType } from "../rust-ast/nodes.js";
import {
  negateRustBooleanExpression,
  rustBorrowedStringView,
  rustExpressionContainsStatementBlock,
  rustStringConcat,
  tupleRustClosureArguments,
} from "../rust-ast/expressions.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { applyRustErrorBoundary } from "./error-boundary.js";
import { diagnosticInput, isValidRustIdentifier, registerAliasFromPath, rustSourceBindingPath, sourceTypePath } from "./plan-context.js";
import type { RustEffectiveExpressionOverride, RustPlanContext } from "./plan-context.js";
import { isFloatCarrier, rustTypeFromCarrierInContext } from "./render-types.js";
import { getRustGeneratorProtocol, isRustBigIntCarrier, isRustBoolCarrier, isRustCopyCarrier, isRustIntegerCarrier, isRustNeverCarrier, isRustNullCarrier, isRustStringCarrier, isRustUndefinedCarrier, isRustUnitCarrier, isRustVecCarrier, rustCallableProtocol, rustCarrierSupportsClone, rustClosureProtocol, rustFixedArrayCarrierValue, rustFutureOutputCarrier, rustOptionElementCarrier, rustOptionTargetType, rustPrimitiveTypeName, rustSliceElementCarrier, rustSourcePrimitiveTargetType, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, rustStringTargetType, rustStructuralMethodStorageCarrier, substituteRustTargetTypeParameters } from "../../source/rust-target-types.js";
import {
  requireRustCarrierRequirements,
  requireRustDefaultValueCarrier,
} from "./generic-requirements.js";
import {
  planRustIdentifierValue,
  planRustValueRead,
  planRustCaptureValue,
  planRustNonConsumingValue,
  planRustSharedReceiver,
  planRustPromotedStorageLocation,
  planRustTypedLocationCall,
} from "./typed-locations.js";
import {
  createRustProjectObject,
  readRustProjectObjectIndex,
  readRustProjectObjectIndexStorage,
  readRustProjectDispatchedField,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
  writeRustProjectObjectIndex,
  writeRustProjectDispatchedField,
} from "./project-objects.js";
import {
  applyRustProviderLocationScope,
  planRustProviderLocationScope,
} from "./provider-location-scope.js";
import {
  applyFallibleShape,
  applyRustFallibleResultExpression,
  rustExpressionUsesTryInCurrentRegion,
  rustBottomAfterEffect,
  rustBottomExpression,
} from "./fallible-shape.js";
import type {
  RustFinalizedInputPlanOverrides,
} from "./provider-location-scope.js";
import {
  applyRustSourceCallableRequirements,
} from "./source-callable-contracts.js";
import { applyRustTailShape, rustBlockTerminates } from "./block-flow.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "./synthetic-names.js";
import { planRustBindingPattern } from "./binding-patterns.js";
import { rustOptionDefaultValue } from "./option-default.js";
import { rustTargetOperationIsFallible } from "../../source/rust-facts/target-operation.js";
import {
  rustProjectDispatchTraitType,
  rustProjectStateMarker,
  rustProjectStateType,
} from "./project-polymorphism-names.js";
import {
  createRustStructuralObjectFromCarrier,
  invokeRustStructuralObjectMethod,
  mutateRustStoredObjectField,
  readRustStoredObjectField,
  readRustStructuralObjectMethodStorage,
  rustDirectProjectFieldStoragePath,
} from "./project-object-storage.js";
import { planRustFallibleReturnExpression } from "./completion-exits.js";
import {
  rustSelectedAccessorRequiresUnsafe,
  rustSelectedCallRequiresUnsafe,
  tryPlanRustExplicitSafetyExpression,
} from "./explicit-safety.js";
import {
  tryPlanRustNativePointerOperation,
} from "./expression-native-pointers.js";
import {
  planRustSourceUnionFieldProjection,
} from "./source-union-projection.js";
import {
  readRustSourceStaticField,
  rustSourceStaticFieldLocation,
} from "./static-field-storage.js";
import {
  rustEffectiveValueCarrier,
  rustValueCarrierBeforeContextualConversion,
  rustValueCarrierBeforeOptionProjection,
  rustValueCarrierTransitionTarget,
} from "../../source/rust-target-semantics/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "./flow-read-projections.js";
import {
  planRustProjectDowncast,
  planRustProjectTypeTest,
} from "./project-downcasts.js";
import { rustObjectLiteralRequiresDispatchImplementation } from "./object-literal-implementations.js";
import { planRustProgramErrorTypeTest } from "./program-error-operations.js";
import { rustProjectCallableTargetName } from "../../source/rust-target-semantics/source-member-name.js";

type RustExpressionResultUse = "value" | "discarded";

export function planExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse = "value",
): RustExpr | undefined {
  const override = context.expressionOverrides?.get(node);
  const planned = planExpressionBeforeValueProjections(node, context, resultUse);
  if (planned === undefined || resultUse === "discarded") {
    return planned;
  }
  const flowRead = context.input.facts.getFact(node, rustFlowReadProjectionFactKey);
  const upcast = context.input.facts.getFact(node, rustProjectUpcastFactKey);
  const downcast = context.input.facts.getFact(node, rustProjectDowncastFactKey);
  const contextualConversion = context.input.facts.getFact(
    node,
    rustContextualValueConversionFactKey,
  );
  const projection = context.input.facts.getFact(node, rustOptionProjectionFactKey);
  let currentCarrier = override?.carrier ??
    flowRead?.sourceCarrier ??
    upcast?.sourceCarrier ??
    downcast?.sourceCarrier ??
    contextualConversion?.sourceCarrier ??
    projection?.sourceCarrier ??
    context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  let flowSelected = planned;
  if (flowRead !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, flowRead.sourceCarrier)) {
      const selected = planRustFlowReadProjection(
        node,
        planRustNonConsumingValue(node, flowSelected, context),
        flowRead,
        context,
      );
      if (selected === undefined) {
        return undefined;
      }
      flowSelected = selected;
      currentCarrier = flowRead.selectedCarrier;
    } else if (!rustTargetTypeRefEquals(currentCarrier, flowRead.selectedCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-read-order",
        "The finalized flow-read projection is not composable with the expression's current exact carrier.",
      ));
      return undefined;
    }
  }
  if (flowSelected === undefined) {
    return undefined;
  }
  if (upcast !== undefined && downcast !== undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-cast-conflict",
      "One source expression cannot carry both finalized project upcast and downcast facts.",
    ));
    return undefined;
  }
  let converted: RustExpr | undefined = flowSelected;
  const projectCast = upcast ?? downcast;
  if (projectCast !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, projectCast.sourceCarrier)) {
      converted = upcast !== undefined
        ? planRustProjectUpcast(node, converted, upcast, currentCarrier, context)
        : planRustProjectDowncast(node, converted, downcast!, context);
      if (converted === undefined) {
        return undefined;
      }
      currentCarrier = projectCast.targetCarrier;
    } else if (!rustTargetTypeRefEquals(currentCarrier, projectCast.targetCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-cast-order",
        "The finalized project cast is not composable with the expression's current exact carrier.",
      ));
      return undefined;
    }
  }
  if (converted === undefined) {
    return undefined;
  }
  let contextuallyConverted = converted;
  if (contextualConversion !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, contextualConversion.sourceCarrier)) {
      const selected = applyRustContextualValueConversion(
        node,
        contextuallyConverted,
        contextualConversion,
        context,
      );
      if (selected === undefined) {
        return undefined;
      }
      contextuallyConverted = selected;
      currentCarrier = contextualConversion.targetCarrier;
    } else if (!rustTargetTypeRefEquals(currentCarrier, contextualConversion.targetCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.contextual-value-conversion-order",
        "The finalized contextual conversion is not composable with the expression's current exact carrier.",
      ));
      return undefined;
    }
  }
  if (contextuallyConverted === undefined) {
    return undefined;
  }
  if (projection !== undefined &&
    !rustTargetTypeRefEquals(currentCarrier, projection.sourceCarrier) &&
    !rustTargetTypeRefEquals(currentCarrier, projection.resultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.option-projection-order",
      "The finalized Option projection is not composable with the expression's current exact carrier.",
    ));
    return undefined;
  }
  if (projection !== undefined && rustTargetTypeRefEquals(currentCarrier, projection.resultCarrier)) {
    return contextuallyConverted;
  }
  if (projection?.kind === "none") {
    const optionType = rustTypeFromCarrierInContext(projection.resultCarrier, context);
    if (optionType === undefined || rustOptionElementCarrier(projection.resultCarrier) === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-none-carrier",
        "An exact Option projection requires a renderable finalized Option result carrier.",
      ));
      return undefined;
    }
    return { kind: "associated-value", owner: optionType, name: "None" };
  }
  return projection?.kind === "some"
    ? { kind: "call", path: "Some", args: [contextuallyConverted] }
    : contextuallyConverted;
}

function planExpressionBeforeValueProjections(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
): RustExpr | undefined {
  const override = context.expressionOverrides?.get(node);
  if (override === undefined || override.valueForm !== "storage" ||
    isRustCopyCarrier(override.carrier)) {
    return override?.expression ?? planRawExpression(node, context, resultUse);
  }
  if (!rustCarrierSupportsClone(override.carrier)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.preconstruction-field-read",
      "A preconstruction field value must be Copy or Clone when read before the complete object exists.",
    ));
    return undefined;
  }
  return {
    kind: "method-call",
    receiver: override.expression,
    method: "clone",
    args: [],
  };
}

function planRawExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
): RustExpr | undefined {
  const diagnosticCount = context.diagnostics.length;
  const explicitSafety = tryPlanRustExplicitSafetyExpression(
    node,
    context,
    planExpression,
  );
  const nativePointer = explicitSafety.handled
    ? undefined
    : tryPlanRustNativePointerOperation(node, context, planExpression);
  let planned: RustExpr | undefined;
  if (explicitSafety.handled) {
    planned = explicitSafety.expression;
  } else if (nativePointer?.handled === true) {
    planned = nativePointer.expression;
  } else if (
    rustExpressionUnsafeRequirement(node, context) !== undefined &&
    (context.explicitUnsafeContextDepth ?? 0) === 0
  ) {
    context.diagnostics.push({
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: "The selected Rust operation requires an explicit unsafeContext() source region at this use site.",
      sourceNode: node,
    });
    planned = undefined;
  } else {
    planned = planExpressionInner(node, context, resultUse);
  }
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
  return planned;
}

function applyRustContextualValueConversion(
  node: Node,
  expression: RustExpr,
  fact: import("../../source/rust-facts/keys.js").RustContextualValueConversionFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceCarrier = rustValueCarrierBeforeContextualConversion(
    context.input.facts,
    node,
  );
  if (!rustTargetTypeRefEquals(sourceCarrier, fact.sourceCarrier)) {
    const left = context.input.ast.kindName(node) === KindBinaryExpression
      ? BinaryExpression_Left(context.input.ast, node)
      : undefined;
    const right = context.input.ast.kindName(node) === KindBinaryExpression
      ? BinaryExpression_Right(context.input.ast, node)
      : undefined;
    const diagnostic = missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.contextual-value-conversion",
      "Contextual Rust value conversion conflicts with its finalized source and target carriers.",
    );
    context.diagnostics.push({
      ...diagnostic,
      evidence: [
        ...(diagnostic.evidence ?? []),
        `carrier.current=${JSON.stringify(sourceCarrier)}`,
        `carrier.source=${JSON.stringify(fact.sourceCarrier)}`,
        `carrier.target=${JSON.stringify(fact.targetCarrier)}`,
        `carrier.left=${JSON.stringify(context.input.facts.getRuntimeCarrierFact(left)?.carrier)}`,
        `carrier.right=${JSON.stringify(context.input.facts.getRuntimeCarrierFact(right)?.carrier)}`,
        `operation=${JSON.stringify(context.input.facts.getFact(node, rustTargetOperationFactKey))}`,
      ],
    });
    return undefined;
  }
  return applyRustValueConversion(context, expression, fact.conversion, node, false);
}

function rustExpressionUnsafeRequirement(
  node: Node,
  context: RustPlanContext,
): "call" | "accessor" | "provider-operation" | undefined {
  if (rustSelectedCallRequiresUnsafe(node, context.input)) {
    return "call";
  }
  const operation = context.input.facts.getFact(node, rustTargetOperationFactKey);
  if (operation?.kind === "source-accessor" &&
    rustSelectedAccessorRequiresUnsafe(node, "getter", context.input)) {
    return "accessor";
  }
  const kind = context.input.ast.kindName(node);
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(context.input.ast, node);
    const accessor = operand === undefined
      ? undefined
      : findRustUpdateSourceAccessor(operand, context);
    if (accessor !== undefined &&
      (rustSelectedAccessorRequiresUnsafe(accessor.expression, "getter", context.input) ||
        rustSelectedAccessorRequiresUnsafe(accessor.expression, "setter", context.input))) {
      return "accessor";
    }
  }
  return operation?.kind === "provider-operation" &&
      operation.abi.effects.safety === "requires-unsafe"
    ? "provider-operation"
    : undefined;
}

export function planRustProjectUpcast(
  node: Node,
  expression: RustExpr,
  fact: import("../../source/rust-facts/keys.js").RustProjectUpcastFact,
  actual: TargetTypeRef | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const targetDefinition = context.input.projectTypes.definitionForCarrier(fact.targetCarrier);
  const targetValue = rustSourceTypeCarrierValue(fact.targetCarrier);
  const targetPath = targetValue === undefined ? undefined : sourceTypePath(context, targetValue);
  const relationship = targetDefinition === undefined
    ? { kind: "unrelated" as const }
    : context.input.projectTypes.relationship(fact.sourceCarrier, targetDefinition);
  if (!rustTargetTypeRefEquals(actual, fact.sourceCarrier) ||
    relationship.kind !== "related" ||
    !rustTargetTypeRefEquals(relationship.targetType, fact.targetCarrier) ||
    targetPath === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-upcast",
      "Project-type upcast conflicts with the exact finalized source and target heritage carriers.",
    ));
    return undefined;
  }
  const valueName = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.ast, node, []),
    "upcast_value",
  );
  return {
    kind: "block",
    bindings: [{ name: valueName, value: expression }],
    value: {
      kind: "struct-literal",
      path: targetPath,
      fields: [
        {
          name: rustProjectObjectIdentityField,
          value: {
            kind: "method-call",
            receiver: {
              kind: "field",
              receiver: { kind: "path", path: valueName },
              name: rustProjectObjectIdentityField,
            },
            method: "clone",
            args: [],
          },
        },
        {
          name: rustProjectObjectDispatchField,
          value: {
            kind: "method-call",
            receiver: {
              kind: "field",
              receiver: { kind: "path", path: valueName },
              name: rustProjectObjectDispatchField,
            },
            method: "clone",
            args: [],
          },
        },
      ],
    },
  };
}

function planExpressionInner(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
): RustExpr | undefined {
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
      const binding = context.input.facts.getFact(node, rustSourceBindingFactKey);
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
      const callableValue = context.input.facts.getFact(node, rustSourceCallableValueFactKey);
      if (callableValue !== undefined) {
        if (context.syntheticNames === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.callable-value-name",
            "Project-source callable values require a finalized hygienic-name scope.",
          ));
          return undefined;
        }
        const fallible = context.input.facts.getFact(
          callableValue.sourceDeclaration,
          rustFallibleFactKey,
        ) !== undefined;
        const callableType = rustCallableConstructionType(
          callableValue.carrier,
          context,
        );
        const declarationModule = context.moduleNameByFileName.get(callableValue.fileName);
        const callableName = callableValue.name;
        if (callableType === undefined || declarationModule === undefined ||
          callableName === undefined || !isValidRustIdentifier(callableName)) {
          return undefined;
        }
        const allocatedArgumentsName = allocateRustSyntheticName(
          context.syntheticNames,
          "callable_arguments",
        );
        const argumentsName = callableValue.parameterCarriers.length === 0
          ? `_${allocatedArgumentsName}`
          : allocatedArgumentsName;
        const path = declarationModule === context.moduleName
          ? callableName
          : `crate::${declarationModule}::${callableName}`;
        context.usedAliases?.add("rt");
        const invocation: RustExpr = {
          kind: "call",
          path,
          args: callableValue.parameterCarriers.map((_carrier, index) => {
            const value: RustExpr = {
              kind: "field",
              receiver: { kind: "path", path: argumentsName },
              name: String(index),
            };
            const mode = callableValue.argumentModes[index];
            return mode === "ref"
              ? { kind: "reference", expr: value }
              : mode === "mut-ref"
                ? { kind: "reference", expr: value, mutable: true }
                : value;
          }),
        };
        const callableResult = fallible
          ? invocation
          : applyRustFallibleResultExpression(invocation, {
              errorDomain: context.errorDomain,
            });
        const mutableArguments = callableValue.argumentModes.some((mode) => mode === "mut-ref");
        const implementation: RustExpr = mutableArguments
          ? {
              kind: "closure-block",
              params: [{ name: argumentsName, mutable: true }],
              move: true,
              async: false,
              body: { statements: [{ kind: "tail", expr: callableResult }] },
            }
          : {
              kind: "closure",
              params: [{ name: argumentsName, byRefCopy: false }],
              body: callableResult,
            };
        return {
          kind: "associated-call",
          owner: callableType,
          method: "new",
          args: [implementation],
        };
      }
      if (binding === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.value-reference",
          "Identifier expression has no finalized project-source binding or selected target value operation.",
        ));
        return undefined;
      }
      const name = context.input.names.nameForDeclaration(binding.sourceDeclaration) ?? "";
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
      const inner = Node_Expression(context.input.ast, node);
      return inner === undefined ? undefined : planExpression(inner, context);
    }
    case "KindAsExpression":
    case "KindTypeAssertionExpression": {
      return planSourceConversion(node, context);
    }
    case KindSatisfiesExpression: {
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
    case KindNonNullExpression: {
      const fact = rustOperationFact(node, context);
      const inner = Node_Expression(context.input.ast, node);
      const planned = inner === undefined ? undefined : planExpression(inner, context);
      const innerCarrier = inner === undefined
        ? undefined
        : rustEffectiveValueCarrier(context.input.facts, inner);
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
      if (condition === undefined || whenTrue === undefined || whenFalse === undefined) {
        return undefined;
      }
      const conditional: RustExpr = { kind: "conditional", condition, whenTrue, whenFalse };
      if (!rustExpressionContainsStatementBlock(condition)) {
        return conditional;
      }
      const conditionName = allocateRustSyntheticName(
        context.syntheticNames ?? createRustSyntheticNameState(context.input.ast, node, []),
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
      const discard = isRustUnitCarrier(expressionCarrier(operandNode, context)) ? "unit" : "value";
      return operand === undefined
        ? undefined
        : {
            kind: "evaluate-then",
            effect: discard === "value"
              ? planRustNonConsumingValue(operandNode, operand, context)
              : operand,
            discard,
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
    case KindFunctionExpression:
    case "KindMethodDeclaration":
    case "KindGetAccessor":
    case "KindSetAccessor": {
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
      const callableProtocol = rustCallableProtocol(closureFact.resultCarrier);
      const nativeClosureProtocol = rustClosureProtocol(closureFact.resultCarrier);
      const allParameterCarriers = closureFact.resultCarrier.kind === "function-pointer"
        ? closureFact.resultCarrier.args
        : nativeClosureProtocol?.parameters ?? callableProtocol?.parameters;
      const resultCarrier = closureFact.resultCarrier.kind === "function-pointer"
        ? closureFact.resultCarrier.result
        : nativeClosureProtocol?.result ?? callableProtocol?.result;
      const captureFact = context.input.facts.getFact(node, rustClosureCaptureFactKey);
      if (captureFact === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-captures",
          "Callable expressions require finalized exact capture evidence.",
        ));
        return undefined;
      }
      if (closureFact.resultCarrier.kind === "function-pointer" &&
        (captureFact.captures.length !== 0 || captureFact.recursiveDeclaration !== undefined)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.function-pointer-capture",
          "Native Rust function pointers cannot carry captured or recursive callable state.",
        ));
        return undefined;
      }
      if (nativeClosureProtocol !== undefined && captureFact.recursiveDeclaration !== undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.native-closure-recursion",
          "A native Rust closure passed to a provider operation cannot recursively invoke itself.",
        ));
        return undefined;
      }
      const sourceParams = context.input.ast.parameters(node);
      const leadingParameters = closureFact.leadingParameters ?? [];
      if (allParameterCarriers === undefined || resultCarrier === undefined ||
        leadingParameters.length > allParameterCarriers.length ||
        !leadingParameters.every((parameter, index) =>
          rustTargetTypeRefEquals(parameter.carrier, allParameterCarriers[index])) ||
        closureFact.byRefCopyParams.length !== sourceParams.length ||
        allParameterCarriers.length - leadingParameters.length !== sourceParams.length) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-abi",
          "Callable-expression parameter count does not match its finalized Rust closure ABI.",
        ));
        return undefined;
      }
      const parameterCarriers = allParameterCarriers.slice(leadingParameters.length);
      if (callableProtocol !== undefined && context.syntheticNames === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-argument-tuple",
          "Runtime callable expressions require a finalized hygienic-name scope.",
        ));
        return undefined;
      }
      const sourceParameterPlans: {
        readonly parameter: Node;
        readonly name: string;
        readonly pattern?: Node;
        readonly carrier: TargetTypeRef;
        readonly valueCarrier: TargetTypeRef;
        readonly form: "required" | "optional" | "default" | "rest";
        readonly byRefCopy: boolean;
        readonly mutable: boolean;
      }[] = [];
      const bindingParameters: {
        readonly pattern: Node;
        readonly name: string;
        readonly sourceCarrier: TargetTypeRef;
      }[] = [];
      for (const [index, parameter] of sourceParams.entries()) {
        if (parameter === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.closure-parameter",
            "Callable expression contains an undefined parameter slot.",
          ));
          return undefined;
        }
        const nameNode = ast.name(parameter);
        const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
        const bindingPattern = nameNode !== undefined &&
            (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern)
          ? nameNode
          : undefined;
        if (bindingPattern !== undefined && context.syntheticNames === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, parameter),
            "rust.backend.closure-binding-name",
            "Binding-pattern closure parameter requires a finalized hygienic-name scope.",
          ));
          return undefined;
        }
        const parameterName = bindingPattern === undefined
          ? context.input.names.nameForDeclaration(parameter) ?? ""
          : allocateRustSyntheticName(context.syntheticNames!, "binding_parameter");
        if (!isValidRustIdentifier(parameterName)) {
          return undefined;
        }
        const parameterCarrier = parameterCarriers[index];
        const parameterAbi = context.input.facts.getFact(parameter, rustSourceParameterAbiFactKey);
        if (parameterCarrier === undefined || parameterAbi === undefined ||
          !rustTargetTypeRefEquals(parameterCarrier, parameterAbi.parameterCarrier) ||
          (callableProtocol === undefined && closureFact.parameterForms === "required-only" &&
            parameterAbi.form !== "required")) {
          return undefined;
        }
        const byRefCopy = closureFact.byRefCopyParams[index] === true;
        sourceParameterPlans.push({
          parameter,
          name: parameterName,
          ...(bindingPattern === undefined ? {} : { pattern: bindingPattern }),
          carrier: parameterCarrier,
          valueCarrier: parameterAbi.valueCarrier,
          form: parameterAbi.form,
          byRefCopy,
          mutable: bindingPattern === undefined &&
            context.input.facts.getFact(parameter, rustMutatedBindingFactKey) !== undefined,
        });
        if (bindingPattern !== undefined) {
          if (byRefCopy) {
            context.diagnostics.push(missingFactDiagnostic(
              diagnosticInput(context, parameter),
              "rust.backend.closure-binding-carrier",
              "Binding-pattern closure parameter requires one exact by-value source carrier.",
            ));
            return undefined;
          }
          bindingParameters.push({
            pattern: bindingPattern,
            name: parameterName,
            sourceCarrier: parameterAbi.valueCarrier,
          });
        }
      }
      const bodyNode = context.input.ast.body(node);
      if (bodyNode === undefined) {
        return undefined;
      }
      const fallible = context.input.facts.getFact(node, rustFallibleFactKey) !== undefined;
      const resultIsFallible = callableProtocol !== undefined || fallible;
      if (resultIsFallible) {
        context.usedAliases?.add("rt");
      }
      const leadingParameterPlans = leadingParameters.map((parameter) => ({
        ...parameter,
        name: context.syntheticNames === undefined
          ? undefined
          : allocateRustSyntheticName(
              context.syntheticNames,
              parameter.kind === "this" ? "_object_this" : "_object_receiver",
            ),
      }));
      if (leadingParameterPlans.some((parameter) => parameter.name === undefined)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-leading-parameter",
          "Callable expression leading parameters require a finalized hygienic-name scope.",
        ));
        return undefined;
      }
      const expressionOverrides = new Map(context.expressionOverrides ?? []);
      for (const parameter of leadingParameterPlans) {
        if (parameter.kind !== "this") {
          continue;
        }
        const visitThis = (candidate: Node): void => {
          const kind = context.input.ast.kindName(candidate);
          if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
            const carrier = context.input.facts.getRuntimeCarrierFact(candidate)?.carrier;
            if (rustTargetTypeRefEquals(carrier, parameter.carrier)) {
              expressionOverrides.set(candidate, {
                carrier: parameter.carrier,
                valueForm: "value",
                expression: { kind: "path", path: parameter.name! },
              });
            }
            return;
          }
          if (candidate !== node &&
            (kind === KindFunctionExpression || kind === "KindFunctionDeclaration" ||
              kind === "KindMethodDeclaration" || kind === "KindGetAccessor" ||
              kind === "KindSetAccessor" || kind === "KindClassDeclaration")) {
            return;
          }
          context.input.ast.forEachChild(candidate, (child) => {
            if (child !== undefined) {
              visitThis(child);
            }
          });
        };
        visitThis(node);
      }
      const closureContext: RustPlanContext = {
        ...context,
        controlFlow: { nextLoopId: 0 },
        controlTargets: undefined,
        completionBoundary: undefined,
        fallibleContext: resultIsFallible,
        asyncContext: false,
        generator: undefined,
        expressionOverrides,
      };
      const captureBindings: { readonly name: string; readonly value: RustExpr }[] = [];
      const capturedBindings = [...(context.capturedBindings ?? [])];
      for (const capture of captureFact.captures) {
        if (context.syntheticNames === undefined || !requireRustCarrierRequirements(
          capture.carrier,
          nativeClosureProtocol === undefined ? ["clone", "static"] : ["clone"],
          capture.reference,
          context,
        )) {
          return undefined;
        }
        const binding = context.input.facts.getFact(capture.reference, rustSourceBindingFactKey);
        if (binding === undefined) {
          return undefined;
        }
        const sourceName = context.input.names.nameForDeclaration(binding.sourceDeclaration) ?? "";
        const sourcePath = rustSourceBindingPath(context, binding);
        if (!isValidRustIdentifier(sourceName)) {
          return undefined;
        }
        if (sourcePath === undefined) {
          return undefined;
        }
        const name = allocateRustSyntheticName(context.syntheticNames, `capture_${sourceName}`);
        const captureValue = planRustCaptureValue(
          capture.reference,
          sourcePath,
          capture.storage,
          context,
        );
        captureBindings.push({
          name,
          value: captureValue,
        });
        capturedBindings.push({
          declaration: capture.declaration,
          path: name,
          storage: capture.storage,
          valueCarrier: capture.carrier,
        });
      }
      let recursiveName: string | undefined;
      if (captureFact.recursiveDeclaration !== undefined) {
        if (context.syntheticNames === undefined || callableProtocol === undefined) {
          return undefined;
        }
        recursiveName = allocateRustSyntheticName(context.syntheticNames, "recursive_callable");
        capturedBindings.push({
          declaration: captureFact.recursiveDeclaration,
          path: recursiveName,
          storage: "value",
          valueCarrier: closureFact.resultCarrier,
        });
      }
      const callableClosureContext: RustPlanContext = {
        ...closureContext,
        capturedBindings,
      };
      const bindingStatements: RustStmt[] = [];
      let closureParams: { name: string; mutable: boolean; byRefCopy?: boolean }[];
      let closureMove = nativeClosureProtocol !== undefined && captureBindings.length > 0;
      if (callableProtocol === undefined) {
        closureParams = [
          ...leadingParameterPlans.map((parameter) => ({
            name: parameter.name!,
            mutable: false,
          })),
          ...sourceParameterPlans.map((parameter) => ({
            name: parameter.name,
            mutable: parameter.mutable,
            byRefCopy: parameter.byRefCopy,
          })),
        ];
      } else {
        const allocatedTupleName = allocateRustSyntheticName(
          context.syntheticNames!,
          "callable_arguments",
        );
        const tupleName = leadingParameterPlans.length + sourceParameterPlans.length === 0
          ? `_${allocatedTupleName}`
          : allocatedTupleName;
        closureParams = [
          ...(recursiveName === undefined ? [] : [{ name: recursiveName, mutable: false }]),
          { name: tupleName, mutable: false },
        ];
        closureMove = true;
        for (const [index, parameter] of leadingParameterPlans.entries()) {
          bindingStatements.push({
            kind: "let",
            name: parameter.name!,
            mutable: false,
            init: {
              kind: "field",
              receiver: { kind: "path", path: tupleName },
              name: String(index),
            },
          });
        }
        for (const [index, parameter] of sourceParameterPlans.entries()) {
          let initializer: RustExpr = {
            kind: "field",
            receiver: { kind: "path", path: tupleName },
            name: String(leadingParameterPlans.length + index),
          };
          if (parameter.form === "default") {
            const defaultNode = Node_Initializer(context.input.ast, parameter.parameter);
            const defaultValue = defaultNode === undefined
              ? undefined
              : planExpression(defaultNode, callableClosureContext);
            if (defaultValue === undefined) {
              return undefined;
            }
            initializer = rustOptionDefaultValue(initializer, defaultValue);
          }
          bindingStatements.push({
            kind: "let",
            name: parameter.name,
            mutable: parameter.mutable,
            init: initializer,
          });
        }
      }
      for (const binding of bindingParameters) {
        const planned = planRustBindingPattern(
          binding.pattern,
          { kind: "path", path: binding.name },
          binding.sourceCarrier,
          callableClosureContext,
          planExpression,
        );
        if (planned === undefined) {
          return undefined;
        }
        bindingStatements.push(...planned);
      }
      if (context.input.ast.kindName(bodyNode) !== "KindBlock") {
        const body = planExpression(bodyNode, callableClosureContext);
        if (body === undefined) {
          return undefined;
        }
        const resultBody = resultIsFallible
          ? applyRustFallibleResultExpression(body, {
              errorDomain: context.errorDomain,
              errorTypePath: "rt::TsonicError",
            })
          : body;
        const closure: RustExpr = bindingStatements.length === 0 &&
            closureParams.every((parameter) => !parameter.mutable)
          ? {
              kind: "closure",
              params: closureParams.map((parameter) => ({
                name: parameter.name,
                byRefCopy: parameter.byRefCopy === true,
              })),
              ...(closureMove ? { move: true } : {}),
              body: resultBody,
            }
          : {
              kind: "closure-block",
              params: closureParams,
              move: closureMove,
              async: false,
              body: { statements: [...bindingStatements, { kind: "tail", expr: resultBody }] },
            };
        if (callableProtocol === undefined) {
          return nativeClosureProtocol === undefined || captureBindings.length === 0
            ? closure
            : { kind: "block", bindings: captureBindings, value: closure };
        }
        const callableType = rustCallableConstructionType(
          closureFact.resultCarrier,
          context,
        );
        if (callableType === undefined) {
          return undefined;
        }
        context.usedAliases?.add("rt");
        const callable = {
          kind: "associated-call" as const,
          owner: callableType,
          method: recursiveName === undefined ? "new" : "recursive",
          args: [closure],
        };
        return finishRuntimeCallableExpression(
          callable,
          captureBindings,
        );
      }
      const resultType = rustTypeFromCarrierInContext(resultCarrier, context);
      if (resultType === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-result",
          "Block-bodied callable expressions require one finalized renderable result carrier.",
        ));
        return undefined;
      }
      const block = context.planBlock(bodyNode, {
        ...callableClosureContext,
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
      const finalizedBlock = applyFallibleShape(applyRustTailShape(
        { statements: [...bindingStatements, ...block.statements] },
        !isRustUnitCarrier(resultCarrier),
      ), {
        fallible: resultIsFallible,
        hasReturnValue: !isRustUnitCarrier(resultCarrier),
        errorDomain: context.errorDomain,
        errorTypePath: "rt::TsonicError",
      });
      const onlyStatement = finalizedBlock.statements.length === 1
        ? finalizedBlock.statements[0]
        : undefined;
      const closure: RustExpr = onlyStatement?.kind === "tail" &&
          closureParams.every((parameter) => !parameter.mutable)
        ? {
          kind: "closure",
          params: closureParams.map((parameter) => ({
            name: parameter.name,
            byRefCopy: parameter.byRefCopy === true,
          })),
          ...(closureMove ? { move: true } : {}),
          body: onlyStatement.expr,
        }
        : {
            kind: "closure-block",
            params: closureParams,
            move: closureMove,
            async: false,
            body: finalizedBlock,
          };
      if (callableProtocol === undefined) {
        return nativeClosureProtocol === undefined || captureBindings.length === 0
          ? closure
          : { kind: "block", bindings: captureBindings, value: closure };
      }
      const callableType = rustCallableConstructionType(
        closureFact.resultCarrier,
        context,
      );
      if (callableType === undefined) {
        return undefined;
      }
      context.usedAliases?.add("rt");
      const callable = {
        kind: "associated-call" as const,
        owner: callableType,
        method: recursiveName === undefined ? "new" : "recursive",
        args: [closure],
      };
      return finishRuntimeCallableExpression(
        callable,
        captureBindings,
      );
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
        if (future.errorBoundary === "none") {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.await-error-boundary",
            "A finalized fallible Rust future requires one exact error boundary.",
          ));
          return undefined;
        }
        awaited = applyRustErrorBoundary(awaited, future.errorBoundary, context.errorDomain);
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
      const operand = Node_Expression(context.input.ast, node);
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

function rustCallableConstructionType(
  carrier: TargetTypeRef,
  context: RustPlanContext,
): RustType | undefined {
  return rustTypeFromCarrierInContext(carrier, context);
}

function planGeneratorResumeExpression(
  resume: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.generator-resume-names",
      "Generator resume lowering requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const nextName = allocateRustSyntheticName(context.syntheticNames, "generator_next");
  const returnName = allocateRustSyntheticName(context.syntheticNames, "generator_return");
  const errorName = allocateRustSyntheticName(context.syntheticNames, "generator_error");
  context.usedAliases?.add("rt");
  return {
    kind: "match",
    expression: resume,
    arms: [{
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Next",
        elements: [{ kind: "binding", name: nextName }],
      },
      expression: { kind: "path", path: nextName },
    }, {
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Return",
        elements: [{ kind: "binding", name: returnName }],
      },
      expression: planRustFallibleReturnExpression(
        { kind: "path", path: returnName },
        context,
      ),
    }, {
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Throw",
        elements: [{ kind: "binding", name: errorName }],
      },
      expression: {
        kind: "try",
        errorDomain: "runtime",
        expr: {
          kind: "call",
          path: "Err",
          args: [{ kind: "path", path: errorName }],
        },
      },
    }],
  };
}

function finishRuntimeCallableExpression(
  callable: RustExpr,
  captureBindings: readonly { readonly name: string; readonly value: RustExpr }[],
): RustExpr {
  return captureBindings.length === 0
    ? callable
    : { kind: "block", bindings: captureBindings, value: callable };
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
      : rustEffectiveValueCarrier(context.input.facts, expression);
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
      args: [{
        kind: "reference",
        expr: planRustNonConsumingValue(expression, value, context),
      }],
    });
    parts.push({ kind: "string-literal", value: context.input.ast.text(literal) });
  }
  return rustStringConcat(parts);
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
  return context.expressionOverrides?.get(node)?.carrier ??
    context.input.facts.getRuntimeCarrierFact(node)?.carrier;
}

function rustPartialComparison(left: RustExpr, right: RustExpr): RustExpr {
  return {
    kind: "method-call",
    receiver: left,
    method: "partial_cmp",
    args: [{ kind: "reference", expr: right }],
  };
}

function rustOrderingVariant(name: "Less" | "Equal" | "Greater"): RustExpr {
  return {
    kind: "associated-value",
    owner: { kind: "named", path: "std::cmp::Ordering" },
    name,
  };
}

function rustOrderingValue(name: "Less" | "Equal" | "Greater"): RustExpr {
  return {
    kind: "call",
    path: "Some",
    args: [rustOrderingVariant(name)],
  };
}

function rustPartialOrderingTest(
  left: RustExpr,
  right: RustExpr,
  operator: "==" | "!=",
  ordering: "Less" | "Equal" | "Greater",
): RustExpr {
  return {
    kind: "binary",
    operator,
    left: rustPartialComparison(left, right),
    right: rustOrderingValue(ordering),
  };
}

export function negateRustPlannedBooleanExpression(
  sourceExpression: Node | undefined,
  planned: RustExpr,
  context: RustPlanContext,
): RustExpr {
  let selectedExpression = sourceExpression;
  while (selectedExpression !== undefined) {
    const kind = context.input.ast.kindName(selectedExpression);
    if (kind !== KindParenthesizedExpression && kind !== KindSatisfiesExpression &&
      kind !== KindNonNullExpression && kind !== "KindAsExpression" &&
      kind !== "KindTypeAssertionExpression") {
      break;
    }
    selectedExpression = Node_Expression(context.input.ast, selectedExpression);
  }
  if (selectedExpression === undefined ||
    context.input.ast.kindName(selectedExpression) !== KindBinaryExpression ||
    planned.kind !== "binary") {
    return negateRustBooleanExpression(planned);
  }
  const left = BinaryExpression_Left(context.input.ast, selectedExpression);
  const right = BinaryExpression_Right(context.input.ast, selectedExpression);
  const inverse = planned.operator === "<" ? ">="
    : planned.operator === "<=" ? ">"
      : planned.operator === ">" ? "<="
        : planned.operator === ">=" ? "<"
          : undefined;
  if (left === undefined || right === undefined || inverse === undefined) {
    return negateRustBooleanExpression(planned);
  }
  const leftCarrier = expressionCarrier(left, context);
  const rightCarrier = expressionCarrier(right, context);
  if (isRustIntegerCarrier(leftCarrier) && isRustIntegerCarrier(rightCarrier)) {
    return { ...planned, operator: inverse };
  }
  if (!isFloatCarrier(leftCarrier) || !isFloatCarrier(rightCarrier)) {
    return negateRustBooleanExpression(planned);
  }
  const orderingName = "ordering";
  const ordering = { kind: "path" as const, path: orderingName };
  const boundary = planned.operator === "<" || planned.operator === "<=" ? "Less" : "Greater";
  const accepted = planned.operator === "<" || planned.operator === ">" ? "!=" : "==";
  return {
    kind: "method-call",
    receiver: rustPartialComparison(planned.left, planned.right),
    method: "is_none_or",
    args: [{
      kind: "closure",
      params: [{ name: orderingName, byRefCopy: false }],
      body: {
        kind: "binary",
        operator: accepted,
        left: ordering,
        right: rustOrderingVariant(boundary),
      },
    }],
  };
}

function effectivePlannedExpressionCarrier(
  node: Node,
  context: RustPlanContext,
): TargetTypeRef | undefined {
  return context.expressionOverrides?.get(node)?.carrier ??
    rustEffectiveValueCarrier(context.input.facts, node);
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
      context.input.facts.getFact(node, rustProjectUpcastFactKey) !== undefined
        ? "project-upcast"
        : context.input.facts.getFact(node, rustProjectDowncastFactKey) !== undefined
          ? "project-downcast"
        : fact.conversion === undefined ? "identity" : "runtime-conversion",
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
  const carrier = rustValueCarrierBeforeOptionProjection(context.input.facts, node);
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
  if (value !== undefined && isRustIntegerCarrier(carrier)) {
    return { kind: "int-literal", text: value.toString(10) };
  }
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

function planUnaryExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
): RustExpr | undefined {
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
    if ((fact.operator === "+=" || fact.operator === "-=") && operandNode !== undefined) {
      return planRustUpdateExpression(node, operandNode, fact, resultUse, context);
    }
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
  return operand === undefined
    ? undefined
    : fact.operator === "!"
      ? negateRustPlannedBooleanExpression(operandNode, operand, context)
      : { kind: "unary", operator: fact.operator, operand };
}

function planRustUpdateExpression(
  expression: Node,
  operand: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  resultUse: RustExpressionResultUse,
  context: RustPlanContext,
): RustExpr | undefined {
  if ((fact.operator !== "+=" && fact.operator !== "-=") ||
    context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.update-name-state",
      "Increment/decrement lowering requires the compilation-owned synthetic-name state.",
    ));
    return undefined;
  }
  const step: RustExpr = isRustBigIntCarrier(fact.resultCarrier)
    ? {
        kind: "call",
        path: "rt::BigInt::from_decimal_literal",
        args: [{ kind: "str-literal", value: "1" }],
      }
    : fact.resultCarrier.kind === "source-primitive" &&
        (fact.resultCarrier.name === "float32" || fact.resultCarrier.name === "float64")
      ? { kind: "float-literal", text: "1.0" }
      : { kind: "int-literal", text: "1" };
  if (isRustBigIntCarrier(fact.resultCarrier)) {
    context.usedAliases?.add("rt");
  }
  const returnsPrevious = resultUse === "value" &&
    context.input.ast.kindName(expression) === KindPostfixUnaryExpression;
  const sourceAccessor = findRustUpdateSourceAccessor(operand, context);
  if (sourceAccessor !== undefined) {
    return planRustSourceAccessorUpdate(
      sourceAccessor.expression,
      sourceAccessor.fact,
      fact,
      step,
      returnsPrevious,
      context,
    );
  }
  const sourceStaticField = findRustUpdateSourceStaticField(operand, context);
  if (sourceStaticField !== undefined) {
    if (!sourceStaticFieldSelectedOperationMatches(
        sourceStaticField.expression,
        sourceStaticField.fact,
        context,
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, sourceStaticField.expression),
        "rust.backend.source-static-field-selected-evidence",
        "Project static-field update conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const location = rustSourceStaticFieldLocation(sourceStaticField.fact, context);
    return location === undefined
      ? undefined
      : planRustOwnedUpdateLocation(
          location,
          fact,
          step,
          returnsPrevious,
          context,
        );
  }
  const sourceIndex = findRustUpdateSourceIndex(operand, context);
  if (sourceIndex !== undefined) {
    return planRustSourceIndexUpdate(
      sourceIndex.expression,
      sourceIndex.fact,
      fact,
      step,
      returnsPrevious,
      context,
    );
  }
  const sourceField = findRustUpdateProjectField(operand, context);
  if (sourceField !== undefined) {
    return sourceField.fact.kind === "source-union-field"
      ? planRustSourceUnionFieldUpdate(
          operand,
          sourceField.expression,
          sourceField.fact,
          fact,
          step,
          returnsPrevious,
          context,
        )
      : planRustSourceFieldUpdate(
          operand,
          sourceField.expression,
          sourceField.fact,
          fact,
          step,
          returnsPrevious,
          context,
        );
  }
  const promoted = planRustPromotedStorageLocation(
    operand,
    context,
    planExpression,
  );
  if (promoted.kind === "promoted") {
    return promoted.expression === undefined
      ? undefined
      : planRustOwnedUpdateLocation(
          promoted.expression,
          fact,
          step,
          returnsPrevious,
          context,
        );
  }
  const target = planRustDirectUpdateTarget(operand, context);
  if (target === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.update-location",
      "Increment/decrement requires a finalized writable Rust location.",
    ));
    return undefined;
  }
  if (resultUse === "discarded" &&
    context.input.ast.kindName(operand) === KindIdentifier) {
    return {
      kind: "assignment",
      operator: fact.operator,
      target,
      value: step,
    };
  }
  return planRustBorrowedUpdateLocation(
    target,
    fact,
    step,
    returnsPrevious,
    context,
  );
}

function findRustUpdateSourceIndex(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>;
} | undefined {
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-index-signature") {
      return { expression: current, fact };
    }
    if (context.input.ast.kindName(current) !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

function planRustSourceIndexUpdate(
  expression: Node,
  index: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!index.writable || !sourceIndexSelectedOperationMatches(expression, index, context) ||
    !rustTargetTypeRefEquals(index.resultCarrier, update.resultCarrier) ||
    context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.project-index-update-contract",
      "Project index update requires exact writable index, key, value, and update facts.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, expression);
  const keyNode = ElementAccessExpression_ArgumentExpression(context.input.ast, expression);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
  if (receiverNode === undefined || plannedReceiver === undefined || keyNode === undefined ||
    key === undefined || !rustTargetTypeRefEquals(expressionCarrier(keyNode, context), index.keyCarrier)) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_update_receiver");
  const keyName = allocateRustSyntheticName(context.syntheticNames, "index_update_key");
  const receiver: RustExpr = { kind: "path", path: receiverName };
  const selectedKey: RustExpr = { kind: "path", path: keyName };
  return planRustUpdateValue({
    locationBindings: [{
      name: receiverName,
      value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
    }, {
      name: keyName,
      value: key,
    }],
    read: readRustProjectObjectIndex(
      receiver,
      index.storageName,
      selectedKey,
      index.resultCarrier,
    ),
    write: (value) => writeRustProjectObjectIndex(
      receiver,
      index.storageName,
      selectedKey,
      value,
    ),
    update,
    step,
    returnsPrevious,
    context,
  });
}

function findRustUpdateSourceStaticField(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }>;
} | undefined {
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-static-field") {
      return { expression: current, fact };
    }
    if (context.input.ast.kindName(current) !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

function planRustSourceAccessorUpdate(
  accessorExpression: Node,
  accessor: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!sourceAccessorSelectedOperationMatches(accessorExpression, accessor, context) ||
    accessor.read === undefined || accessor.write === undefined ||
    !rustTargetTypeRefEquals(accessor.read.resultCarrier, update.resultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, accessorExpression),
      "rust.backend.source-accessor-update",
      "Project accessor update requires exact selected getter, setter, and update carriers.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const locationBindings: { name: string; value: RustExpr }[] = [];
  let receiver: RustExpr | undefined;
  if (accessor.receiver.kind === "instance") {
    const receiverNode = Node_Expression(context.input.ast, accessorExpression);
    const plannedReceiver = receiverNode === undefined
      ? undefined
      : planExpression(receiverNode, context);
    if (receiverNode === undefined || plannedReceiver === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(
      context.syntheticNames,
      "accessor_update_receiver",
    );
    locationBindings.push({
      name: receiverName,
      value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
    });
    receiver = { kind: "path", path: receiverName };
  }
  const plannedRead = planRustSourceAccessorCall(
    accessorExpression,
    accessor,
    "read",
    [],
    context,
    receiver,
  );
  const read = plannedRead === undefined
    ? undefined
    : finishRustSourceAccessorCall(
        accessorExpression,
        "read",
        plannedRead,
        context,
      );
  if (read === undefined) {
    return undefined;
  }
  return planRustUpdateValue({
    locationBindings,
    read,
    write: (value) => {
      const plannedWrite = planRustSourceAccessorCall(
        accessorExpression,
        accessor,
        "write",
        [value],
        context,
        receiver,
      );
      return plannedWrite === undefined
        ? undefined
        : finishRustSourceAccessorCall(
            accessorExpression,
            "write",
            plannedWrite,
            context,
          );
    },
    update,
    step,
    returnsPrevious,
    context,
  });
}

function findRustUpdateSourceAccessor(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>;
} | undefined {
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-accessor") {
      return { expression: current, fact };
    }
    if (context.input.ast.kindName(current) !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

function planRustSourceUnionFieldUpdate(
  operand: Node,
  fieldExpression: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!sourceUnionFieldSelectedOperationMatches(fieldExpression, field, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fieldExpression),
      "rust.backend.source-union-field-selected-evidence",
      "Source-union field update conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, fieldExpression);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  if (receiver === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "union_update_receiver");
  const projection = planRustUpdateProjectionArguments(operand, fieldExpression, context);
  if (projection === undefined) {
    return undefined;
  }
  const projected = planRustSourceUnionFieldProjection(
    fieldExpression,
    { kind: "path", path: receiverName },
    field,
    context,
    (payload, selectedField, variantIndex) => {
      const overrides = new Map(context.expressionOverrides ?? []);
      for (const override of projection.overrides) {
        overrides.set(override.node, override.value);
      }
      const mutate = (storage: RustExpr): RustExpr | undefined => {
          overrides.set(fieldExpression, {
            expression: storage,
            carrier: field.resultCarrier,
            valueForm: "value",
          });
          const target = operand === fieldExpression
            ? storage
            : planRustDirectUpdateTarget(operand, {
                ...context,
                expressionOverrides: overrides,
              }, projection.inputOverrides);
          return target === undefined
            ? undefined
            : planRustBorrowedUpdateLocation(
                target,
                update,
                step,
                returnsPrevious,
                context,
              );
      };
      const mutation = mutateRustStoredObjectField(
        selectedField.storage,
        field.variants[variantIndex]!.carrier,
        payload,
        selectedField.storageIndex,
        mutate,
        context,
      );
      return mutation;
    },
  );
  return projected === undefined
    ? undefined
    : {
        kind: "block",
        bindings: [
          { name: receiverName, value: receiver },
          ...projection.bindings,
        ],
        value: projected,
      };
}

function planRustSourceFieldUpdate(
  operand: Node,
  fieldExpression: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!sourceFieldSelectedOperationMatches(fieldExpression, field, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fieldExpression),
      "rust.backend.source-field-selected-evidence",
      "Project-source field update conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, fieldExpression);
  const plannedReceiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const receiver = receiverNode === undefined || plannedReceiver === undefined
    ? plannedReceiver
    : planRustSharedReceiver(receiverNode, plannedReceiver, context);
  if (receiver === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "update_receiver");
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const projection = planRustUpdateProjectionArguments(
    operand,
    fieldExpression,
    context,
  );
  if (projection === undefined) {
    return undefined;
  }
  if (field.dispatch === undefined) {
    const overrides = new Map(context.expressionOverrides ?? []);
    for (const override of projection.overrides) {
      overrides.set(override.node, override.value);
    }
    const mutate = (storage: RustExpr): RustExpr | undefined => {
        overrides.set(fieldExpression, {
          expression: storage,
          carrier: field.resultCarrier,
          valueForm: "value",
        });
        const target = operand === fieldExpression
          ? storage
          : planRustDirectUpdateTarget(operand, {
              ...context,
              expressionOverrides: overrides,
            }, projection.inputOverrides);
        return target === undefined
          ? undefined
          : planRustBorrowedUpdateLocation(
              target,
              update,
              step,
              returnsPrevious,
              context,
            );
    };
    const mutation = mutateRustStoredObjectField(
      field.storage,
      field.receiverCarrier,
      receiverPath,
      field.storageIndex,
      mutate,
      context,
    );
    if (mutation === undefined) {
      return undefined;
    }
    return {
      kind: "block",
      bindings: [
        { name: receiverName, value: receiver },
        ...projection.bindings,
      ],
      value: mutation,
    };
  }
  const dispatchPlan = field.declaration === undefined
    ? undefined
    : context.input.projectFieldDispatch.planFor(field.declaration);
  if (dispatchPlan?.write === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fieldExpression),
      "rust.backend.project-field-dispatch-plan",
      "Project-source field update has no exact finalized writable dispatch plan.",
    ));
    return undefined;
  }
  const dispatchRoles = {
    read: dispatchPlan.read,
    write: dispatchPlan.write,
    errorDomain: context.errorDomain,
  };
  const fieldName = allocateRustSyntheticName(context.syntheticNames, "update_field");
  const fieldPath: RustExpr = { kind: "path", path: fieldName };
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fieldExpression, {
    expression: fieldPath,
    carrier: field.resultCarrier,
    valueForm: "value",
  });
  for (const override of projection.overrides) {
    overrides.set(override.node, override.value);
  }
  const target = operand === fieldExpression
    ? fieldPath
    : planRustDirectUpdateTarget(operand, {
        ...context,
        expressionOverrides: overrides,
      }, projection.inputOverrides);
  if (target === undefined) {
    return undefined;
  }
  const updated = planRustBorrowedUpdateLocation(
    target,
    update,
    step,
    returnsPrevious,
    context,
  );
  if (updated === undefined) {
    return undefined;
  }
  const resultName = allocateRustSyntheticName(context.syntheticNames, "update_result");
  return {
    kind: "block",
    bindings: [
      { name: receiverName, value: receiver },
      {
        name: fieldName,
        mutable: true,
        value: readRustProjectDispatchedField(receiverPath, field.dispatch.read, {
          ...dispatchPlan.read,
          errorDomain: context.errorDomain,
        }),
      },
      ...projection.bindings,
      { name: resultName, value: updated },
    ],
    value: {
      kind: "evaluate-then",
      effect: writeRustProjectDispatchedField(
        receiverPath,
        allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
        field.dispatch.read,
        field.dispatch.write,
        "=",
        fieldPath,
        dispatchRoles,
      ),
      discard: "unit",
      value: { kind: "path", path: resultName },
    },
  };
}

function findRustUpdateProjectField(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<
    RustTargetOperationFact,
    { readonly kind: "source-field" | "source-union-field" }
  >;
} | undefined {
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-field" || fact?.kind === "source-union-field") {
      return { expression: current, fact };
    }
    const kind = context.input.ast.kindName(current);
    if (kind !== KindPropertyAccessExpression && kind !== KindElementAccessExpression &&
      kind !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

function planRustUpdateProjectionArguments(
  operand: Node,
  fieldExpression: Node,
  context: RustPlanContext,
): {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly overrides: readonly {
    readonly node: Node;
    readonly value: RustEffectiveExpressionOverride;
  }[];
  readonly inputOverrides: ReadonlyMap<RustFinalizedSourceInput, RustExpr>;
} | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const projections: Node[] = [];
  let current: Node | undefined = operand;
  while (current !== undefined && current !== fieldExpression) {
    projections.push(current);
    current = Node_Expression(context.input.ast, current);
  }
  if (current !== fieldExpression) {
    return undefined;
  }
  const bindings: { name: string; value: RustExpr }[] = [];
  const overrides: {
    node: Node;
    value: {
      expression: RustExpr;
      carrier: TargetTypeRef;
      valueForm: "value";
    };
  }[] = [];
  const inputOverrides = new Map<RustFinalizedSourceInput, RustExpr>();
  for (const projection of projections.reverse()) {
    if (context.input.ast.kindName(projection) !== KindElementAccessExpression) {
      continue;
    }
    const argument = ElementAccessExpression_ArgumentExpression(context.input.ast, projection);
    const carrier = argument === undefined ? undefined : expressionCarrier(argument, context);
    const operation = context.input.facts.getFact(projection, rustTargetOperationFactKey);
    const candidateTargetInput = operation?.kind === "provider-operation" &&
        operation.abi.target.form === "index" &&
        operation.abi.targetArguments.length === 1
      ? operation.abi.targetArguments[0]
      : undefined;
    const targetInput = candidateTargetInput !== undefined &&
        isRustFinalizedSourceInput(candidateTargetInput)
      ? candidateTargetInput
      : undefined;
    const value = argument === undefined
      ? undefined
      : targetInput === undefined
        ? planExpression(argument, context)
        : planFinalizedTargetInput(
            context,
            targetInput,
            Node_Expression(context.input.ast, projection),
            [argument],
            projection,
          );
    if (argument === undefined || carrier === undefined || value === undefined) {
      return undefined;
    }
    const name = allocateRustSyntheticName(context.syntheticNames, "update_index");
    bindings.push({ name, value });
    if (targetInput !== undefined) {
      inputOverrides.set(targetInput, { kind: "path", path: name });
      continue;
    }
    overrides.push({
      node: argument,
      value: {
        expression: { kind: "path", path: name },
        carrier,
        valueForm: "value",
      },
    });
  }
  return { bindings, overrides, inputOverrides };
}

function planRustOwnedUpdateLocation(
  location: RustExpr,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "update_location");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  return planRustUpdateValue({
    locationBindings: [{ name: locationName, value: location }],
    read: { kind: "method-call", receiver: locationPath, method: "load", args: [] },
    write: (value) => ({
      kind: "method-call",
      receiver: locationPath,
      method: "store",
      args: [value],
    }),
    update,
    step,
    returnsPrevious,
    context,
  });
}

function planRustBorrowedUpdateLocation(
  target: RustExpr,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "update_location");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  const dereference: RustExpr = { kind: "dereference", pointer: locationPath };
  return planRustUpdateValue({
    locationBindings: [{
      name: locationName,
      value: { kind: "reference", expr: target, mutable: true },
    }],
    read: isRustCopyCarrier(update.resultCarrier)
      ? dereference
      : { kind: "method-call", receiver: dereference, method: "clone", args: [] },
    write: (value) => ({
      kind: "assignment",
      operator: "=",
      target: dereference,
      value,
    }),
    update,
    step,
    returnsPrevious,
    context,
  });
}

function planRustUpdateValue(options: {
  readonly locationBindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly read: RustExpr;
  readonly write: (value: RustExpr) => RustExpr | undefined;
  readonly update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>;
  readonly step: RustExpr;
  readonly returnsPrevious: boolean;
  readonly context: RustPlanContext;
}): RustExpr | undefined {
  if (options.context.syntheticNames === undefined ||
    (options.update.operator !== "+=" && options.update.operator !== "-=")) {
    return undefined;
  }
  const previousName = allocateRustSyntheticName(options.context.syntheticNames, "update_previous");
  const nextName = allocateRustSyntheticName(options.context.syntheticNames, "update_next");
  const previous: RustExpr = { kind: "path", path: previousName };
  const next: RustExpr = { kind: "path", path: nextName };
  const reusable = (value: RustExpr, preserve: boolean): RustExpr =>
    preserve && !isRustCopyCarrier(options.update.resultCarrier)
      ? { kind: "method-call", receiver: value, method: "clone", args: [] }
      : value;
  const nextValue: RustExpr = {
    kind: "binary",
    operator: options.update.operator === "+=" ? "+" : "-",
    left: reusable(previous, options.returnsPrevious),
    right: options.step,
  };
  const write = options.write(reusable(next, !options.returnsPrevious));
  if (write === undefined) {
    return undefined;
  }
  return {
    kind: "block",
    bindings: [
      ...options.locationBindings,
      { name: previousName, value: options.read },
      { name: nextName, value: nextValue },
    ],
    value: {
      kind: "evaluate-then",
      effect: write,
      discard: "unit",
      value: options.returnsPrevious ? previous : next,
    },
  };
}

function planRustDirectUpdateTarget(
  operand: Node,
  context: RustPlanContext,
  inputOverrides?: ReadonlyMap<RustFinalizedSourceInput, RustExpr>,
): RustExpr | undefined {
  const { ast } = context.input;
  if (ast.kindName(operand) === KindIdentifier) {
    const binding = context.input.facts.getFact(operand, rustSourceBindingFactKey);
    const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    return path !== undefined && isValidRustIdentifier(path) ? { kind: "path", path } : undefined;
  }
  const fact = context.input.facts.getFact(operand, rustTargetOperationFactKey);
  if (!rustTargetOperationIsDirectLocation(fact)) {
    return undefined;
  }
  if (fact?.kind === "provider-operation") {
    if (fact.abi.result.kind !== "sync" || fact.abi.result.conversion.kind !== "identity" ||
      fact.abi.effects.invocation !== "infallible" ||
      (fact.abi.target.form !== "field" && fact.abi.target.form !== "index")) {
      return undefined;
    }
    const receiver = Node_Expression(ast, operand);
    const argument = ast.kindName(operand) === KindElementAccessExpression
      ? ElementAccessExpression_ArgumentExpression(ast, operand)
      : undefined;
    return planProviderOperationExpression(
      context,
      fact,
      receiver,
      argument === undefined ? [] : [argument],
      operand,
      inputOverrides === undefined
        ? undefined
        : { sourceValues: new Map(), inputs: inputOverrides },
    );
  }
  if (fact?.kind !== "tuple-index" && fact?.kind !== "fixed-index") {
    return undefined;
  }
  const receiverNode = Node_Expression(ast, operand);
  const indexNode = ElementAccessExpression_ArgumentExpression(ast, operand);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const receiver = receiverNode === undefined || plannedReceiver === undefined
    ? undefined
    : planRustNonConsumingValue(receiverNode, plannedReceiver, context);
  if (receiver === undefined || indexNode === undefined) {
    return undefined;
  }
  const target: RustExpr = fact.kind === "tuple-index"
    ? { kind: "field", receiver, name: String(fact.index) }
    : {
        kind: "index",
        receiver,
        index: { kind: "int-literal", text: String(fact.index) },
      };
  if (ast.kindName(indexNode) === KindNumericLiteral) {
    return target;
  }
  const effect = planExpression(indexNode, context);
  return effect === undefined
    ? undefined
    : { kind: "evaluate-then", effect, discard: "value", value: target };
}

function planBinaryExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind === "program-error-type-test") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    if (leftNode === undefined || left === undefined ||
      !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(leftNode, context), fact.sourceCarrier) ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.program-error-type-test-carrier") ||
      !selectedOperationMatches(
        context.input.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        "program-error-type-test",
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.program-error-type-test-selected-evidence",
        "Program-error type test conflicts with its exact finalized source operation evidence.",
      ));
      return undefined;
    }
    return planRustProgramErrorTypeTest(node, left, fact, context);
  }
  if (fact?.kind === "project-type-test") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const plannedLeft = leftNode === undefined ? undefined : planExpression(leftNode, context);
    const left = leftNode === undefined || plannedLeft === undefined
      ? undefined
      : planRustNonConsumingValue(leftNode, plannedLeft, context);
    if (leftNode === undefined || left === undefined ||
      !rustTargetTypeRefEquals(effectivePlannedExpressionCarrier(leftNode, context), fact.sourceCarrier) ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.project-type-test-carrier") ||
      !selectedOperationMatches(
        context.input.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        "project-type-test",
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-type-test-selected-evidence",
        "Project type test conflicts with its exact finalized source operation evidence.",
      ));
      return undefined;
    }
    return planRustProjectTypeTest(node, left, fact, context);
  }
  if ((fact?.kind === "operator-token" || fact?.kind === "operator-call" || fact?.kind === "string-concat") &&
    !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.operator-carrier")) {
    return undefined;
  }
  if ((fact?.kind === "operator-token" || fact?.kind === "operator-call" || fact?.kind === "string-concat") &&
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
    if (left === undefined || right === undefined ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.option-coalesce-carrier") ||
      !selectedOperationMatches(
        context.input.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        rustTargetOperationText(fact),
      )) {
      return undefined;
    }
    context.usedAliases?.add("rt");
    const fallbackIsFallible = rustExpressionUsesTryInCurrentRegion(right);
    const fallback: RustExpr = !fallbackIsFallible && right.kind === "call" && right.args.length === 0
      ? { kind: "path", path: right.path }
      : {
          kind: "closure",
          params: [],
          body: fallbackIsFallible
            ? applyRustFallibleResultExpression(right, {
                errorDomain: context.errorDomain,
                errorTypePath: "rt::TsonicError",
              })
            : right,
        };
    const presentValueName = allocateRustSyntheticName(
      context.syntheticNames ?? createRustSyntheticNameState(context.input.ast, node, []),
      "present_value",
    );
    const present: RustExpr = fallbackIsFallible && fact.rightOperand !== "option"
      ? { kind: "path", path: "Ok::<_, rt::TsonicError>" }
      : fallbackIsFallible
        ? {
            kind: "closure",
            params: [{ name: presentValueName, byRefCopy: false }],
            body: {
              kind: "call",
              path: "Ok::<_, rt::TsonicError>",
              args: [fact.rightOperand === "option"
                ? { kind: "call", path: "Some", args: [{ kind: "path", path: presentValueName }] }
                : { kind: "path", path: presentValueName }],
            },
          }
        : {
            kind: "path",
            path: fact.rightOperand === "option" ? "Some" : "std::convert::identity",
          };
    const coalesced: RustExpr = {
      kind: "call",
      path: "rt::option_coalesce",
      args: [
        left,
        present,
        fallback,
      ],
    };
    if (!fallbackIsFallible) {
      return coalesced;
    }
    context.usedAliases?.add("rt");
    return { kind: "try", expr: coalesced, errorDomain: context.errorDomain };
  }
  if (fact !== undefined && fact.kind === "option-check") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const rightNode = BinaryExpression_Right(context.input.ast, node);
    const optionNode = fact.optionOperand === "left" ? leftNode : rightNode;
    const nullishNode = fact.optionOperand === "left" ? rightNode : leftNode;
    const option = optionNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(optionNode, context, "value");
    const nullish = nullishNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(nullishNode, context, "value");
    const boolCarrier = rustSourcePrimitiveTargetType("bool");
    if (optionNode === undefined || nullishNode === undefined || option === undefined || nullish === undefined ||
      !rustTargetTypeRefEquals(expressionCarrier(optionNode, context), fact.optionCarrier) ||
      !rustTargetTypeRefEquals(expressionCarrier(nullishNode, context), fact.nullishCarrier) ||
      !requireExpressionCarrier(node, boolCarrier, context, "rust.backend.option-check-carrier") ||
      !selectedOperationMatches(
        context.input.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        boolCarrier,
        rustTargetOperationText(fact),
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-check",
        "Option presence check conflicts with its exact finalized operand carriers or selected operation.",
      ));
      return undefined;
    }
    const check = (receiver: RustExpr): RustExpr => ({
      kind: "method-call",
      receiver,
      method: fact.negated ? "is_some" : "is_none",
      args: [],
    });
    if (isExplicitRustNullishValue(nullish)) {
      return check(planRustNonConsumingValue(optionNode, option, context));
    }
    if (fact.optionOperand === "right") {
      return {
        kind: "evaluate-then",
        effect: nullish,
        discard: isRustUnitCarrier(expressionCarrier(nullishNode, context)) ? "unit" : "value",
        value: check(planRustNonConsumingValue(optionNode, option, context)),
      };
    }
    const optionName = allocateRustSyntheticName(
      context.syntheticNames ?? createRustSyntheticNameState(context.input.ast, node, []),
      "option_value",
    );
    return {
      kind: "block",
      bindings: [{ name: optionName, value: option }],
      value: {
        kind: "evaluate-then",
        effect: nullish,
        discard: isRustUnitCarrier(expressionCarrier(nullishNode, context)) ? "unit" : "value",
        value: check({ kind: "path", path: optionName }),
      },
    };
  }
  if (fact !== undefined && fact.kind === "option-equality") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const rightNode = BinaryExpression_Right(context.input.ast, node);
    const left = leftNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(leftNode, context, "value");
    const right = rightNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(rightNode, context, "value");
    const boolCarrier = rustSourcePrimitiveTargetType("bool");
    const leftCarrier = leftNode === undefined ? undefined : expressionCarrier(leftNode, context);
    const rightCarrier = rightNode === undefined ? undefined : expressionCarrier(rightNode, context);
    const selectedOperation = context.input.facts.getSelectedTargetOperator(node);
    if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined ||
      !rustTargetTypeRefEquals(leftCarrier, fact.optionCarrier) ||
      !rustTargetTypeRefEquals(rightCarrier, fact.optionCarrier) ||
      !requireExpressionCarrier(node, boolCarrier, context, "rust.backend.option-equality-carrier") ||
      !selectedOperationMatches(
        selectedOperation,
        fact.operationId,
        "operator",
        boolCarrier,
        rustTargetOperationText(fact),
      )) {
      const diagnostic = missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-equality",
        "Option equality conflicts with its exact finalized operand carrier or selected operation.",
      );
      context.diagnostics.push({
        ...diagnostic,
        evidence: [
          ...(diagnostic.evidence ?? []),
          `carrier.expected=${JSON.stringify(fact.optionCarrier)}`,
          `carrier.left=${JSON.stringify(leftCarrier)}`,
          `carrier.right=${JSON.stringify(rightCarrier)}`,
          `operation.selected.id=${selectedOperation?.operationId ?? "missing"}`,
          `operation.selected.kind=${selectedOperation?.operationKind ?? "missing"}`,
          `operation.selected.target=${selectedOperation?.targetOperation ?? "missing"}`,
        ],
      });
      return undefined;
    }
    return {
      kind: "binary",
      operator: fact.negated ? "!=" : "==",
      left: planRustNonConsumingValue(leftNode, left, context),
      right: planRustNonConsumingValue(rightNode, right, context),
    };
  }
  if (fact !== undefined && fact.kind === "option-value-equality") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const rightNode = BinaryExpression_Right(context.input.ast, node);
    const optionNode = fact.optionOperand === "left" ? leftNode : rightNode;
    const valueNode = fact.optionOperand === "left" ? rightNode : leftNode;
    const option = optionNode === undefined
      ? undefined
      : planExpressionBeforeValueProjections(optionNode, context, "value");
    const value = valueNode === undefined ? undefined : planExpression(valueNode, context);
    const valueProjection = valueNode === undefined
      ? undefined
      : context.input.facts.getFact(valueNode, rustOptionProjectionFactKey);
    const optionCarrier = optionNode === undefined
      ? undefined
      : expressionCarrier(optionNode, context);
    const valueCarrier = valueNode === undefined
      ? undefined
      : rustValueCarrierBeforeOptionProjection(context.input.facts, valueNode);
    if (optionNode === undefined || valueNode === undefined || option === undefined || value === undefined ||
      !rustTargetTypeRefEquals(optionCarrier, fact.optionCarrier) ||
      !rustTargetTypeRefEquals(valueCarrier, fact.valueCarrier) ||
      !rustTargetTypeRefEquals(rustOptionElementCarrier(fact.optionCarrier), fact.valueCarrier) ||
      !requireExpressionCarrier(
        node,
        rustSourcePrimitiveTargetType("bool"),
        context,
        "rust.backend.option-value-equality-carrier",
      ) ||
      !selectedOperationMatches(
        context.input.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        rustSourcePrimitiveTargetType("bool"),
        rustTargetOperationText(fact),
      ) ||
      (valueProjection !== undefined &&
        (valueProjection.kind !== "some" ||
          !rustTargetTypeRefEquals(valueProjection.sourceCarrier, fact.valueCarrier) ||
          !rustTargetTypeRefEquals(valueProjection.resultCarrier, fact.optionCarrier)))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-value-equality",
        "Option/value equality conflicts with its exact finalized operand carriers and projection.",
      ));
      return undefined;
    }
    const comparableValue: RustExpr = valueProjection === undefined
      ? { kind: "call", path: "Some", args: [value] }
      : value;
    return {
      kind: "binary",
      operator: fact.negated ? "!=" : "==",
      left: fact.optionOperand === "left"
        ? planRustNonConsumingValue(optionNode, option, context)
        : comparableValue,
      right: fact.optionOperand === "left"
        ? comparableValue
        : planRustNonConsumingValue(optionNode, option, context),
    };
  }
  if (fact !== undefined && fact.kind === "disjoint-equality") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const rightNode = BinaryExpression_Right(context.input.ast, node);
    const left = leftNode === undefined ? undefined : planExpression(leftNode, context);
    const right = rightNode === undefined ? undefined : planExpression(rightNode, context);
    if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.disjoint-equality-carrier") ||
      !selectedOperationMatches(
        context.input.facts.getSelectedTargetOperator(node),
        fact.operationId,
        "operator",
        fact.resultCarrier,
        rustTargetOperationText(fact),
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.disjoint-equality-selected-evidence",
        "Disjoint equality conflicts with its exact finalized source operation evidence.",
      ));
      return undefined;
    }
    return {
      kind: "evaluate-then",
      effect: left,
      discard: isRustUnitCarrier(expressionCarrier(leftNode, context)) ? "unit" : "value",
      value: {
        kind: "evaluate-then",
        effect: right,
        discard: isRustUnitCarrier(expressionCarrier(rightNode, context)) ? "unit" : "value",
        value: { kind: "bool-literal", value: fact.value },
      },
    };
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
  if (leftNode === undefined || rightNode === undefined || left === undefined || right === undefined) {
    return undefined;
  }
  if (fact.kind === "string-concat") {
    const parts: RustExpr[] = [];
    for (const [sideNode, side] of [[leftNode, left], [rightNode, right]] as const) {
      if (side.kind === "string-concat") {
        parts.push(...side.parts);
      } else {
        parts.push(planRustNonConsumingValue(sideNode, side, context));
      }
    }
    return rustStringConcat(parts);
  }
  if (fact.kind === "operator-call") {
    return planRustOperatorCallExpression(
      fact,
      left,
      right,
      node,
      context,
      leftNode,
      rightNode,
    );
  }
  if (fact.kind === "operator-token") {
    // Owned-String literals in comparison position lower as &str literals so
    // generated code stays clippy-clean (cmp_owned).
    const comparison = fact.operator === "==" || fact.operator === "!=";
    const convertedLeft = applyRustValueConversion(context, left, fact.leftConversion, leftNode);
    const convertedRight = applyRustValueConversion(context, right, fact.rightConversion, rightNode);
    if (convertedLeft === undefined || convertedRight === undefined) {
      return undefined;
    }
    const comparisonLeft = comparison && leftNode !== undefined
      ? planRustNonConsumingValue(leftNode, convertedLeft, context)
      : convertedLeft;
    const comparisonRight = comparison && rightNode !== undefined
      ? planRustNonConsumingValue(rightNode, convertedRight, context)
      : convertedRight;
    const borrowLiteral = (side: RustExpr): RustExpr => {
      const borrowed = comparison ? rustBorrowedStringView(side) : side;
      return comparison && borrowed.kind === "string-literal"
        ? { kind: "str-literal", value: borrowed.value }
        : borrowed;
    };
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
    const emptyStringComparison = planEmptyStringComparison(
      fact.operator,
      comparisonLeft,
      comparisonRight,
      leftNode,
      rightNode,
      context,
    );
    if (emptyStringComparison !== undefined) {
      return emptyStringComparison;
    }
    const rangeContainment = planRustRangeContainment(
      fact.operator,
      comparisonLeft,
      comparisonRight,
    );
    if (rangeContainment !== undefined) {
      return rangeContainment;
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

function isExplicitRustNullishValue(expression: RustExpr): boolean {
  return expression.kind === "none" ||
    expression.kind === "path" &&
      (expression.path === "rt::Undefined" || expression.path === "rt::Null");
}

export function planRustOperatorCallExpression(
  fact: Extract<RustTargetOperationFact, { readonly kind: "operator-call" }>,
  left: RustExpr,
  right: RustExpr,
  node: Node,
  context: RustPlanContext,
  leftNode?: Node,
  rightNode?: Node,
): RustExpr | undefined {
  registerAliasFromPath(context, fact.path);
  if (fact.fallible && context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.operator",
      "Fallible operator calls require a finalized fallible lowering context.",
    ));
    return undefined;
  }
  const operands = [
    {
      expression: left,
      node: leftNode,
      mode: fact.operandModes[0],
      conversion: fact.leftConversion,
    },
    {
      expression: right,
      node: rightNode,
      mode: fact.operandModes[1],
      conversion: fact.rightConversion,
    },
  ].map(({ expression, node: operandNode, mode, conversion }) => {
    const converted = applyRustValueConversion(context, expression, conversion, operandNode);
    if (converted === undefined) {
      return undefined;
    }
    const nonConsuming = mode === "value" || operandNode === undefined
      ? converted
      : planRustNonConsumingValue(operandNode, converted, context);
    return applyRustArgumentMode(context, nonConsuming, mode, operandNode);
  });
  if (operands.some((operand) => operand === undefined)) {
    return undefined;
  }
  const call: RustExpr = {
    kind: "call",
    path: fact.path,
    args: operands as readonly RustExpr[],
  };
  return fact.fallible ? { kind: "try", expr: call, errorDomain: "runtime" } : call;
}

function planEmptyStringComparison(
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
  const emptyLiteral = (expression: RustExpr): boolean =>
    (expression.kind === "string-literal" || expression.kind === "str-literal") &&
    expression.value.length === 0;
  const selected = emptyLiteral(left)
    ? { expression: right, node: rightNode }
    : emptyLiteral(right)
      ? { expression: left, node: leftNode }
      : undefined;
  if (selected?.node === undefined ||
    !isRustStringCarrier(effectivePlannedExpressionCarrier(selected.node, context))) {
    return undefined;
  }
  const isEmpty: RustExpr = {
    kind: "method-call",
    receiver: selected.expression,
    method: "is_empty",
    args: [],
  };
  return operator === "=="
    ? isEmpty
    : negateRustBooleanExpression(isEmpty);
}

function planRustRangeContainment(
  operator: string,
  left: RustExpr,
  right: RustExpr,
): RustExpr | undefined {
  if (operator !== "&&" && operator !== "||") {
    return undefined;
  }
  const direct = planRustRangeComparisonPair(operator, left, right);
  if (direct !== undefined) {
    return direct;
  }
  if (left.kind === "binary" && left.operator === operator) {
    const trailing = planRustRangeComparisonPair(operator, left.right, right);
    if (trailing !== undefined) {
      return {
        kind: "binary",
        operator,
        left: left.left,
        right: trailing,
      };
    }
  }
  if (right.kind === "binary" && right.operator === operator) {
    const leading = planRustRangeComparisonPair(operator, left, right.left);
    if (leading !== undefined) {
      return {
        kind: "binary",
        operator,
        left: leading,
        right: right.right,
      };
    }
  }
  return undefined;
}

function planRustRangeComparisonPair(
  operator: "&&" | "||",
  left: RustExpr,
  right: RustExpr,
): RustExpr | undefined {
  if (left.kind !== "binary" || right.kind !== "binary") {
    return undefined;
  }
  const inclusive = operator === "&&" &&
    (left.operator === ">=" || left.operator === "<=") &&
    (right.operator === ">=" || right.operator === "<=");
  const exclusive = operator === "||" &&
    (left.operator === ">" || left.operator === "<") &&
    (right.operator === ">" || right.operator === "<");
  if (!inclusive && !exclusive) {
    return undefined;
  }
  const first = comparisonSubjectAndBound(left, exclusive);
  const second = comparisonSubjectAndBound(right, exclusive);
  if (first === undefined || second === undefined ||
    first.subject.path !== second.subject.path ||
    !isRustNumericLiteral(first.bound) || !isRustNumericLiteral(second.bound)) {
    return undefined;
  }
  const lower = first.relationship === "lower" ? first.bound
    : second.relationship === "lower" ? second.bound
      : undefined;
  const upper = first.relationship === "upper" ? first.bound
    : second.relationship === "upper" ? second.bound
      : undefined;
  if (lower === undefined || upper === undefined) {
    return undefined;
  }
  if (exclusive && (!isRustIntegerLiteral(lower) || !isRustIntegerLiteral(upper))) {
    if (!isRustFloatLiteral(lower) || !isRustFloatLiteral(upper)) {
      return undefined;
    }
    return {
      kind: "binary",
      operator: "||",
      left: rustPartialOrderingTest(first.subject, lower, "==", "Less"),
      right: rustPartialOrderingTest(second.subject, upper, "==", "Greater"),
    };
  }
  const contains: RustExpr = {
    kind: "method-call",
    receiver: { kind: "range", start: lower, end: upper, inclusive: true },
    method: "contains",
    args: [{ kind: "reference", expr: first.subject }],
  };
  return inclusive ? contains : negateRustBooleanExpression(contains);
}

function comparisonSubjectAndBound(
  expression: Extract<RustExpr, { readonly kind: "binary" }>,
  outsideRange: boolean,
): {
  readonly subject: Extract<RustExpr, { readonly kind: "path" }>;
  readonly bound: RustExpr;
  readonly relationship: "lower" | "upper";
} | undefined {
  if (expression.left.kind === "path" && isRustNumericLiteral(expression.right)) {
    const relationship = outsideRange
      ? expression.operator === "<" ? "lower"
        : expression.operator === ">" ? "upper"
          : undefined
      : expression.operator === ">=" ? "lower"
        : expression.operator === "<=" ? "upper"
          : undefined;
    return relationship === undefined
      ? undefined
      : { subject: expression.left, bound: expression.right, relationship };
  }
  if (expression.right.kind === "path" && isRustNumericLiteral(expression.left)) {
    const relationship = outsideRange
      ? expression.operator === ">" ? "lower"
        : expression.operator === "<" ? "upper"
          : undefined
      : expression.operator === "<=" ? "lower"
        : expression.operator === ">=" ? "upper"
          : undefined;
    return relationship === undefined
      ? undefined
      : { subject: expression.right, bound: expression.left, relationship };
  }
  return undefined;
}

function isRustNumericLiteral(expression: RustExpr): boolean {
  return expression.kind === "int-literal" || expression.kind === "float-literal" ||
    expression.kind === "unary" && expression.operator === "-" &&
      (expression.operand.kind === "int-literal" || expression.operand.kind === "float-literal");
}

function isRustIntegerLiteral(expression: RustExpr): boolean {
  return expression.kind === "int-literal" || expression.kind === "unary" &&
    expression.operator === "-" && expression.operand.kind === "int-literal";
}

function isRustFloatLiteral(expression: RustExpr): boolean {
  return expression.kind === "float-literal" || expression.kind === "unary" &&
    expression.operator === "-" && expression.operand.kind === "float-literal";
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
    ? negateRustBooleanExpression(literal.other)
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
  const borrowedString = rustBorrowedStringView(argument);
  if (borrowedString !== argument) {
    return borrowedString;
  }
  if (node !== undefined &&
    context.expressionOverrides?.get(node)?.valueForm === "shared-reference") {
    return argument;
  }
  const sourceParameterAbi = node === undefined
    ? undefined
    : context.input.facts.getFact(node, rustSourceParameterAbiFactKey);
  if (sourceParameterAbi?.mode === "ref" || sourceParameterAbi?.mode === "mut-ref") {
    return argument;
  }
  if (argument.kind === "string-literal") {
    return { kind: "str-literal", value: argument.value };
  }
  if (argument.kind === "vec-literal") {
    return { kind: "reference", expr: { kind: "slice-literal", elements: argument.elements } };
  }
  return { kind: "reference", expr: argument };
}

function mutRefShape(argument: RustExpr): RustExpr {
  return {
    kind: "reference",
    expr: argument.kind === "vec-literal"
      ? { kind: "slice-literal", elements: argument.elements }
      : argument,
    mutable: true,
  };
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
    const sourceParameterAbi = node === undefined
      ? undefined
      : context.input.facts.getFact(node, rustSourceParameterAbiFactKey);
    if (sourceParameterAbi?.mode === "mut-ref") {
      return argument;
    }
    return mutRefShape(argument);
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
      : rustEffectiveValueCarrier(context.input.facts, node);
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
  const nonConsumingSource = contract.sourceMode === "ref" && node !== undefined
    ? planRustNonConsumingValue(node, expression, context)
    : expression;
  const source = contract.sourceMode === "ref"
    ? applyRustArgumentMode(context, nonConsumingSource, "ref", node)
    : nonConsumingSource;
  const converted = lowerRustValueConversion(contract, source, context, node);
  if (converted === undefined) {
    return undefined;
  }
  if (!contract.fallible) {
    return converted;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node ?? context.sourceFile),
      "rust.backend.value-conversion",
      "Fallible target value conversion requires a finalized fallible lowering context.",
    ));
    return undefined;
  }
  return { kind: "try", expr: converted, errorDomain: "runtime" };
}

export function lowerRustValueConversion(
  contract: import("../../source/rust-facts/value-conversions.js").RustValueConversionContract,
  source: RustExpr,
  context: RustPlanContext,
  node: Node | undefined,
): RustExpr | undefined {
  switch (contract.lowering) {
    case "identity":
      return source;
    case "call":
      registerAliasFromPath(context, contract.path);
      return { kind: "call", path: contract.path, args: [source] };
    case "numeric-cast":
      return { kind: "numeric-cast", expression: source, target: contract.targetType };
    case "owned-string-from-borrowed-str":
      return { kind: "owned-string-from-borrowed-str", expression: source };
    case "copy-from-reference":
      return { kind: "dereference", pointer: source };
    case "source-union-variant": {
      const union = rustSourceUnionCarrierValue(contract.target);
      const typePath = union === undefined ? undefined : sourceTypePath(context, union);
      if (union === undefined || typePath === undefined ||
        union.variants.filter((variant) =>
          variant.name === contract.variantName &&
          rustTargetTypeRefEquals(variant.carrier, contract.source)).length !== 1) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node ?? context.sourceFile),
          "rust.backend.source-union-conversion",
          "Source-union conversion has no exact emitted variant contract.",
        ));
        return undefined;
      }
      return {
        kind: "call",
        path: `${typePath}::${contract.variantName}`,
        args: [source],
      };
    }
    case "option-map": {
      const valueName = allocateRustSyntheticName(
        context.syntheticNames ?? createRustSyntheticNameState(
          context.input.ast,
          node ?? context.sourceFile,
          [],
        ),
        "option_value",
      );
      const value: RustExpr = { kind: "path", path: valueName };
      const elementSource: RustExpr = contract.element.sourceMode === "ref"
        ? { kind: "reference", expr: value }
        : value;
      const converted = lowerRustValueConversion(
        contract.element,
        elementSource,
        context,
        node,
      );
      if (converted === undefined) {
        return undefined;
      }
      const directMapper: RustExpr | undefined = converted.kind === "call" &&
          converted.args.length === 1 && converted.args[0]?.kind === "path" &&
          converted.args[0].path === valueName
        ? { kind: "path", path: converted.path }
        : undefined;
      const mapped: RustExpr = {
        kind: "method-call",
        receiver: source,
        method: "map",
        args: [directMapper ?? {
          kind: "closure",
          params: [{ name: valueName, byRefCopy: false }],
          body: converted,
        }],
      };
      return contract.element.fallible
        ? { kind: "method-call", receiver: mapped, method: "transpose", args: [] }
        : mapped;
    }
  }
}

function providerConstantExpression(argument: RustProviderConstantArgument): RustExpr {
  switch (argument.kind) {
    case "integer":
      return { kind: "int-literal", text: String(argument.value) };
    case "float64":
      return { kind: "float-literal", text: rustFloat64ConstantText(argument.value) };
    case "string":
      return { kind: "str-literal", value: argument.value };
    case "boolean":
      return { kind: "bool-literal", value: argument.value };
    case "none":
      return { kind: "none" };
  }
}

function rustFloat64ConstantText(value: number): string {
  if (Object.is(value, -0)) {
    return "-0.0";
  }
  const text = String(value);
  return /[.eE]/u.test(text) ? text : `${text}.0`;
}

function planProviderOperationExpression(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  explicitOverrides?: RustFinalizedInputPlanOverrides,
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
  const overrides = mergeRustFinalizedInputOverrides(
    locationScope.kind === "selected" ? locationScope.overrides : undefined,
    explicitOverrides,
    operationNode,
    context,
  );
  if (overrides === false) {
    return undefined;
  }
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
  const receiverMode = fact.abi.targetReceiver.kind === "input"
    ? fact.abi.targetReceiver.input.mode
    : undefined;
  const targetTypeArguments = fact.abi.targetTypeArguments.map((carrier) =>
    rustTypeFromCarrierInContext(carrier, context));
  if (targetTypeArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-target-type-arguments",
      "Provider operation target type arguments do not have exact Rust target types.",
    ));
    return undefined;
  }
  const concreteTargetTypeArguments = targetTypeArguments.length === 0
    ? undefined
    : targetTypeArguments as readonly RustType[];
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
      return scoped({
        kind: "method-call",
        receiver: typedReceiver,
        method: form.name,
        args,
        ...(concreteTargetTypeArguments === undefined ? {} : { typeArguments: concreteTargetTypeArguments }),
      });
    }
    case "call": {
      registerAliasFromPath(context, form.path);
      return scoped(applyProviderOperationChain({
        kind: "call",
        path: form.path,
        args,
        ...(concreteTargetTypeArguments === undefined ? {} : { typeArguments: concreteTargetTypeArguments }),
      }, form.chain));
    }
    case "call-c-variadic":
      registerAliasFromPath(context, form.path);
      return scoped({
        kind: "call",
        path: form.path,
        args,
        ...(concreteTargetTypeArguments === undefined ? {} : { typeArguments: concreteTargetTypeArguments }),
      });
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
    case "static": {
      registerAliasFromPath(context, form.path);
      return scoped(args.length === 0 ? { kind: "path", path: form.path } : undefined);
    }
    case "method":
    case "arg-receiver-method":
    case "receiver-value-array":
    case "receiver-tagged-array":
      return scoped(receiver === undefined
        ? undefined
        : {
            kind: "method-call",
            receiver,
            method: form.name,
            args,
            ...(concreteTargetTypeArguments === undefined ? {} : { typeArguments: concreteTargetTypeArguments }),
            ...(receiverMode === undefined ? {} : { receiverMode }),
          });
    case "receiver-method":
      return receiver === undefined
        ? undefined
        : scoped(applyProviderOperationChain(
            {
              kind: "method-call",
              receiver,
              method: form.name,
              args,
              ...(concreteTargetTypeArguments === undefined ? {} : { typeArguments: concreteTargetTypeArguments }),
              ...(receiverMode === undefined ? {} : { receiverMode }),
            },
            form.chain,
          ));
    case "field": {
      if (receiver === undefined || args.length !== 0) {
        return undefined;
      }
      const field: RustExpr = { kind: "field", receiver, name: form.name };
      if (isRustCopyCarrier(fact.resultCarrier)) {
        return scoped(field);
      }
      if (!rustCarrierSupportsClone(fact.resultCarrier)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, operationNode),
          "rust.backend.provider-field-read-ownership",
          "A provider field read requires an exact Copy or Clone result-carrier contract.",
        ));
        return undefined;
      }
      return scoped({ kind: "method-call", receiver: field, method: "clone", args: [] });
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
    case "trait-call": {
      const owner = rustTypeFromCarrierInContext(form.owner, context);
      const traitTypeArguments = form.traitTypeArguments.map((argument) =>
        rustTypeFromCarrierInContext(argument, context));
      if (owner === undefined || traitTypeArguments.some((argument) => argument === undefined)) {
        return undefined;
      }
      registerAliasFromPath(context, form.traitPath);
      return scoped({
        kind: "associated-call",
        owner,
        trait: {
          kind: "named",
          path: form.traitPath,
          ...(traitTypeArguments.length === 0
            ? {}
            : { typeArguments: traitTypeArguments as readonly RustType[] }),
        },
        method: form.method,
        args,
        ...(concreteTargetTypeArguments === undefined ? {} : { typeArguments: concreteTargetTypeArguments }),
      });
    }
    case "trait-associated-value": {
      const owner = rustTypeFromCarrierInContext(form.owner, context);
      const traitTypeArguments = form.traitTypeArguments.map((argument) =>
        rustTypeFromCarrierInContext(argument, context));
      if (owner === undefined || traitTypeArguments.some((argument) => argument === undefined) || args.length !== 0) {
        return undefined;
      }
      registerAliasFromPath(context, form.traitPath);
      return scoped({
        kind: "associated-value",
        owner,
        trait: {
          kind: "named",
          path: form.traitPath,
          ...(traitTypeArguments.length === 0
            ? {}
            : { typeArguments: traitTypeArguments as readonly RustType[] }),
        },
        name: form.name,
      });
    }
  }
}

function mergeRustFinalizedInputOverrides(
  left: RustFinalizedInputPlanOverrides | undefined,
  right: RustFinalizedInputPlanOverrides | undefined,
  operationNode: Node,
  context: RustPlanContext,
): RustFinalizedInputPlanOverrides | undefined | false {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  const sourceValues = new Map(left.sourceValues);
  const inputs = new Map(left.inputs);
  if ([...right.sourceValues.keys()].some((node) => sourceValues.has(node)) ||
    [...right.inputs.keys()].some((input) => inputs.has(input))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-input-override-conflict",
      "One finalized provider input cannot be owned by two Rust evaluation regions.",
    ));
    return false;
  }
  for (const [node, value] of right.sourceValues) {
    sourceValues.set(node, value);
  }
  for (const [input, value] of right.inputs) {
    inputs.set(input, value);
  }
  return { sourceValues, inputs };
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
    if (fact.abi.effects.errorBoundary === "none") {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.provider-error-boundary",
        "A finalized fallible Rust operation requires one exact error boundary.",
      ));
      return undefined;
    }
    raw = applyRustErrorBoundary(raw, fact.abi.effects.errorBoundary, context.errorDomain);
  }
  if (fact.abi.result.kind === "async") {
    return raw;
  }
  const converted = applyFinalizedValueConversion(
    context,
    raw,
    fact.abi.result.conversion,
    node,
    "operation-result",
  );
  return converted === undefined || !isRustNeverCarrier(fact.resultCarrier)
    ? converted
    : rustBottomExpression(converted);
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
  if (isRustFinalizedTaggedArrayInput(input)) {
    const elements: RustExpr[] = [];
    for (const element of input.elements) {
      const planned = planFinalizedSourceInput(
        context,
        element.input,
        receiverNode,
        argumentNodes,
        operationNode,
        "target-argument",
        overrides,
      );
      if (planned === undefined) {
        return undefined;
      }
      registerAliasFromPath(context, element.constructorPath);
      elements.push({ kind: "call", path: element.constructorPath, args: [planned] });
    }
    return { kind: "slice-literal", elements };
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
      const asTargetElement = element.parameterCarrier.kind === "reference" &&
        element.parameterCarrier.referent.kind === "target-named" &&
        element.parameterCarrier.referent.id === "rust.std.String"
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
  const expressionOverride = context.expressionOverrides?.get(sourceNode);
  const sourceCarrier = expressionOverride?.carrier ??
    context.input.facts.getRuntimeCarrierFact(sourceNode)?.carrier;
  const convertedCarrier = expressionOverride === undefined
    ? rustValueCarrierTransitionTarget(context.input.facts, sourceNode)
    : undefined;
  if (sourceCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-source-carrier",
      "Finalized Rust operation input has no independent source carrier fact.",
    ));
    return undefined;
  }
  const directCarrierMatch = rustFinalizedCarrierTransitionMatches(
    sourceCarrier,
    convertedCarrier,
    input.sourceCarrier,
  );
  if (!directCarrierMatch && convertedCarrier !== undefined) {
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
  const directStorage = expressionOverride?.valueForm === "storage" &&
      input.conversion.kind === "identity" &&
      (position === "target-receiver" || input.mode !== "value")
    ? expressionOverride.expression
    : undefined;
  const rawExpression = input.conversion.kind === "identity" &&
      (position === "target-receiver" || input.mode !== "value")
    ? directStorage ?? planRustNonConsumingValue(sourceNode, plannedExpression, context)
    : plannedExpression;
  if (!directCarrierMatch) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-flow-read",
      "Finalized Rust operation input requires a missing exact source-value transition.",
    ));
    return undefined;
  }
  const converted = applyFinalizedValueConversion(context, rawExpression, input.conversion, sourceNode, "source-input");
  return converted === undefined
    ? undefined
    : position === "target-receiver"
      ? converted
      : applyFinalizedArgumentMode(
          converted,
          input,
          context.input.facts.getFact(sourceNode, rustSourceParameterAbiFactKey),
          expressionOverride?.valueForm === "shared-reference",
        );
}

function applyFinalizedArgumentMode(
  expression: RustExpr,
  input: RustFinalizedSourceInput,
  sourceParameterAbi: import("../../source/rust-facts/keys.js").RustSourceParameterAbiFact | undefined,
  sourceIsSharedReference: boolean,
): RustExpr {
  if (input.mode === "value") {
    return expression;
  }
  if (sourceParameterAbi?.mode === input.mode &&
    rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, input.parameterCarrier)) {
    return expression;
  }
  if (sourceIsSharedReference && input.mode === "ref") {
    return expression;
  }
  if (input.mode === "mut-ref") {
    return mutRefShape(expression);
  }
  const borrowedString = rustBorrowedStringView(expression);
  if (borrowedString !== expression) {
    return borrowedString;
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
  return planOptionalChainExpression(
    node,
    context,
    "method",
    (innerContext) => planCallExpressionInner(node, innerContext),
  );
}

function planCallExpressionInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const { ast } = context.input;
  const fact = rustOperationFact(node, context);
  const callCarrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const innerResultCarrier = fact?.kind === "source-call" ||
      fact?.kind === "provider-operation" ||
      fact?.kind === "object-shape-projection" ||
      fact?.kind === "default-value" ||
      fact?.kind === "typed-location"
    ? fact.resultCarrier
    : undefined;
  const selectedResultCarrier = innerResultCarrier === undefined
    ? undefined
    : effectiveMemberResultCarrier(node, innerResultCarrier, context);
  if (innerResultCarrier !== undefined && selectedResultCarrier === undefined) {
    return undefined;
  }
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
    const [argumentNode] = context.input.ast.arguments(node);
    return fact.state === "moved" && argumentNode !== undefined
      ? planRustNonConsumingValue(argumentNode, argument!, context)
      : argument;
  }
  if (fact !== undefined && fact.kind === "object-shape-projection") {
    return planObjectShapeProjectionCall(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "default-value") {
    return planRustDefaultValueCall(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "source-call") {
    const argumentPlan = planRustSourceCallArgumentEvaluation(
      node,
      fact,
      context,
    );
    if (argumentPlan === undefined) {
      return undefined;
    }
    const planned = planSelectedSourceCall(
      node,
      callee,
      argumentPlan.arguments,
      fact,
      context,
    );
    return planned === undefined || argumentPlan.bindings.length === 0
      ? planned
      : {
          kind: "block",
          bindings: argumentPlan.bindings,
          value: planned,
        };
  }
  if (fact !== undefined && fact.kind === "provider-operation") {
    const superConstruction = fact.abi.operationKind === "constructor" &&
      callee !== undefined && ast.kindName(callee) === "KindSuperKeyword";
    if (fact.abi.operationKind !== "method" && !superConstruction) {
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

function planRustDefaultValueCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "default-value" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceArguments = context.input.ast.arguments(node);
  const selected = context.input.facts.getSelectedTargetCall(node);
  const operation = context.input.facts.getSelectedTargetOperation(node);
  if (!isDenseDataArray(sourceArguments) || sourceArguments.length !== 0 ||
    selected === undefined || selected.member.id !== fact.operationId ||
    selected.member.kind !== "method" || selected.member.static !== true ||
    selected.member.parameters.length !== 0 || selected.member.returnType === undefined ||
    !rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) ||
    selected.member.typeParameters?.length !== 1 ||
    selected.targetTypeArguments?.length !== 1 ||
    !rustTargetTypeRefEquals(selected.targetTypeArguments[0], fact.resultCarrier) ||
    operation === undefined || operation.operationId !== fact.operationId ||
    operation.operationKind !== "method" || operation.targetOperation !== "Default::default" ||
    operation.resultType === undefined ||
    !rustTargetTypeRefEquals(operation.resultType, fact.resultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.default-value-selected-signature",
      "defaultValue<T>() conflicts with its finalized zero-argument Rust Default contract.",
    ));
    return undefined;
  }
  if (!requireRustDefaultValueCarrier(fact.resultCarrier, node, context)) {
    return undefined;
  }
  const owner = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  if (owner === undefined) {
    return undefined;
  }
  return {
    kind: "associated-call",
    owner,
    trait: { kind: "named", path: "Default" },
    method: "default",
    args: [],
  };
}

function planObjectShapeProjectionCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "object-shape-projection" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceArguments = context.input.ast.arguments(node);
  const staticCall = fact.sourceValueOrigin.kind === "argument";
  if (
    staticCall &&
    sourceArguments[fact.sourceValueOrigin.index] !== fact.sourceValue
  ) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-source",
      "Closed Object projection source argument conflicts with its finalized origin.",
    ));
    return undefined;
  }
  const expectedParameterCarriers = staticCall
    ? fact.projection === "has-own"
      ? [fact.sourceValueCarrier, rustStringTargetType()]
      : [fact.sourceValueCarrier]
    : fact.projection === "has-own"
      ? [rustStringTargetType()]
      : [];
  const selected = context.input.facts.getSelectedTargetCall(node);
  if (selected === undefined || selected.member.id !== fact.operationId ||
    selected.member.kind !== "method" ||
    (selected.member.static === true) !== staticCall ||
    selected.member.returnType === undefined ||
    !rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) ||
    selected.member.parameters.length !== expectedParameterCarriers.length ||
    !selected.member.parameters.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter.type, expectedParameterCarriers[index]) &&
      parameter.passingMode === (staticCall && index === 0 ? "borrow-shared" : "by-value")) ||
    (!staticCall && !rustTargetTypeRefEquals(
      selected.sourceSelectedReceiverCarrier,
      fact.sourceValueCarrier,
    ))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-selected-signature",
      "Closed Object projection conflicts with its TSTS-selected target member contract.",
    ));
    return undefined;
  }
  if (!isDenseDataArray(sourceArguments) || sourceArguments.some((argument) => argument === undefined) ||
    sourceArguments.length !== expectedParameterCarriers.length ||
    sourceArguments.some((argument, index) => {
      const passing = context.input.facts.getFact(argument!, rustArgumentPassingKey);
      return passing?.mode !== (staticCall && index === 0 ? "borrow-shared" : "by-value");
    })) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-arguments",
      "Closed Object projection source arguments conflict with their finalized passing contracts.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-shape-projection-name-state",
      "Closed Object projection requires the compilation-owned synthetic-name state.",
    ));
    return undefined;
  }
  const plannedSourceValue = planExpression(fact.sourceValue, context);
  if (plannedSourceValue === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    fact.projection === "values" || fact.projection === "entries"
      ? "object_projection_value"
      : "_object_projection_value",
  );
  const bindings: Extract<RustExpr, { readonly kind: "block" }>["bindings"][number][] = [{
    name: receiverName,
    value: planRustSharedReceiver(fact.sourceValue, plannedSourceValue, context),
  }];
  let keyName: string | undefined;
  if (fact.keyExpression !== undefined) {
    const plannedKey = planExpression(fact.keyExpression, context);
    if (plannedKey === undefined) {
      return undefined;
    }
    keyName = allocateRustSyntheticName(
      context.syntheticNames,
      "object_projection_key",
    );
    bindings.push({ name: keyName, value: plannedKey });
  }
  const receiver: RustExpr = { kind: "path", path: receiverName };
  let value: RustExpr | undefined;
  switch (fact.projection) {
    case "keys":
      value = rustObjectProjectionArray(
        fact.fields.map((field) => ({
          kind: "string-literal" as const,
          value: field.sourceName,
        })),
        context,
      );
      break;
    case "values":
    case "entries": {
      const projected: RustExpr[] = [];
      for (const field of fact.fields) {
        const stored = readRustStoredObjectField(
          fact.storage,
          fact.sourceValueCarrier,
          receiver,
          field.storageIndex,
          field.valueCarrier,
          context,
        );
        const converted = stored === undefined
          ? undefined
          : applyRustValueConversion(
              context,
              stored,
              field.conversion,
              undefined,
              false,
            );
        if (converted === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.object-shape-projection-field",
            `Closed Object projection member '${field.sourceName}' has no exact stored-field read and conversion.`,
          ));
          return undefined;
        }
        projected.push(fact.projection === "values"
          ? converted
          : {
              kind: "tuple-literal",
              elements: [
                { kind: "string-literal", value: field.sourceName },
                converted,
              ],
            });
      }
      value = rustObjectProjectionArray(projected, context);
      break;
    }
    case "has-own":
      if (keyName === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.object-shape-projection-key",
          "Closed Object.hasOwn projection has no finalized key expression.",
        ));
        return undefined;
      }
      const comparisons = fact.fields.map<RustExpr>((field) => ({
        kind: "binary",
        operator: "==",
        left: {
          kind: "method-call",
          receiver: { kind: "path", path: keyName! },
          method: "as_str",
          args: [],
        },
        right: { kind: "str-literal", value: field.sourceName },
      }));
      value = comparisons.length === 0
        ? { kind: "bool-literal", value: false }
        : comparisons.slice(1).reduce<RustExpr>(
        (left, right) => ({
          kind: "binary",
          operator: "||",
          left,
          right,
        }),
        comparisons[0]!,
      );
      break;
  }
  return value === undefined
    ? undefined
    : { kind: "block", bindings, value };
}

function rustObjectProjectionArray(
  elements: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr {
  context.usedAliases?.add("js_abi");
  return {
    kind: "call",
    path: "js_abi::JsArray::from_dense",
    args: [{ kind: "vec-literal", elements }],
  };
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
  const callableCarrier = fact.target.form === "callable"
    ? fact.target.carrier
    : fact.target.form === "structural-method"
      ? fact.target.callableCarrier
      : undefined;
  return isAsync
    ? effects.awaiting !== "not-applicable" &&
      (callableCarrier === undefined || callableCarrier.kind === "function-pointer" ||
        effects.invocation === "fallible")
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
  const shaped = shapeRustSourceCallParameters(
    argumentNodes,
    args,
    fact,
    context,
  );
  if (shaped === undefined) {
    return undefined;
  }
  const sourceTypeArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const targetTypeArgumentCarriers = (fact.targetTypeArguments ?? []).map((argument) =>
    context.typeParameterSubstitutions === undefined
      ? argument
      : substituteRustTargetTypeParameters(
          argument,
          context.typeParameterSubstitutions,
        ));
  if (sourceTypeArguments.length !== targetTypeArgumentCarriers.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-type-arguments",
      "Selected project-source call has inconsistent source and target type-argument evidence.",
    ));
    return undefined;
  }
  const targetTypeArguments = targetTypeArgumentCarriers.map((carrier) =>
    rustTypeFromCarrierInContext(carrier, context));
  if (targetTypeArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-call-type-arguments",
      "Selected project-source call type arguments do not have exact Rust target types.",
    ));
    return undefined;
  }
  const selectedDeclaration = selected.sourceDeclaration;
  const requiresCallableSpecialization = selectedDeclaration !== undefined &&
    context.input.sourceCallableSpecializations.requiresSpecialization(
      selectedDeclaration,
    );
  const callableSpecialization = requiresCallableSpecialization && selectedDeclaration !== undefined
    ? context.input.sourceCallableSpecializations.variantForCall(
        selectedDeclaration,
        targetTypeArgumentCarriers,
      )
    : undefined;
  if (requiresCallableSpecialization && callableSpecialization === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-callable-specialization",
      "Selected project-source call has no exact finite Rust callable specialization.",
    ));
    return undefined;
  }
  const callTypeArguments = targetTypeArguments.length === 0 ||
      callableSpecialization !== undefined
    ? undefined
    : targetTypeArguments as readonly RustType[];

  let planned: RustExpr | undefined;
  switch (fact.target.form) {
    case "function": {
      const moduleName = context.moduleNameByFileName.get(fact.target.fileName);
      const targetName = callableSpecialization?.targetName ?? fact.target.name;
      if (moduleName === undefined || !isValidRustIdentifier(targetName)) {
        break;
      }
      planned = {
        kind: "call",
        path: moduleName === context.moduleName
          ? targetName
          : `crate::${moduleName}::${targetName}`,
        args: shaped,
        ...(callTypeArguments === undefined ? {} : { typeArguments: callTypeArguments }),
      };
      break;
    }
    case "method": {
      const targetName = fact.target.dispatch === undefined
        ? callableSpecialization?.targetName ?? fact.target.name
        : fact.target.name;
      if (!isValidRustIdentifier(targetName)) {
        break;
      }
      const receiverNode = callee !== undefined && context.input.ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(context.input.ast, callee)
        : undefined;
      if (fact.target.dispatch !== undefined) {
        const dispatchDeclaration = selected.sourceDeclaration;
        const dispatchVariant = dispatchDeclaration === undefined
          ? undefined
          : context.input.projectMethodDispatch.variantForMember(
              dispatchDeclaration,
              targetTypeArgumentCarriers,
            );
        if (dispatchVariant === undefined) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, node),
            "rust.backend.project-method-specialization",
            "Selected polymorphic project call has no exact finalized Rust dispatch specialization.",
          ));
          break;
        }
        const dispatchReceiver = fact.target.dispatch.selected === "exact"
          ? context.projectDispatchRoot
          : receiverNode === undefined
            ? undefined
            : planExpression(receiverNode, context);
        if (dispatchReceiver !== undefined) {
          if (fact.target.dispatch.selected === "exact") {
            const trait = rustProjectDispatchTraitType(
              fact.target.dispatch.ownerCarrier,
              context,
            );
            if (trait !== undefined) {
              planned = {
                kind: "associated-call",
                owner: { kind: "named", path: "Self" },
                trait,
                method: dispatchVariant.exactSlot,
                args: [{
                  kind: "method-call",
                  receiver: dispatchReceiver,
                  method: "clone",
                  args: [],
                }, ...shaped],
              };
            }
          } else {
            if (context.syntheticNames === undefined) {
              context.diagnostics.push(missingFactDiagnostic(
                diagnosticInput(context, node),
                "rust.backend.project-dispatch-temporary",
                "Project method dispatch requires a finalized hygienic-name scope.",
              ));
              break;
            }
            const receiverName = allocateRustSyntheticName(
              context.syntheticNames,
              "dispatch_receiver",
            );
            const root = {
                kind: "field" as const,
                receiver: { kind: "path" as const, path: receiverName },
                name: rustProjectObjectDispatchField,
              };
            planned = {
              kind: "block",
              bindings: [{ name: receiverName, value: dispatchReceiver }],
              value: {
                kind: "method-call",
                receiver: {
                  kind: "method-call",
                  receiver: root,
                  method: "clone",
                  args: [],
                },
                method: dispatchVariant.virtualSlot,
                args: shaped,
              },
            };
          }
        }
        break;
      }
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
          node,
          promoted.expression,
          targetName,
          shaped,
          context,
        );
        break;
      }
      const receiverOverride = receiverNode === undefined
        ? undefined
        : context.expressionOverrides?.get(receiverNode);
      const receiver = receiverOverride?.valueForm === "storage"
        ? receiverOverride.expression
        : receiverNode === undefined
          ? undefined
          : planExpression(receiverNode, context);
      if (receiver !== undefined) {
        planned = {
          kind: "method-call",
          receiver: receiverNode === undefined
            ? receiver
            : planRustNonConsumingValue(receiverNode, receiver, context),
          method: targetName,
          ...(callTypeArguments === undefined ? {} : { typeArguments: callTypeArguments }),
          args: shaped,
          receiverMode: fact.target.mutatesSelf ? "mut-ref" : "ref",
        };
      }
      break;
    }
    case "static-method": {
      const value = rustSourceTypeCarrierValue(fact.target.typeCarrier);
      const typePath = value === undefined ? undefined : sourceTypePath(context, value);
      const targetName = callableSpecialization?.targetName ?? fact.target.name;
      if (typePath !== undefined && isValidRustIdentifier(targetName)) {
        planned = {
          kind: "call",
          path: `${typePath}::${targetName}`,
          args: shaped,
          ...(callTypeArguments === undefined ? {} : { typeArguments: callTypeArguments }),
        };
      }
      break;
    }
    case "constructor": {
      const owner = rustTypeFromCarrierInContext(fact.target.typeCarrier, context);
      const targetName = fact.target.name;
      if (owner !== undefined && isValidRustIdentifier(targetName)) {
        planned = {
          kind: "associated-call",
          owner,
          method: targetName,
          args: shaped,
        };
      }
      break;
    }
    case "callable": {
      const plannedCallable = callee === undefined ? undefined : planExpression(callee, context);
      if (callee === undefined || plannedCallable === undefined) {
        break;
      }
      const callable = planRustNonConsumingValue(callee, plannedCallable, context);
      if (fact.target.carrier.kind === "function-pointer") {
        planned = { kind: "invoke", callee: callable, args: shaped };
        break;
      }
      const protocol = rustCallableProtocol(fact.target.carrier);
      if (protocol !== undefined && protocol.parameters.length === shaped.length) {
        planned = {
          kind: "method-call",
          receiver: callable,
          method: "call",
          args: [{ kind: "tuple-literal", elements: shaped }],
        };
      }
      break;
    }
    case "structural-method": {
      const receiverNode = callee !== undefined &&
          context.input.ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(context.input.ast, callee)
        : undefined;
      const receiver = receiverNode === undefined
        ? undefined
        : planExpression(receiverNode, context);
      const storageOverride = callee === undefined
        ? undefined
        : context.expressionOverrides?.get(callee);
      if (receiverNode !== undefined && receiver !== undefined) {
        planned = invokeRustStructuralObjectMethod(
          fact.target.receiverCarrier,
          receiver,
          fact.target.storageIndex,
          shaped,
          fact.resultCarrier,
          context,
          storageOverride === undefined
            ? undefined
            : {
                expression: storageOverride.expression,
                carrier: storageOverride.carrier,
              },
        );
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
    return isRustNeverCarrier(fact.resultCarrier) ? rustBottomExpression(planned) : planned;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.call",
      "Fallible calls require a fallible lowering context (a throwing function or a try block).",
    ));
    return undefined;
  }
  const propagated: RustExpr = {
    kind: "try",
    expr: planned,
    errorDomain: context.errorDomain,
  };
  return isRustNeverCarrier(fact.resultCarrier)
    ? rustBottomAfterEffect(propagated, "fallible never call returned")
    : propagated;
}

function shapeRustSourceCallParameters(
  argumentNodes: readonly Node[],
  arguments_: readonly RustExpr[],
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  const shaped: RustExpr[] = [];
  for (const [parameterIndex, parameter] of fact.parameters.entries()) {
    if (parameter.form === "rest") {
      if (parameter.mode !== "value") {
        return undefined;
      }
      const sequenceInputs = parameter.inputs.filter((input) =>
        input.sourceForm === "spread-sequence");
      if (sequenceInputs.length > 0) {
        const composed = shapeRustRestSequenceInputs(
          parameterIndex,
          parameter,
          argumentNodes,
          arguments_,
          context,
        );
        if (composed === undefined) {
          return undefined;
        }
        shaped.push(composed);
        continue;
      }
      const elements: RustExpr[] = [];
      for (const input of parameter.inputs) {
        const element = shapeRustSourceCallInput(
          parameterIndex,
          parameter,
          input,
          argumentNodes,
          arguments_,
          context,
        );
        if (element === undefined) {
          return undefined;
        }
        elements.push(element);
      }
      shaped.push({ kind: "vec-literal", elements });
      continue;
    }
    const input = parameter.inputs[0];
    if (input === undefined) {
      if (parameter.form !== "optional" && parameter.form !== "default") {
        return undefined;
      }
      shaped.push({ kind: "none" });
      continue;
    }
    if (parameter.inputs.length !== 1) {
      return undefined;
    }
    const value = shapeRustSourceCallInput(
      parameterIndex,
      parameter,
      input,
      argumentNodes,
      arguments_,
      context,
    );
    if (value === undefined) {
      return undefined;
    }
    shaped.push(value);
  }
  return shaped;
}

function shapeRustRestSequenceInputs(
  parameterIndex: number,
  parameter: import("../../source/rust-facts/keys.js").RustSourceCallParameterPlan,
  argumentNodes: readonly Node[],
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  if (parameter.inputs.length === 1) {
    return shapeRustSourceCallInput(
      parameterIndex,
      parameter,
      parameter.inputs[0]!,
      argumentNodes,
      arguments_,
      context,
    );
  }
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const collectionName = allocateRustSyntheticName(
    context.syntheticNames,
    "spread_rest",
  );
  const collection: RustExpr = { kind: "path", path: collectionName };
  const effects: RustExpr[] = [];
  for (const input of parameter.inputs) {
    const value = shapeRustSourceCallInput(
      parameterIndex,
      parameter,
      input,
      argumentNodes,
      arguments_,
      context,
    );
    if (value === undefined) {
      return undefined;
    }
    effects.push({
      kind: "method-call",
      receiver: collection,
      method: input.sourceForm === "spread-sequence"
        ? rustVecRestAssembly.appendSequenceMethod
        : rustVecRestAssembly.appendElementMethod,
      args: [value],
    });
  }
  let value: RustExpr = collection;
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    value = {
      kind: "evaluate-then",
      effect: effects[index]!,
      discard: "unit",
      value,
    };
  }
  return {
    kind: "block",
    bindings: [{
      name: collectionName,
      mutable: true,
      value: { kind: "vec-literal", elements: [] },
    }],
    value,
  };
}

function planRustSourceCallArgumentEvaluation(
  call: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext,
): {
  readonly arguments: readonly RustExpr[];
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
} | undefined {
  const rawArguments = context.input.ast.arguments(call);
  if (!isDenseDataArray(rawArguments) || rawArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-arguments",
      "Selected project-source call contains an undefined or non-data argument slot.",
    ));
    return undefined;
  }
  const argumentNodes = rawArguments as readonly Node[];
  const hasSpread = fact.parameters.some((parameter) =>
    parameter.inputs.some((input) => input.sourceForm !== "value"));
  const planned = argumentNodes.map((argument) => {
    const source = context.input.ast.kindName(argument) === KindSpreadElement
      ? Node_Expression(context.input.ast, argument)
      : argument;
    return source === undefined ? undefined : planExpression(source, context);
  });
  if (planned.some((argument) => argument === undefined)) {
    return undefined;
  }
  if (!hasSpread) {
    return {
      arguments: planned as readonly RustExpr[],
      bindings: [],
    };
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-spread-names",
      "Project-source spread evaluation requires one finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const bindings = (planned as readonly RustExpr[]).map((value) => ({
    name: allocateRustSyntheticName(context.syntheticNames!, "spread_argument"),
    value,
  }));
  return {
    arguments: bindings.map((binding) => ({ kind: "path", path: binding.name })),
    bindings,
  };
}

export function planRustSelectedSourceCallArguments(
  call: Node,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  const fact = context.input.facts.getFact(call, rustTargetOperationFactKey);
  const selected = context.input.facts.getSelectedTargetCall(call);
  if (fact?.kind !== "source-call" || selected === undefined ||
    !sourceCallSelectedMemberMatches(fact, selected) ||
    !applyRustSourceCallableRequirements(call, selected, fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-selected-arguments",
      "Project-source call arguments require one exact selected target call and finalized Rust ABI.",
    ));
    return undefined;
  }
  const rawArguments = context.input.ast.arguments(call);
  if (!isDenseDataArray(rawArguments) || rawArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, call),
      "rust.backend.source-call-selected-arguments",
      "Project-source call arguments contain an undefined or non-data slot.",
    ));
    return undefined;
  }
  const argumentNodes = rawArguments as readonly Node[];
  const arguments_ = planArguments(call, context);
  return arguments_ === undefined
    ? undefined
    : shapeRustSourceCallParameters(
        argumentNodes,
        arguments_,
        fact,
        context,
      );
}

function shapeRustSourceCallInput(
  parameterIndex: number,
  parameter: import("../../source/rust-facts/keys.js").RustSourceCallParameterPlan,
  input: import("../../source/rust-facts/keys.js").RustSourceCallParameterPlan["inputs"][number],
  argumentNodes: readonly Node[],
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  const argumentNode = argumentNodes[input.sourceArgumentIndex];
  const argument = arguments_[input.sourceArgumentIndex];
  if (argumentNode === undefined || argument === undefined) {
    return undefined;
  }
  const passing = context.input.facts.getArgumentPassingFact(argumentNode);
  const expectedPassing = rustArgumentPassingMode(parameter.mode);
  if (passing?.mode !== expectedPassing) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, argumentNode),
      "rust.backend.source-call-parameter-passing",
      `Project-source parameter ${parameterIndex} requires finalized passing mode '${expectedPassing}'.`,
    ));
    return undefined;
  }
  const sourceCarrier = context.input.facts.getRuntimeCarrierFact(argumentNode)?.carrier;
  const convertedCarrier = rustValueCarrierTransitionTarget(
    context.input.facts,
    argumentNode,
  );
  const selectedInput = selectRustSpreadSourceInput(
    input,
    sourceCarrier,
    convertedCarrier,
    argument,
  );
  if (selectedInput === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, argumentNode),
      "rust.backend.source-call-argument-carrier",
      `Project-source argument ${input.sourceArgumentIndex} conflicts with parameter ${parameterIndex}'s exact selected carrier.`,
    ));
    return undefined;
  }
  if (parameter.mode === "value") {
    return selectedInput;
  }
  if (parameter.parameterCarrier.kind !== "reference" ||
    !rustTargetTypeRefEquals(parameter.parameterCarrier.referent, input.carrier) &&
    !(isRustVecCarrier(input.carrier) &&
      rustTargetTypeRefEquals(
        rustSliceElementCarrier(parameter.parameterCarrier),
        input.carrier.element,
      ))) {
    return undefined;
  }
  const mutable = parameter.mode === "mut-ref";
  const sourceParameterAbi = context.input.facts.getFact(argumentNode, rustSourceParameterAbiFactKey);
  const nonConsumingInput = planRustNonConsumingValue(argumentNode, selectedInput, context);
  return sourceParameterAbi?.mode === parameter.mode &&
      rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, parameter.parameterCarrier)
    ? selectedInput
    : nonConsumingInput.kind === "string-literal" && !mutable
      ? { kind: "str-literal", value: nonConsumingInput.value }
      : mutable
        ? mutRefShape(nonConsumingInput)
        : { kind: "reference", expr: nonConsumingInput };
}

function selectRustSpreadSourceInput(
  input: import("../../source/rust-facts/keys.js").RustSourceCallParameterPlan["inputs"][number],
  sourceCarrier: TargetTypeRef | undefined,
  convertedCarrier: TargetTypeRef | undefined,
  sourceExpression: RustExpr,
): RustExpr | undefined {
  if (sourceCarrier === undefined) {
    return undefined;
  }
  if (input.sourceForm === "value" || input.sourceForm === "spread-sequence") {
    return rustFinalizedCarrierTransitionMatches(
      sourceCarrier,
      convertedCarrier,
      input.carrier,
    )
      ? sourceExpression
      : undefined;
  }
  if (convertedCarrier !== undefined || input.spreadElementIndex === undefined) {
    return undefined;
  }
  const element = rustSpreadElementCarrier(
    sourceCarrier,
    input.spreadElementIndex,
  );
  if (element === undefined || !rustTargetTypeRefEquals(element, input.carrier)) {
    return undefined;
  }
  const fixedArray = rustFixedArrayCarrierValue(sourceCarrier);
  const selected: RustExpr = fixedArray === undefined
    ? {
        kind: "field",
        receiver: sourceExpression,
        name: String(input.spreadElementIndex),
      }
    : {
        kind: "index",
        receiver: sourceExpression,
        index: { kind: "int-literal", text: String(input.spreadElementIndex) },
      };
  return fixedArray !== undefined && !isRustCopyCarrier(element)
    ? { kind: "method-call", receiver: selected, method: "clone", args: [] }
    : selected;
}

function rustSpreadElementCarrier(
  sourceCarrier: TargetTypeRef,
  index: number,
): TargetTypeRef | undefined {
  if (!Number.isSafeInteger(index) || index < 0) {
    return undefined;
  }
  if (sourceCarrier.kind === "tuple") {
    return sourceCarrier.elements[index];
  }
  const fixedArray = rustFixedArrayCarrierValue(sourceCarrier);
  return fixedArray !== undefined && index < fixedArray.length
    ? fixedArray.element
    : undefined;
}

function planPromotedSourceMethodCall(
  node: Node,
  location: RustExpr,
  method: string,
  arguments_: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr {
  const syntheticNames = context.syntheticNames ??
    createRustSyntheticNameState(context.input.ast, node, []);
  const locationName = allocateRustSyntheticName(syntheticNames, "location");
  const ownerName = allocateRustSyntheticName(syntheticNames, "location_value");
  const argumentBindings = arguments_.map((value, index) => ({
    name: allocateRustSyntheticName(syntheticNames, `location_argument_${index}`),
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
  const expectedTargetName = fact.target.form === "constructor"
    ? fact.target.name
    : fact.target.form === "callable" || fact.target.form === "structural-method"
      ? member.targetName
      : fact.target.form === "function"
        ? fact.target.selectedTargetName
        : fact.target.name;
  const selectedReturn = member.returnType === undefined
    ? undefined
    : substituteRustTargetTypeParameters(member.returnType, substitutions);
  const identityMatches = member.id === fact.operationId &&
    member.kind === expectedKind &&
    member.targetName === expectedTargetName &&
    selectedReturn !== undefined && rustTargetTypeRefEquals(selectedReturn, fact.resultCarrier);
  if (!identityMatches) {
    return false;
  }
  const callable = fact.target.form === "callable" || fact.target.form === "structural-method"
    ? rustCallableProtocol(fact.target.form === "callable"
        ? fact.target.carrier
        : fact.target.callableCarrier)
    : undefined;
  if (callable !== undefined) {
    return callable.parameters.length === fact.parameters.length &&
      callable.parameters.every((carrier, index) =>
        fact.parameters[index]?.mode === "value" &&
        rustTargetTypeRefEquals(carrier, fact.parameters[index]?.parameterCarrier));
  }
  return isDenseDataArray(member.parameters) && member.parameters.length === fact.parameters.length &&
    member.parameters.every((parameter, index) => {
      const mode = parameter.passingMode === "borrow-mut"
        ? "mut-ref"
        : parameter.passingMode === "borrow-shared"
          ? "ref"
          : "value";
      return rustTargetTypeRefEquals(
        substituteRustTargetTypeParameters(parameter.type, substitutions),
        fact.parameters[index]?.parameterCarrier,
      ) && mode === fact.parameters[index]?.mode;
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
    errorDomain: "runtime",
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

function effectiveMemberResultCarrier(
  node: Node,
  innerResultCarrier: TargetTypeRef,
  context: RustPlanContext,
): TargetTypeRef | undefined {
  const optional = context.input.facts.getFact(node, rustOptionalChainFactKey);
  if (optional === undefined) {
    return innerResultCarrier;
  }
  if (!rustTargetTypeRefEquals(optional.innerResultCarrier, innerResultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-chain-inner-result",
      "Optional-chain plan conflicts with the finalized selected member operation result.",
    ));
    return undefined;
  }
  return optional.resultCarrier;
}

function planOptionalChainExpression(
  node: Node,
  context: RustPlanContext,
  expectedKind: RustOptionalChainFact["operationKind"],
  planInner: (context: RustPlanContext) => RustExpr | undefined,
): RustExpr | undefined {
  const fact = context.input.facts.getFact(node, rustOptionalChainFactKey);
  if (fact === undefined) {
    return planInner(context);
  }
  const actualResultCarrier = expressionCarrier(node, context);
  const actualGuardCarrier = expressionCarrier(fact.guard, context);
  const structuralMethodGuard = exactOptionalStructuralMethodGuard(
    node,
    fact,
    context,
  );
  const sourceElement = rustOptionElementCarrier(fact.sourceGuardCarrier);
  const finalRelationshipValid = fact.lowering === "map"
    ? rustTargetTypeRefEquals(fact.resultCarrier, rustOptionTargetType(fact.innerResultCarrier))
    : rustOptionElementCarrier(fact.innerResultCarrier) !== undefined &&
      rustTargetTypeRefEquals(fact.resultCarrier, fact.innerResultCarrier);
  if (fact.expression !== node || fact.operationKind !== expectedKind ||
    actualResultCarrier === undefined || !rustTargetTypeRefEquals(actualResultCarrier, fact.resultCarrier) ||
    actualGuardCarrier === undefined || !rustTargetTypeRefEquals(actualGuardCarrier, fact.sourceGuardCarrier) ||
    sourceElement === undefined || !rustTargetTypeRefEquals(sourceElement, fact.selectedGuardCarrier) ||
    !finalRelationshipValid) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-chain-contract",
      "Optional-chain lowering conflicts with its exact guard, selected receiver, operation, or result carriers.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-chain-name-state",
      "Optional-chain lowering requires the compilation-owned synthetic-name state.",
    ));
    return undefined;
  }
  const guardFlowRead = context.input.facts.getFact(
    fact.guard,
    rustFlowReadProjectionFactKey,
  );
  if (structuralMethodGuard === undefined && guardFlowRead !== undefined &&
    (guardFlowRead.kind !== "option-value" ||
      !rustTargetTypeRefEquals(guardFlowRead.sourceCarrier, fact.sourceGuardCarrier) ||
      !rustTargetTypeRefEquals(guardFlowRead.selectedCarrier, fact.selectedGuardCarrier))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fact.guard),
      "rust.backend.optional-chain-flow-read",
      "Optional-chain lowering conflicts with the separately finalized receiver projection.",
    ));
    return undefined;
  }
  const plannedGuard = structuralMethodGuard === undefined
    ? planRawExpression(fact.guard, context, "value")
    : planOptionalStructuralMethodStorageGuard(structuralMethodGuard, context);
  if (plannedGuard === undefined) {
    return undefined;
  }
  const guard = planRustNonConsumingValue(fact.guard, plannedGuard, context);
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "optional_receiver");
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fact.guard, {
    expression: { kind: "path", path: receiverName },
    carrier: fact.selectedGuardCarrier,
    valueForm: "shared-reference",
  });
  const body = planInner({ ...context, expressionOverrides: overrides });
  if (body === undefined) {
    return undefined;
  }
  const sourceCallEffects = context.input.facts.getFact(node, rustSourceCallEffectsFactKey);
  const sourceAccessorEffects = context.input.facts.getFact(
    node,
    rustSourceAccessorEffectsFactKey,
  );
  const innerFallible = rustTargetOperationIsFallible(
    rustOperationFact(node, context),
    context.input.structuralShapes,
    context.input.projectFieldDispatch,
  ) ||
    sourceCallEffects?.invocation === "fallible" ||
    sourceAccessorEffects?.read === "fallible";
  if (innerFallible) {
    context.usedAliases?.add("rt");
  }
  const fallibleBody = applyRustFallibleResultExpression(body, {
    errorDomain: context.errorDomain,
    errorTypePath: "rt::TsonicError",
  });
  const mapped: RustExpr = {
    kind: "method-call",
    receiver: { kind: "method-call", receiver: guard, method: "as_ref", args: [] },
    method: innerFallible || fact.lowering === "map" ? "map" : "and_then",
    args: [{
      kind: "closure",
      params: [{ name: receiverName, byRefCopy: false }],
      body: innerFallible ? fallibleBody : body,
    }],
  };
  if (!innerFallible) {
    return mapped;
  }
  const transposed: RustExpr = {
    kind: "try",
    errorDomain: context.errorDomain,
    expr: { kind: "method-call", receiver: mapped, method: "transpose", args: [] },
  };
  return fact.lowering === "and-then"
    ? { kind: "method-call", receiver: transposed, method: "flatten", args: [] }
    : transposed;
}

interface RustOptionalStructuralMethodGuard {
  readonly receiverNode: Node;
  readonly receiverCarrier: TargetTypeRef;
  readonly storageIndex: number;
}

function exactOptionalStructuralMethodGuard(
  node: Node,
  fact: RustOptionalChainFact,
  context: RustPlanContext,
): RustOptionalStructuralMethodGuard | undefined {
  const operation = rustOperationFact(node, context);
  if (operation?.kind !== "source-call" || operation.target.form !== "structural-method") {
    return undefined;
  }
  const callee = context.input.ast.kindName(node) === KindCallExpression
    ? Node_Expression(context.input.ast, node)
    : undefined;
  const receiverNode = callee !== undefined &&
      context.input.ast.kindName(callee) === KindPropertyAccessExpression
    ? Node_Expression(context.input.ast, callee)
    : undefined;
  const field = context.input.structuralShapes.field(
    operation.target.receiverCarrier,
    operation.target.storageIndex,
  );
  if (callee !== fact.guard || field?.method !== true || field.presence !== "optional") {
    return undefined;
  }
  const storageCarrier = rustStructuralMethodStorageCarrier(
    operation.target.receiverCarrier,
    field.carrier,
    field.presence,
  );
  const selectedStorageCarrier = rustOptionElementCarrier(storageCarrier);
  if (receiverNode === undefined || storageCarrier === undefined ||
    selectedStorageCarrier === undefined ||
    !rustTargetTypeRefEquals(fact.sourceGuardCarrier, storageCarrier) ||
    !rustTargetTypeRefEquals(fact.selectedGuardCarrier, selectedStorageCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.optional-structural-method-guard",
      "Optional structural-method lowering conflicts with its exact receiver-bound callable storage contract.",
    ));
    return undefined;
  }
  return {
    receiverNode,
    receiverCarrier: operation.target.receiverCarrier,
    storageIndex: operation.target.storageIndex,
  };
}

function planOptionalStructuralMethodStorageGuard(
  guard: RustOptionalStructuralMethodGuard,
  context: RustPlanContext,
): RustExpr | undefined {
  const receiver = planExpression(guard.receiverNode, context);
  return receiver === undefined
    ? undefined
    : readRustStructuralObjectMethodStorage(
        guard.receiverCarrier,
        planRustNonConsumingValue(guard.receiverNode, receiver, context),
        guard.storageIndex,
        context,
      );
}

function planPropertyAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  return planOptionalChainExpression(
    node,
    context,
    "property",
    (innerContext) => planPropertyAccessInner(node, innerContext),
  );
}

function planPropertyAccessInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-method-property") {
    return planRustSourceMethodPropertyRead(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "source-accessor") {
    const read = fact.read;
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (read === undefined || resultCarrier === undefined ||
      !rustTargetTypeRefEquals(read.resultCarrier, fact.resultCarrier) ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-accessor-carrier")) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-accessor-read",
        "Project accessor read requires one exact getter and result carrier.",
      ));
      return undefined;
    }
    if (!sourceAccessorSelectedOperationMatches(node, fact, context)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-accessor-selected-evidence",
        "Project accessor read conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const planned = planRustSourceAccessorCall(node, fact, "read", [], context);
    return planned === undefined
      ? undefined
      : finishRustSourceAccessorCall(node, "read", planned, context);
  }
  if (fact !== undefined && fact.kind === "source-static-field") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-static-field-carrier")) {
      return undefined;
    }
    if (!sourceStaticFieldSelectedOperationMatches(node, fact, context)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-static-field-selected-evidence",
        "Project static-field read conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const value = readRustSourceStaticField(fact, context);
    if (value === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-static-field-storage",
        "Project static field has no exact generated Rust storage path.",
      ));
    }
    return value;
  }
  if (fact !== undefined && fact.kind === "source-field") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-field-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
        context.input.facts.getSelectedTargetProperty(node),
        fact.operationId,
        "property",
        resultCarrier,
      )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.source-field-selected-evidence",
        "Project-source field fact conflicts with the TSTS-selected property fact.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(context.input.ast, node);
    const plannedReceiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiverNode === undefined || plannedReceiver === undefined) {
      return undefined;
    }
    if (fact.dispatch === undefined) {
      return readRustStoredObjectField(
        fact.storage,
        fact.receiverCarrier,
        planRustNonConsumingValue(receiverNode, plannedReceiver, context),
        fact.storageIndex,
        fact.resultCarrier,
        context,
      );
    }
    if (context.syntheticNames === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-dispatch-temporary",
        "Project property dispatch requires a finalized hygienic-name scope.",
      ));
      return undefined;
    }
    const dispatchPlan = fact.declaration === undefined
      ? undefined
      : context.input.projectFieldDispatch.planFor(fact.declaration);
    if (dispatchPlan === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-field-dispatch-plan",
        "Project property dispatch has no exact finalized field-dispatch plan.",
      ));
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(
      context.syntheticNames,
      "dispatch_receiver",
    );
    return {
      kind: "block",
      bindings: [{
        name: receiverName,
        value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
      }],
      value: readRustProjectDispatchedField(
        { kind: "path", path: receiverName },
        fact.dispatch.read,
        {
          ...dispatchPlan.read,
          errorDomain: context.errorDomain,
        },
      ),
    };
  }
  if (fact !== undefined && fact.kind === "source-union-field") {
    return planRustSourceUnionFieldRead(node, fact, context);
  }
  if (fact !== undefined && fact.kind === "source-enum-member") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.enum-member-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetProperty(node),
      fact.operationId,
      "property",
      resultCarrier,
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
  const selectedResult = effectiveMemberResultCarrier(node, propertyResult, context);
  if (selectedResult === undefined ||
    !requireExpressionCarrier(node, selectedResult, context, "rust.backend.provider-property-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    selectedResult,
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

function planRustSourceMethodPropertyRead(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-method-property" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
  const callable = rustCallableProtocol(fact.callableCarrier);
  if (resultCarrier === undefined || callable === undefined ||
    !rustTargetTypeRefEquals(resultCarrier, fact.callableCarrier) ||
    !requireExpressionCarrier(
      node,
      resultCarrier,
      context,
      "rust.backend.source-method-property-carrier",
    ) || !selectedOperationMatches(
      context.input.facts.getSelectedTargetProperty(node),
      fact.operationId,
      "property",
      resultCarrier,
    )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-method-property-selected-evidence",
      "Project method-property read conflicts with its exact selected callable evidence.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, node);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  if (receiverNode === undefined || plannedReceiver === undefined ||
    context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-method-property-plan",
      "Project method-property read has no exact receiver, callable type, or dispatch identity.",
    ));
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_receiver",
  );
  const callableValue = planRustBoundProjectMethodCallable(
    fact.declaration,
    fact.receiverCarrier,
    { kind: "path", path: receiverName },
    fact.callableCarrier,
    context,
  );
  if (callableValue === undefined) {
    return undefined;
  }
  return {
    kind: "block",
    bindings: [{
      name: receiverName,
      value: plannedReceiver,
    }],
    value: callableValue,
  };
}

function planRustBoundProjectMethodCallable(
  declaration: Node,
  receiverCarrier: TargetTypeRef,
  receiver: RustExpr,
  callableCarrier: TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  const callable = rustCallableProtocol(callableCarrier);
  const callableType = rustTypeFromCarrierInContext(callableCarrier, context);
  const receiverDefinition = context.input.projectTypes.definitionForCarrier(receiverCarrier);
  const selectedImplementation = receiverDefinition === undefined
    ? undefined
    : context.input.projectTypes.memberImplementation(
        receiverDefinition,
        declaration,
      );
  const selectedDeclaration = selectedImplementation?.kind === "resolved"
    ? selectedImplementation.implementation.declaration
    : declaration;
  const variant = context.input.projectMethodDispatch.variantForMember(declaration, []);
  const implementation = context.input.source.navigation.callableImplementation(
    selectedDeclaration,
  );
  const implementationDeclaration = implementation.kind === "resolved"
    ? implementation.implementation.declaration
    : selectedDeclaration;
  const targetName = context.input.names.nameForDeclaration(implementationDeclaration) ??
    rustProjectCallableTargetName(implementationDeclaration, context.input);
  if (callable === undefined || callableType === undefined ||
    receiverDefinition === undefined || context.syntheticNames === undefined ||
    (context.input.projectTypes.isPolymorphic(receiverDefinition)
      ? variant === undefined
      : !isValidRustIdentifier(targetName ?? ""))) {
    return undefined;
  }
  const argumentsName = allocateRustSyntheticName(
    context.syntheticNames,
    "method_arguments",
  );
  const argumentsList = callable.parameters.map((_, index) => ({
    kind: "field" as const,
    receiver: { kind: "path" as const, path: argumentsName },
    name: String(index),
  }));
  const invocation: RustExpr = context.input.projectTypes.isPolymorphic(receiverDefinition)
    ? {
        kind: "method-call",
        receiver: {
          kind: "method-call",
          receiver: {
            kind: "field",
            receiver,
            name: rustProjectObjectDispatchField,
          },
          method: "clone",
          args: [],
        },
        method: variant!.virtualSlot,
        args: argumentsList,
      }
    : {
        kind: "method-call",
        receiver,
        method: targetName!,
        args: argumentsList,
      };
  const fallible = context.input.facts.getFact(
    implementationDeclaration,
    rustFallibleFactKey,
  ) !== undefined || context.input.facts.getFact(
    declaration,
    rustFallibleFactKey,
  ) !== undefined;
  context.usedAliases?.add("rt");
  return {
    kind: "associated-call",
    owner: callableType,
    method: "new",
    args: [{
      kind: "closure-block",
      params: [{ name: argumentsName, mutable: false }],
      move: true,
      async: false,
      body: {
        statements: [{
          kind: "tail",
          expr: fallible
            ? invocation
            : { kind: "call", path: "Ok", args: [invocation] },
        }],
      },
    }],
  };
}

function planRustSourceUnionFieldRead(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
  if (resultCarrier === undefined ||
    !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.source-union-field-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    resultCarrier,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-union-field-selected-evidence",
      "Source-union field fact conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, node);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  if (receiverNode === undefined || receiver === undefined) {
    return undefined;
  }
  return planRustSourceUnionFieldProjection(
    node,
    planRustNonConsumingValue(receiverNode, receiver, context),
    fact,
    context,
    (payload, field, variantIndex) => {
      return readRustStoredObjectField(
        field.storage,
        fact.variants[variantIndex]!.carrier,
        payload,
        field.storageIndex,
        fact.resultCarrier,
        context,
      );
    },
  );
}

export function sourceFieldSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceMethodPropertySelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-method-property" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceStaticFieldSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-static-field" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceAccessorSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function planRustSourceAccessorCall(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
  role: "read" | "write",
  args: readonly RustExpr[],
  context: RustPlanContext,
  receiverOverride?: RustExpr,
): RustExpr | undefined {
  const selected = role === "read" ? fact.read : fact.write;
  if (selected === undefined || args.length !== (role === "read" ? 0 : 1)) {
    return undefined;
  }
  if (fact.receiver.kind === "static") {
    const value = rustSourceTypeCarrierValue(fact.receiver.typeCarrier);
    const ownerPath = value === undefined ? undefined : sourceTypePath(context, value);
    return ownerPath === undefined
      ? undefined
      : { kind: "call", path: `${ownerPath}::${selected.method}`, args };
  }
  const receiverNode = Node_Expression(context.input.ast, node);
  const plannedReceiver = receiverOverride ?? (receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context));
  const receiver = receiverNode === undefined || plannedReceiver === undefined
    ? plannedReceiver
    : planRustNonConsumingValue(receiverNode, plannedReceiver, context);
  if (receiver === undefined) {
    return undefined;
  }
  if (fact.dispatch === undefined) {
    return { kind: "method-call", receiver, method: selected.method, args };
  }
  const receiverCarrier = receiverNode === undefined
    ? undefined
    : effectivePlannedExpressionCarrier(receiverNode, context);
  const owner = context.input.projectTypes.definitionContainingDeclaration(selected.declaration);
  const relationship = owner === undefined || receiverCarrier === undefined
    ? undefined
    : context.input.projectTypes.relationship(receiverCarrier, owner);
  if (relationship?.kind !== "related" ||
    !rustTargetTypeRefEquals(relationship.targetType, fact.dispatch.ownerCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.project-accessor-dispatch-receiver",
      "Project accessor dispatch conflicts with its exact finalized receiver relationship.",
    ));
    return undefined;
  }
  return {
    kind: "method-call",
    receiver: {
      kind: "method-call",
      receiver: {
        kind: "field",
        receiver,
        name: rustProjectObjectDispatchField,
      },
      method: "clone",
      args: [],
    },
    method: selected.method,
    args,
  };
}

export function finishRustSourceAccessorCall(
  node: Node,
  role: "read" | "write",
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const effects = context.input.facts.getFact(node, rustSourceAccessorEffectsFactKey);
  const effect = effects?.[role];
  if (effect === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.source-accessor-effects",
      "Project accessor operation requires finalized post-fixpoint effects.",
    ));
    return undefined;
  }
  if (effect === "infallible") {
    return expression;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.accessor",
      "Fallible accessor operations require a throwing function or try block.",
    ));
    return undefined;
  }
  return { kind: "try", expr: expression, errorDomain: context.errorDomain };
}

export function sourceUnionFieldSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.facts.getSelectedTargetProperty(node),
    fact.operationId,
    "property",
    fact.resultCarrier,
  );
}

export function sourceIndexSelectedOperationMatches(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperationMatches(
    context.input.facts.getSelectedTargetElementAccess(node),
    fact.operationId,
    "indexer",
    fact.resultCarrier,
  );
}

function planElementAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  return planOptionalChainExpression(
    node,
    context,
    "indexer",
    (innerContext) => planElementAccessInner(node, innerContext),
  );
}

function planElementAccessInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact !== undefined && fact.kind === "source-index-signature") {
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined || !requireExpressionCarrier(
      node,
      resultCarrier,
      context,
      "rust.backend.project-index-carrier",
    ) || !selectedOperationMatches(
      context.input.facts.getSelectedTargetElementAccess(node),
      fact.operationId,
      "indexer",
      resultCarrier,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-index-selected-evidence",
        "Project index access conflicts with the TSTS-selected index-signature fact.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(context.input.ast, node);
    const keyNode = ElementAccessExpression_ArgumentExpression(context.input.ast, node);
    const plannedReceiver = receiverNode === undefined
      ? undefined
      : planExpression(receiverNode, context);
    const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
    if (receiverNode === undefined || plannedReceiver === undefined || key === undefined ||
      context.syntheticNames === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_receiver");
    const keyName = allocateRustSyntheticName(context.syntheticNames, "index_key");
    return {
      kind: "block",
      bindings: [{
        name: receiverName,
        value: planRustSharedReceiver(receiverNode, plannedReceiver, context),
      }, {
        name: keyName,
        value: key,
      }],
      value: readRustProjectObjectIndex(
        { kind: "path", path: receiverName },
        fact.storageName,
        { kind: "path", path: keyName },
        resultCarrier,
      ),
    };
  }
  if (fact !== undefined && fact.kind === "fixed-index") {
    const optional = context.input.facts.getFact(node, rustOptionalChainFactKey);
    const innerResult = optional?.innerResultCarrier ?? expressionCarrier(node, context);
    const selectedResult = innerResult === undefined
      ? undefined
      : effectiveMemberResultCarrier(node, innerResult, context);
    if (selectedResult === undefined || !requireExpressionCarrier(
      node,
      selectedResult,
      context,
      "rust.backend.fixed-index-carrier",
    ) || !selectedOperationMatches(
      context.input.facts.getSelectedTargetElementAccess(node),
      fact.operationId,
      "indexer",
      selectedResult,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.fixed-index-selected-evidence",
        "Fixed-array index fact conflicts with the TSTS-selected element-access fact.",
      ));
      return undefined;
    }
    const receiverNode = Node_Expression(context.input.ast, node);
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    const indexNode = ElementAccessExpression_ArgumentExpression(context.input.ast, node);
    if (receiver === undefined || indexNode === undefined) {
      return undefined;
    }
    const effect = context.input.ast.kindName(indexNode) === KindNumericLiteral
      ? undefined
      : planExpression(indexNode, context);
    if (context.input.ast.kindName(indexNode) !== KindNumericLiteral && effect === undefined) {
      return undefined;
    }
    const value: RustExpr = {
      kind: "index",
      receiver,
      index: { kind: "int-literal", text: String(fact.index) },
    };
    return effect === undefined
      ? value
      : { kind: "evaluate-then", effect, discard: "value", value };
  }
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
    const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
    if (resultCarrier === undefined ||
      !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.tuple-index-carrier")) {
      return undefined;
    }
    if (!selectedOperationMatches(
      context.input.facts.getSelectedTargetElementAccess(node),
      fact.operationId,
      "indexer",
      resultCarrier,
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
  const selectedResult = effectiveMemberResultCarrier(node, elementResult, context);
  if (selectedResult === undefined ||
    !requireExpressionCarrier(node, selectedResult, context, "rust.backend.provider-indexer-carrier")) {
    return undefined;
  }
  if (!selectedOperationMatches(
    context.input.facts.getSelectedTargetElementAccess(node),
    fact.operationId,
    "indexer",
    selectedResult,
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
    const tupleCarrier = fact.resultCarrier.kind === "tuple"
      ? fact.resultCarrier
      : undefined;
    if (
      tupleCarrier === undefined ||
      elements.length + fact.omittedOptionalElementIndexes.length !==
        tupleCarrier.elements.length ||
      fact.omittedOptionalElementIndexes.some((index, omittedIndex) =>
        index !== elements.length + omittedIndex ||
        rustOptionElementCarrier(tupleCarrier.elements[index]) === undefined
      )
    ) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.tuple-optional-elements",
        "Tuple literal omission evidence conflicts with its exact finalized Rust tuple carrier.",
      ));
      return undefined;
    }
    for (const _index of fact.omittedOptionalElementIndexes) {
      elements.push({ kind: "none" });
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
  if (fact?.kind === "record-index-literal") {
    return planProjectIndexRecordLiteral(node, fact, context);
  }
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
  const value = fact.storage === "project-object"
    ? rustSourceTypeCarrierValue(fact.resultCarrier)
    : undefined;
  const typePath = value === undefined ? undefined : sourceTypePath(context, value);
  const stateType = fact.storage === "project-object"
    ? rustProjectStateType(fact.resultCarrier, context)
    : undefined;
  const projectDefinition = fact.storage === "project-object"
    ? context.input.projectTypes.definitionForCarrier(fact.resultCarrier)
    : undefined;
  const stateMarker = projectDefinition === undefined
    ? undefined
    : rustProjectStateMarker(projectDefinition, context);
  const statePath = stateType?.kind === "named" ? stateType.path : undefined;
  if (fact.storage === "project-object" &&
    (typePath === undefined || statePath === undefined)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Object literal shape does not resolve to a generated Rust struct.",
    ));
    return undefined;
  }
  const { ast } = context.input;
  const properties = ast.properties(node);
  if (context.syntheticNames === undefined || properties.length !== fact.contributions.length ||
    fact.contributions.some((contribution, index) => contribution.property !== properties[index]) ||
    new Set(fact.fields.map((field) => field.sourceName)).size !== fact.fields.length ||
    new Set(fact.fields.map((field) => field.storageIndex)).size !== fact.fields.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-fields",
      "Object literal syntax does not match its finalized ordered contribution fact.",
    ));
    return undefined;
  }
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
  }[] = [];
  const valuesByStorageIndex = new Map<number, RustExpr>();
  const accessorValuesByStorageIndex = new Map<number, {
    getter?: RustExpr;
    setter?: RustExpr;
  }>();
  const finalContributionByStorageIndex = new Map<number, number>();
  const finalContributionByMethod = new Map<Node, number>();
  fact.contributions.forEach((contribution, contributionIndex) => {
    if (contribution.kind === "property" || contribution.kind === "structural-method") {
      finalContributionByStorageIndex.set(
        contribution.targetStorageIndex,
        contributionIndex,
      );
      return;
    }
    if (contribution.kind === "method") {
      for (const declaration of contribution.contractDeclarations) {
        finalContributionByMethod.set(declaration, contributionIndex);
      }
      return;
    }
    if (contribution.kind === "accessor") {
      return;
    }
    for (const field of contribution.fields) {
      finalContributionByStorageIndex.set(field.targetStorageIndex, contributionIndex);
    }
    for (const method of contribution.methods) {
      finalContributionByMethod.set(method.contractDeclaration, contributionIndex);
    }
  });
  const requiresObjectLiteralImplementation =
    rustObjectLiteralRequiresDispatchImplementation(fact, context);
  const objectLiteralImplementation = requiresObjectLiteralImplementation
    ? context.objectLiteralImplementations?.forExpression(node)
    : undefined;
  if (requiresObjectLiteralImplementation && objectLiteralImplementation === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-literal-method-implementation",
      "Object literal methods require one exact finalized Rust dispatch implementation plan.",
    ));
    return undefined;
  }
  const methodValues = new Map<string, RustExpr>();
  for (const [contributionIndex, contribution] of fact.contributions.entries()) {
    if (contribution.kind === "property") {
      const nameNode = ast.name(contribution.property);
      const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
      const initializer = ObjectLiteralProperty_Value(ast, contribution.property);
      const planned = initializer === undefined ? undefined : planExpression(initializer, context);
      if (sourceName !== contribution.sourceName || planned === undefined) {
        return undefined;
      }
      const bindingName = allocateRustSyntheticName(
        context.syntheticNames,
        finalContributionByStorageIndex.get(contribution.targetStorageIndex) === contributionIndex
          ? `record_${contribution.sourceName}`
          : `_record_${contribution.sourceName}`,
      );
      bindings.push({ name: bindingName, value: planned });
      if (finalContributionByStorageIndex.get(contribution.targetStorageIndex) === contributionIndex) {
        valuesByStorageIndex.set(
          contribution.targetStorageIndex,
          { kind: "path", path: bindingName },
        );
      }
      continue;
    }
    if (contribution.kind === "structural-method") {
      const sourceNameNode = ast.name(contribution.property);
      const sourceName = sourceNameNode === undefined ? "" : ast.text(sourceNameNode);
      const planned = planExpression(contribution.expression, context);
      const field = fact.fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      if (sourceName !== contribution.sourceName || planned === undefined ||
        field?.method !== true) {
        return undefined;
      }
      const storageCarrier = rustStructuralMethodStorageCarrier(
        fact.resultCarrier,
        field.carrier,
        field.presence,
      );
      const rawStorageCarrier = field.presence === "optional"
        ? rustOptionElementCarrier(storageCarrier)
        : storageCarrier;
      if (rawStorageCarrier === undefined ||
        !rustTargetTypeRefEquals(
          expressionCarrier(contribution.expression, context),
          rawStorageCarrier,
        )) {
        return undefined;
      }
      const bindingName = allocateRustSyntheticName(
        context.syntheticNames,
        "record_method",
      );
      bindings.push({
        name: bindingName,
        value: field.presence === "optional"
          ? { kind: "call", path: "Some", args: [planned] }
          : planned,
      });
      valuesByStorageIndex.set(
        contribution.targetStorageIndex,
        { kind: "path", path: bindingName },
      );
      continue;
    }
    if (contribution.kind === "accessor") {
      const sourceNameNode = ast.name(contribution.property);
      const sourceName = sourceNameNode === undefined ? "" : ast.text(sourceNameNode);
      const planned = planExpression(contribution.property, context);
      const field = fact.fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      const plannedField = fact.storage === "object-handle"
        ? context.input.structuralShapes.field(
            fact.resultCarrier,
            contribution.targetStorageIndex,
          )
        : undefined;
      const plannedAccessor = fact.storage === "project-object"
        ? objectLiteralImplementation?.accessors.find((candidate) =>
            candidate.storageIndex === contribution.targetStorageIndex)
        : undefined;
      if (sourceName !== contribution.sourceName || planned === undefined ||
        field === undefined ||
        (fact.storage === "object-handle" && (
          plannedField?.storage !== "property" ||
          contribution.role === "set" &&
            plannedField.property?.setterTargetName === undefined
        )) ||
        (fact.storage === "project-object" && (
          plannedAccessor === undefined ||
          contribution.role === "set" && plannedAccessor.setter === undefined
        ))) {
        return undefined;
      }
      const bindingName = allocateRustSyntheticName(
        context.syntheticNames,
        contribution.role === "get" ? "record_getter" : "record_setter",
      );
      bindings.push({ name: bindingName, value: planned });
      const existing = accessorValuesByStorageIndex.get(
        contribution.targetStorageIndex,
      ) ?? {};
      if (existing[contribution.role === "get" ? "getter" : "setter"] !== undefined) {
        return undefined;
      }
      accessorValuesByStorageIndex.set(contribution.targetStorageIndex, {
        ...existing,
        [contribution.role === "get" ? "getter" : "setter"]: {
          kind: "path",
          path: bindingName,
        },
      });
      continue;
    }
    if (contribution.kind === "method") {
      const implementations = objectLiteralImplementation?.implementations.filter((implementation) =>
        implementation.kind === "authored" &&
          implementation.sourceCallable === contribution.expression) ?? [];
      if (implementations.length === 0) {
        return undefined;
      }
      for (const implementation of implementations) {
        if (implementation.kind !== "authored") {
          return undefined;
        }
        const closure = planExpression(contribution.expression, {
          ...context,
          typeParameterSubstitutions: new Map(implementation.typeParameterSubstitutions),
        });
        if (closure === undefined) {
          return undefined;
        }
        const bindingName = allocateRustSyntheticName(
          context.syntheticNames,
          "record_method",
        );
        const argumentsName = allocateRustSyntheticName(
          context.syntheticNames,
          "method_arguments",
        );
        const tupledClosure = tupleRustClosureArguments(
          closure,
          argumentsName,
          implementation.parameterCount + 1,
        );
        if (tupledClosure === undefined) {
          return undefined;
        }
        bindings.push({
          name: bindingName,
          value: {
            kind: "associated-call",
            owner: implementation.callableType,
            method: "new",
            args: [tupledClosure],
          },
        });
        methodValues.set(implementation.fieldName, { kind: "path", path: bindingName });
      }
      continue;
    }
    const spreadExpression = SpreadAssignment_Expression(ast, contribution.property);
    if (ast.kindName(contribution.property) !== KindSpreadAssignment ||
      spreadExpression !== contribution.expression) {
      return undefined;
    }
    const plannedSpread = planExpression(spreadExpression, context);
    if (plannedSpread === undefined) {
      return undefined;
    }
    const retainedFields = contribution.fields.filter((field) =>
      finalContributionByStorageIndex.get(field.targetStorageIndex) === contributionIndex);
    const retainedMethods = objectLiteralImplementation?.implementations.filter((implementation) =>
      implementation.kind === "spread" &&
        finalContributionByMethod.get(implementation.contractMethod) === contributionIndex) ?? [];
    const spreadName = allocateRustSyntheticName(
      context.syntheticNames,
      retainedFields.length === 0 && retainedMethods.length === 0
        ? "_record_spread"
        : "record_spread",
    );
    bindings.push({ name: spreadName, value: plannedSpread });
    for (const field of retainedFields) {
      const value = field.method === true
        ? contribution.sourceStorage === "object-handle"
          ? readRustStructuralObjectMethodStorage(
              contribution.sourceCarrier,
              { kind: "path", path: spreadName },
              field.sourceStorageIndex,
              context,
            )
          : undefined
        : readRustStoredObjectField(
            contribution.sourceStorage,
            contribution.sourceCarrier,
            { kind: "path", path: spreadName },
            field.sourceStorageIndex,
            field.carrier,
            context,
          );
      if (value === undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, contribution.property),
          "rust.backend.record-spread-projection",
          `Object spread field '${field.sourceName}' has no exact Rust storage projection.`,
        ));
        return undefined;
      }
      const fieldName = allocateRustSyntheticName(
        context.syntheticNames,
        `record_${field.sourceName}`,
      );
      bindings.push({ name: fieldName, value });
      valuesByStorageIndex.set(
        field.targetStorageIndex,
        { kind: "path", path: fieldName },
      );
    }
    for (const implementation of retainedMethods) {
      if (implementation.kind !== "spread") {
        return undefined;
      }
      const source = contribution.methods.find((method) =>
        method.contractDeclaration === implementation.contractMethod);
      if (source === undefined) {
        return undefined;
      }
      const receiverName = allocateRustSyntheticName(
        context.syntheticNames,
        "record_method_receiver",
      );
      bindings.push({
        name: receiverName,
        value: {
          kind: "method-call",
          receiver: { kind: "path", path: spreadName },
          method: "clone",
          args: [],
        },
      });
      const callableValue = planRustBoundProjectMethodCallable(
        implementation.contractMethod,
        contribution.sourceCarrier,
        { kind: "path", path: receiverName },
        source.callableCarrier,
        context,
      );
      if (callableValue === undefined) {
        return undefined;
      }
      const callableName = allocateRustSyntheticName(
        context.syntheticNames,
        "record_method",
      );
      bindings.push({ name: callableName, value: callableValue });
      methodValues.set(
        implementation.fieldName,
        { kind: "path", path: callableName },
      );
    }
  }
  const structuralInitializers: import("./project-object-storage.js")
    .RustStructuralObjectFieldInitializer[] = [];
  const projectFields: { name: string; value: RustExpr }[] = [];
  for (const field of [...fact.fields].sort((left, right) => left.storageIndex - right.storageIndex)) {
    if (fact.storage === "object-handle" &&
      field.storageIndex !== structuralInitializers.length) {
      return undefined;
    }
    const accessor = accessorValuesByStorageIndex.get(field.storageIndex);
    if (accessor !== undefined) {
      if (fact.storage === "object-handle") {
        const plannedField = context.input.structuralShapes.field(
          fact.resultCarrier,
          field.storageIndex,
        );
        if (plannedField?.storage !== "property" || accessor.getter === undefined ||
          (accessor.setter !== undefined) !==
            (plannedField.property?.setterTargetName !== undefined)) {
          return undefined;
        }
        structuralInitializers.push({
          kind: "accessor",
          getter: accessor.getter,
          ...(accessor.setter === undefined ? {} : { setter: accessor.setter }),
        });
      } else {
        const plannedAccessor = objectLiteralImplementation?.accessors.find((candidate) =>
          candidate.storageIndex === field.storageIndex);
        if (plannedAccessor === undefined || accessor.getter === undefined ||
          (accessor.setter !== undefined) !== (plannedAccessor.setter !== undefined)) {
          return undefined;
        }
      }
      continue;
    }
    const value = valuesByStorageIndex.get(field.storageIndex);
    if (value === undefined) {
      const storageCarrier = field.method === true
        ? rustStructuralMethodStorageCarrier(
            fact.resultCarrier,
            field.carrier,
            field.presence,
          )
        : field.carrier;
      const optionType = field.presence === "optional" &&
          rustOptionElementCarrier(storageCarrier) !== undefined
        ? rustTypeFromCarrierInContext(storageCarrier, context)
        : undefined;
      if (optionType === undefined) {
        return undefined;
      }
      structuralInitializers.push({
        kind: field.method === true ? "method" : "stored",
        value: { kind: "associated-value", owner: optionType, name: "None" },
      });
      continue;
    }
    structuralInitializers.push({
      kind: field.method === true ? "method" : "stored",
      value,
    });
    if (fact.storage === "project-object" && objectLiteralImplementation === undefined) {
      const storagePath = rustDirectProjectFieldStoragePath(
        fact.resultCarrier,
        field.storageIndex,
        context,
      );
      if (storagePath?.length !== 1) {
        return undefined;
      }
      projectFields.push({ name: storagePath[0]!, value });
    }
  }
  context.usedAliases?.add("rt");
  if (stateMarker !== undefined) {
    projectFields.push({ name: stateMarker.name, value: stateMarker.value });
  }
  let constructed: RustExpr | undefined;
  if (objectLiteralImplementation !== undefined) {
    if (objectLiteralImplementation.wrapperType.kind !== "named" ||
      objectLiteralImplementation.stateFields.length +
        objectLiteralImplementation.accessors.length !== fact.fields.length ||
      objectLiteralImplementation.implementations.some((implementation) =>
        !methodValues.has(implementation.fieldName))) {
      return undefined;
    }
    const implementationFields = [...objectLiteralImplementation.stateFields]
      .sort((left, right) => left.storageIndex - right.storageIndex)
      .map((field) => ({
        name: field.targetName,
        value: valuesByStorageIndex.get(field.storageIndex),
      }));
    if (implementationFields.some((field) => field.value === undefined)) {
      return undefined;
    }
    const identityName = allocateRustSyntheticName(context.syntheticNames, "record_identity");
    const rootName = allocateRustSyntheticName(context.syntheticNames, "record_root");
    const accessorImplementationFields = objectLiteralImplementation.accessors.flatMap(
      (accessor): { readonly name: string; readonly value: RustExpr | undefined }[] => {
        const values = accessorValuesByStorageIndex.get(accessor.storageIndex);
        return [{
          name: accessor.getter.fieldName,
          value: values?.getter,
        }, ...(accessor.setter === undefined
          ? []
          : [{
              name: accessor.setter.fieldName,
              value: values?.setter,
            }])];
      },
    );
    if (accessorImplementationFields.some((field) => field.value === undefined)) {
      return undefined;
    }
    bindings.push({
      name: identityName,
      value: { kind: "call", path: "rt::ObjectIdentity::new", args: [] },
    }, {
      name: rootName,
      value: {
        kind: "call",
        path: "std::rc::Rc::new",
        args: [{
          kind: "struct-literal",
          path: objectLiteralImplementation.rootName,
          fields: [{
            name: rustProjectObjectIdentityField,
            value: {
              kind: "method-call",
              receiver: { kind: "path", path: identityName },
              method: "clone",
              args: [],
            },
          }, {
            name: rustProjectObjectStateField,
            value: {
              kind: "call",
              path: "rt::ObjectHandle::new",
              args: [{
                kind: "struct-literal",
                path: objectLiteralImplementation.stateName,
                fields: [
                  ...implementationFields.map((field) => ({
                    name: field.name,
                    value: field.value!,
                  })),
                  ...objectLiteralImplementation.methodOverrides.map((override) => ({
                    name: override.fieldName,
                    value: { kind: "none" as const },
                  })),
                ],
              }],
            },
          }, ...objectLiteralImplementation.implementations.map((implementation) => ({
            name: implementation.fieldName,
            value: methodValues.get(implementation.fieldName)!,
          })), ...accessorImplementationFields.map((field) => ({
            name: field.name,
            value: field.value!,
          }))],
        }],
      },
    });
    constructed = {
      kind: "struct-literal",
      path: objectLiteralImplementation.wrapperType.path,
      fields: [{
        name: rustProjectObjectIdentityField,
        value: { kind: "path", path: identityName },
      }, {
        name: rustProjectObjectDispatchField,
        value: { kind: "path", path: rootName },
      }],
    };
  } else {
    constructed = fact.storage === "project-object"
      ? createRustProjectObject(typePath!, statePath!, projectFields)
      : createRustStructuralObjectFromCarrier(
          fact.resultCarrier,
          structuralInitializers,
          context,
        );
  }
  return constructed === undefined
    ? undefined
    : bindings.length === 0
      ? constructed
      : { kind: "block", bindings, value: constructed };
}

function planProjectIndexRecordLiteral(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "record-index-literal" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!requireExpressionCarrier(
    node,
    fact.resultCarrier,
    context,
    "rust.backend.record-index-literal-carrier",
  ) || context.syntheticNames === undefined) {
    return undefined;
  }
  const definition = context.input.projectTypes.definitionForCarrier(fact.resultCarrier);
  const wrapperType = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  const stateType = rustProjectStateType(fact.resultCarrier, context);
  const properties = context.input.ast.properties(node);
  if (definition?.kind !== "interface" || context.input.projectTypes.isPolymorphic(definition) ||
    wrapperType?.kind !== "named" || stateType?.kind !== "named" ||
    properties.length !== fact.contributions.length ||
    fact.contributions.some((contribution, index) => contribution.property !== properties[index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-index-literal-contract",
      "Index-backed object literal conflicts with its finalized interface, contribution order, or generated storage contract.",
    ));
    return undefined;
  }
  const mapName = allocateRustSyntheticName(context.syntheticNames, "record_index_entries");
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
  }[] = [];
  const mapPath: RustExpr = { kind: "path", path: mapName };
  let entries: RustExpr | undefined;
  for (const contribution of fact.contributions) {
    if (contribution.kind === "property") {
      const initializer = ObjectLiteralProperty_Value(context.input.ast, contribution.property);
      const value = initializer === contribution.expression
        ? planExpression(contribution.expression, context)
        : undefined;
      const key = rustProjectIndexLiteralKey(contribution.sourceName, fact.keyCarrier);
      if (value === undefined || key === undefined) {
        return undefined;
      }
      const valueName = allocateRustSyntheticName(
        context.syntheticNames,
        `record_${contribution.sourceName}`,
      );
      bindings.push({ name: valueName, value });
      const contributionEntries: RustExpr = {
        kind: "call",
        path: "std::iter::once",
        args: [{
          kind: "tuple-literal",
          elements: [key, { kind: "path", path: valueName }],
        }],
      };
      entries = appendRustRecordEntries(entries, contributionEntries);
      continue;
    }
    const spreadExpression = SpreadAssignment_Expression(
      context.input.ast,
      contribution.property,
    );
    const spread = spreadExpression === contribution.expression
      ? planExpression(contribution.expression, context)
      : undefined;
    if (spread === undefined) {
      return undefined;
    }
    const spreadName = allocateRustSyntheticName(context.syntheticNames, "record_index_spread");
    const spreadEntriesName = allocateRustSyntheticName(
      context.syntheticNames,
      "record_index_spread_entries",
    );
    bindings.push({ name: spreadName, value: spread }, {
      name: spreadEntriesName,
      value: readRustProjectObjectIndexStorage(
        { kind: "path", path: spreadName },
        contribution.sourceStorageName,
      ),
    });
    const spreadEntries: RustExpr = { kind: "path", path: spreadEntriesName };
    entries = entries === undefined
      ? {
          kind: "method-call",
          receiver: spreadEntries,
          method: "into_iter",
          args: [],
        }
      : appendRustRecordEntries(entries, spreadEntries);
  }
  bindings.push({
    name: mapName,
    value: entries === undefined
      ? { kind: "call", path: "std::collections::HashMap::new", args: [] }
      : {
          kind: "call",
          path: "std::collections::HashMap::from_iter",
          args: [entries],
        },
  });
  context.usedAliases?.add("rt");
  return {
    kind: "block",
    bindings,
    value: createRustProjectObject(
      wrapperType.path,
      stateType.path,
      [{ name: fact.storageName, value: mapPath }],
    ),
  };
}

function appendRustRecordEntries(
  current: RustExpr | undefined,
  next: RustExpr,
): RustExpr {
  return current === undefined
    ? next
    : {
        kind: "method-call",
        receiver: current,
        method: "chain",
        args: [next],
      };
}

function rustProjectIndexLiteralKey(
  sourceName: string,
  keyCarrier: TargetTypeRef,
): RustExpr | undefined {
  if (isRustStringCarrier(keyCarrier)) {
    return {
      kind: "call",
      path: "String::from",
      args: [{ kind: "str-literal", value: sourceName }],
    };
  }
  if (isRustIntegerCarrier(keyCarrier)) {
    const value = parseSourceIntegerLiteral(sourceName);
    return value === undefined
      ? undefined
      : { kind: "int-literal", text: value.toString(10) };
  }
  return undefined;
}
