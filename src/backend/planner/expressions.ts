import type { Node } from "@tsonic/tsts";
import type {
  RustSelectedTargetOperation as TargetOperationFact,
  RustSelectedTargetSignature as SelectedTargetSignatureFact,
  TargetTypeRef,
} from "../../policy/types.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import { rustVecRestAssembly } from "../../policy/intrinsics.js";
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
  TemplateExpression_Head,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
  TemplateSpan_Literal,
} from "../../common/source-ast.js";
import {
  parseSourceBigIntLiteral,
  parseSourceIntegerLiteral,
} from "../../common/source-literal-values.js";
import { rustClosureCaptureFactKey, rustContextualValueConversionFactKey, rustFutureValueFactKey, rustMutatedBindingFactKey, rustOptionalChainFactKey, rustOptionWrapFactKey, rustPostCheckOperationKind, rustProjectUpcastFactKey, rustSourceAccessorEffectsFactKey, rustSourceBindingFactKey, rustSourceCallableValueFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey, rustTargetOperationFactKey, rustYieldFactKey } from "../../source/rust-facts/keys.js";
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
import type { RustExpr, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { diagnosticInput, isValidRustIdentifier, registerAliasFromPath, rustSourceName, sourceTypePath } from "./plan-context.js";
import type { RustExpressionOverride, RustPlanContext } from "./plan-context.js";
import { isFloatCarrier, rustTypeFromCarrierInContext } from "./render-types.js";
import { getRustGeneratorProtocol, isRustBigIntCarrier, isRustBoolCarrier, isRustCopyCarrier, isRustIntegerCarrier, isRustUnitCarrier, rustCallableProtocol, rustClosureProtocol, rustFixedArrayCarrierValue, rustFutureOutputCarrier, rustOptionElementCarrier, rustOptionTargetType, rustPrimitiveTypeName, rustSourceTypeCarrierValue, rustSourceUnionCarrierValue, substituteRustTargetTypeParameters } from "../../source/rust-target-types.js";
import { requireRustCarrierRequirements } from "./generic-requirements.js";
import {
  planRustIdentifierValue,
  planRustCaptureValue,
  planRustNonConsumingValue,
  planRustPromotedStorageLocation,
  planRustTypedLocationCall,
} from "./typed-locations.js";
import {
  createRustProjectObject,
  createRustStructuralObject,
  mutateRustProjectObjectField,
  mutateRustStructuralObjectField,
  readRustProjectDispatchedField,
  readRustProjectObjectField,
  readRustStructuralObjectField,
  rustProjectObjectDispatchField,
  writeRustProjectDispatchedField,
} from "./project-objects.js";
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
import { allocateRustSyntheticName, createRustSyntheticNameState } from "./synthetic-names.js";
import { planRustBindingPattern } from "./binding-patterns.js";
import { rustTargetOperationIsFallible } from "../../source/rust-facts/target-operation.js";
import { rustProjectDispatchTraitType } from "./project-polymorphism-names.js";
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

export function planExpression(node: Node, context: RustPlanContext): RustExpr | undefined {
  const override = context.expressionOverrides?.get(node);
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
    planned = override?.expression ?? planExpressionInner(node, context);
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
  const upcast = context.input.facts.getFact(node, rustProjectUpcastFactKey);
  const converted = upcast === undefined
    ? planned
    : planRustProjectUpcast(node, planned, upcast, context);
  if (converted === undefined) {
    return undefined;
  }
  const contextualConversion = context.input.facts.getFact(
    node,
    rustContextualValueConversionFactKey,
  );
  const contextuallyConverted = contextualConversion === undefined
    ? converted
    : applyRustContextualValueConversion(
        node,
        converted,
        contextualConversion,
        context,
      );
  if (contextuallyConverted === undefined) {
    return undefined;
  }
  const wrap = context.input.facts.getFact(node, rustOptionWrapFactKey);
  return wrap?.wrap === true
    ? { kind: "call", path: "Some", args: [contextuallyConverted] }
    : contextuallyConverted;
}

function applyRustContextualValueConversion(
  node: Node,
  expression: RustExpr,
  fact: import("../../source/rust-facts/keys.js").RustContextualValueConversionFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceCarrier = expressionCarrier(node, context);
  const convertedCarrier = context.input.facts.getTargetConversionFact(node)?.convertedType;
  if (!rustTargetTypeRefEquals(sourceCarrier, fact.sourceCarrier) ||
    !rustTargetTypeRefEquals(convertedCarrier, fact.targetCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.contextual-value-conversion",
      "Contextual Rust value conversion conflicts with its finalized source and target carriers.",
    ));
    return undefined;
  }
  return applyRustValueConversion(context, expression, fact.conversion, node);
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

function planRustProjectUpcast(
  node: Node,
  expression: RustExpr,
  fact: import("../../source/rust-facts/keys.js").RustProjectUpcastFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const actual = expressionCarrier(node, context);
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
          name: "__tsonic_identity",
          value: {
            kind: "method-call",
            receiver: {
              kind: "field",
              receiver: { kind: "path", path: valueName },
              name: "__tsonic_identity",
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
        const callableType = rustTypeFromCarrierInContext(callableValue.carrier, context);
        const declarationModule = context.moduleNameByFileName.get(callableValue.fileName);
        if (callableType === undefined || declarationModule === undefined ||
          !isValidRustIdentifier(callableValue.name)) {
          return undefined;
        }
        const argumentsName = allocateRustSyntheticName(context.syntheticNames, "callable_arguments");
        const path = declarationModule === context.moduleName
          ? callableValue.name
          : `crate::${declarationModule}::${callableValue.name}`;
        context.usedAliases?.add("rt");
        return {
          kind: "associated-call",
          owner: callableType,
          method: "new",
          args: [{
            kind: "closure-block",
            params: [{
              name: argumentsName,
              mutable: callableValue.argumentModes.some((mode) => mode === "mut-ref"),
            }],
            move: true,
            async: false,
            body: {
              statements: [{
                kind: "tail",
                expr: {
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
                },
              }],
            },
          }],
        };
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
      const callableProtocol = rustCallableProtocol(closureFact.resultCarrier);
      const nativeClosureProtocol = rustClosureProtocol(closureFact.resultCarrier);
      const parameterCarriers = closureFact.resultCarrier.kind === "function-pointer"
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
      if (parameterCarriers === undefined || resultCarrier === undefined ||
        closureFact.byRefCopyParams.length !== sourceParams.length ||
        parameterCarriers.length !== sourceParams.length) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.closure-abi",
          "Callable-expression parameter count does not match its finalized Rust closure ABI.",
        ));
        return undefined;
      }
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
          ? rustSourceName(context, nameNode !== undefined && nameKind === KindIdentifier ? ast.text(nameNode) : "")
          : allocateRustSyntheticName(context.syntheticNames!, "binding_parameter");
        if (!isValidRustIdentifier(parameterName)) {
          return undefined;
        }
        const parameterCarrier = parameterCarriers[index];
        const parameterAbi = context.input.facts.getFact(parameter, rustSourceParameterAbiFactKey);
        if (parameterCarrier === undefined || parameterAbi === undefined ||
          !rustTargetTypeRefEquals(parameterCarrier, parameterAbi.parameterCarrier) ||
          (callableProtocol === undefined && parameterAbi.form !== "required")) {
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
      const closureContext: RustPlanContext = {
        ...context,
        controlFlow: { nextLoopId: 0 },
        controlTargets: undefined,
        completionBoundary: undefined,
        fallibleContext: false,
        asyncContext: false,
        generator: undefined,
      };
      const captureBindings: { readonly name: string; readonly value: RustExpr }[] = [];
      const capturedBindingPaths = new Map(context.capturedBindingPaths);
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
        const sourceName = rustSourceName(context, binding.sourceName);
        const declarationModule = context.moduleNameByFileName.get(binding.fileName);
        const sourcePath = declarationModule !== undefined && declarationModule !== context.moduleName
          ? `crate::${declarationModule}::${sourceName}`
          : sourceName;
        if (!isValidRustIdentifier(sourceName)) {
          return undefined;
        }
        const name = allocateRustSyntheticName(context.syntheticNames, `capture_${sourceName}`);
        captureBindings.push({
          name,
          value: planRustCaptureValue(capture.reference, sourcePath, context),
        });
        capturedBindingPaths.set(capture.declaration, name);
      }
      let recursiveName: string | undefined;
      if (captureFact.recursiveDeclaration !== undefined) {
        if (context.syntheticNames === undefined || callableProtocol === undefined) {
          return undefined;
        }
        recursiveName = allocateRustSyntheticName(context.syntheticNames, "recursive_callable");
        capturedBindingPaths.set(captureFact.recursiveDeclaration, recursiveName);
      }
      const callableClosureContext: RustPlanContext = {
        ...closureContext,
        capturedBindingPaths,
      };
      const bindingStatements: RustStmt[] = [];
      let closureParams: { name: string; mutable: boolean; byRefCopy?: boolean }[];
      let closureMove = nativeClosureProtocol !== undefined && captureBindings.length > 0;
      if (callableProtocol === undefined) {
        closureParams = sourceParameterPlans.map((parameter) => ({
          name: parameter.name,
          mutable: parameter.mutable,
          byRefCopy: parameter.byRefCopy,
        }));
      } else {
        const tupleName = allocateRustSyntheticName(context.syntheticNames!, "callable_arguments");
        closureParams = [
          ...(recursiveName === undefined ? [] : [{ name: recursiveName, mutable: false }]),
          { name: tupleName, mutable: false },
        ];
        closureMove = true;
        for (const [index, parameter] of sourceParameterPlans.entries()) {
          let initializer: RustExpr = {
            kind: "field",
            receiver: { kind: "path", path: tupleName },
            name: String(index),
          };
          if (parameter.form === "default") {
            const defaultNode = Node_Initializer(context.input.ast, parameter.parameter);
            const defaultValue = defaultNode === undefined
              ? undefined
              : planExpression(defaultNode, callableClosureContext);
            if (defaultValue === undefined) {
              return undefined;
            }
            initializer = {
              kind: "method-call",
              receiver: initializer,
              method: "unwrap_or_else",
              args: [{ kind: "closure", params: [], body: defaultValue }],
            };
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
        const closure: RustExpr = bindingStatements.length === 0 && !closureMove &&
            closureParams.every((parameter) => !parameter.mutable)
          ? {
              kind: "closure",
              params: closureParams.map((parameter) => ({
                name: parameter.name,
                byRefCopy: parameter.byRefCopy === true,
              })),
              body,
            }
          : {
              kind: "closure-block",
              params: closureParams,
              move: closureMove,
              async: false,
              body: { statements: [...bindingStatements, { kind: "tail", expr: body }] },
            };
        if (callableProtocol === undefined) {
          return nativeClosureProtocol === undefined || captureBindings.length === 0
            ? closure
            : { kind: "block", bindings: captureBindings, value: closure };
        }
        const callableType = rustTypeFromCarrierInContext(closureFact.resultCarrier, context);
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
          sourceParameterPlans.some((parameter) => parameter.form === "default"),
          context,
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
      const finalizedBlock = applyRustTailShape(
        { statements: [...bindingStatements, ...block.statements] },
        !isRustUnitCarrier(resultCarrier),
      );
      const onlyStatement = finalizedBlock.statements.length === 1
        ? finalizedBlock.statements[0]
        : undefined;
      const closure: RustExpr = onlyStatement?.kind === "tail" && !closureMove &&
          closureParams.every((parameter) => !parameter.mutable)
        ? {
          kind: "closure",
          params: closureParams.map((parameter) => ({
            name: parameter.name,
            byRefCopy: parameter.byRefCopy === true,
          })),
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
      const callableType = rustTypeFromCarrierInContext(closureFact.resultCarrier, context);
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
        sourceParameterPlans.some((parameter) => parameter.form === "default"),
        context,
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
        bindings: [nextName],
      },
      expression: { kind: "path", path: nextName },
    }, {
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Return",
        bindings: [returnName],
      },
      expression: planRustFallibleReturnExpression(
        { kind: "path", path: returnName },
        context,
      ),
    }, {
      pattern: {
        kind: "tuple-variant",
        path: "rt::GeneratorResume::Throw",
        bindings: [errorName],
      },
      expression: {
        kind: "try",
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
  hasDefaultParameters: boolean,
  context: RustPlanContext,
): RustExpr {
  if (!hasDefaultParameters) {
    return captureBindings.length === 0
      ? callable
      : { kind: "block", bindings: captureBindings, value: callable };
  }
  const callableName = allocateRustSyntheticName(
    context.syntheticNames!,
    "callable_implementation",
  );
  return {
    kind: "block",
    bindings: [
      ...captureBindings,
      {
        name: callableName,
        value: callable,
        attrs: ["#[allow(clippy::let_and_return, clippy::unnecessary_lazy_evaluations)]"],
      },
    ],
    value: { kind: "path", path: callableName },
  };
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
  return context.expressionOverrides?.get(node)?.carrier ??
    context.input.facts.getRuntimeCarrierFact(node)?.carrier;
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
    if ((fact.operator === "+=" || fact.operator === "-=") && operandNode !== undefined) {
      return planRustUpdateExpression(node, operandNode, fact, context);
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
  return operand === undefined ? undefined : { kind: "unary", operator: fact.operator, operand };
}

function planRustUpdateExpression(
  expression: Node,
  operand: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
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
    : { kind: "int-literal", text: "1" };
  if (isRustBigIntCarrier(fact.resultCarrier)) {
    context.usedAliases?.add("rt");
  }
  const returnsPrevious = context.input.ast.kindName(expression) === KindPostfixUnaryExpression;
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
  return planRustBorrowedUpdateLocation(
    target,
    fact,
    step,
    returnsPrevious,
    context,
  );
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
    if (plannedReceiver === undefined) {
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(
      context.syntheticNames,
      "accessor_update_receiver",
    );
    locationBindings.push({ name: receiverName, value: plannedReceiver });
    receiver = { kind: "path", path: receiverName };
  }
  const plannedRead = planRustSourceAccessorCall(
    accessorExpression,
    accessor,
    accessor.read.method,
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
        accessor.write!.method,
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
    (payload, selectedField) => {
      const overrides = new Map(context.expressionOverrides ?? []);
      for (const override of projection.overrides) {
        overrides.set(override.node, override.value);
      }
      const mutation = (selectedField.storage === "project-object"
        ? mutateRustProjectObjectField
        : mutateRustStructuralObjectField)(
        payload,
        selectedField.storageIndex,
        (storage) => {
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
        },
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
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
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
    const mutation = (field.storage === "project-object"
      ? mutateRustProjectObjectField
      : mutateRustStructuralObjectField)(
      receiverPath,
      field.storageIndex,
      (storage) => {
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
      },
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
        value: readRustProjectDispatchedField(receiverPath, field.dispatch.read),
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
    readonly value: RustExpressionOverride;
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
    const path = rustSourceName(context, ast.text(operand));
    return isValidRustIdentifier(path) ? { kind: "path", path } : undefined;
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
  if (fact !== undefined && fact.kind === "option-value-equality") {
    const leftNode = BinaryExpression_Left(context.input.ast, node);
    const rightNode = BinaryExpression_Right(context.input.ast, node);
    const optionNode = fact.optionOperand === "left" ? leftNode : rightNode;
    const valueNode = fact.optionOperand === "left" ? rightNode : leftNode;
    const option = optionNode === undefined ? undefined : planExpression(optionNode, context);
    const value = valueNode === undefined ? undefined : planExpression(valueNode, context);
    if (option === undefined || value === undefined) {
      return undefined;
    }
    return {
      kind: "binary",
      operator: fact.negated ? "!=" : "==",
      left: fact.optionOperand === "left"
        ? option
        : { kind: "call", path: "Some", args: [value] },
      right: fact.optionOperand === "left"
        ? { kind: "call", path: "Some", args: [value] }
        : option,
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
  if (fact.kind === "operator-call") {
    registerAliasFromPath(context, fact.path);
    if (fact.fallible && context.fallibleContext !== true) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.error.operator",
        "Fallible operator calls require a finalized fallible lowering context.",
      ));
      return undefined;
    }
    const call: RustExpr = { kind: "call", path: fact.path, args: [left, right] };
    return fact.fallible ? { kind: "try", expr: call } : call;
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
    const sourceParameterAbi = node === undefined
      ? undefined
      : context.input.facts.getFact(node, rustSourceParameterAbiFactKey);
    if (sourceParameterAbi?.mode === "mut-ref") {
      return argument;
    }
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
  return { kind: "try", expr: converted };
}

function lowerRustValueConversion(
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
  }
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
    case "receiver-tagged-array":
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
  const expressionOverride = context.expressionOverrides?.get(sourceNode);
  const sourceCarrier = expressionOverride?.carrier ??
    context.input.facts.getRuntimeCarrierFact(sourceNode)?.carrier;
  const convertedCarrier = expressionOverride === undefined
    ? context.input.facts.getTargetConversionFact(sourceNode)?.convertedType
    : undefined;
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
          expressionOverride?.valueForm === "shared-reference",
        );
}

function applyFinalizedArgumentMode(
  expression: RustExpr,
  input: RustFinalizedSourceInput,
  sourceParameterAbi: import("../../source/rust-facts/keys.js").RustSourceParameterAbiFact | undefined,
  sourceIsSharedReference: boolean,
): RustExpr {
  if (input.mode === "value" || input.conversion.targetCarrier.kind === "pointer") {
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
      fact?.kind === "provider-operation" || fact?.kind === "typed-location"
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
    return argument;
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
      if (fact.target.dispatch !== undefined) {
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
                method: fact.target.dispatch.exactSlot,
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
                method: fact.target.dispatch.virtualSlot,
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
        planned = { kind: "call", path: `${typePath}::${fact.target.name}`, args: shaped };
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
  const convertedCarrier = context.input.facts.getTargetConversionFact(argumentNode)?.convertedType;
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
  if (parameter.parameterCarrier.kind !== "pointer" ||
    !rustTargetTypeRefEquals(parameter.parameterCarrier.pointee, input.carrier)) {
    return undefined;
  }
  const mutable = parameter.mode === "mut-ref";
  const sourceParameterAbi = context.input.facts.getFact(argumentNode, rustSourceParameterAbiFactKey);
  return sourceParameterAbi?.mode === parameter.mode &&
      rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, parameter.parameterCarrier)
    ? selectedInput
    : selectedInput.kind === "string-literal" && !mutable
      ? { kind: "str-literal", value: selectedInput.value }
      : { kind: "reference", expr: selectedInput, ...(mutable ? { mutable: true } : {}) };
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
  const expectedTargetName = fact.target.form === "constructor"
    ? fact.target.name
    : fact.target.form === "callable" ? member.targetName : fact.target.name;
  const selectedReturn = member.returnType === undefined
    ? undefined
    : substituteRustTargetTypeParameters(member.returnType, substitutions);
  return member.id === fact.operationId &&
    member.kind === expectedKind &&
    member.targetName === expectedTargetName &&
    selectedReturn !== undefined && rustTargetTypeRefEquals(selectedReturn, fact.resultCarrier) &&
    isDenseDataArray(member.parameters) && member.parameters.length === fact.parameters.length &&
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
  const guard = planExpression(fact.guard, context);
  if (guard === undefined) {
    return undefined;
  }
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
  const innerFallible = rustTargetOperationIsFallible(rustOperationFact(node, context)) ||
    sourceCallEffects?.invocation === "fallible" ||
    sourceAccessorEffects?.read === "fallible";
  const fallibleBody = body.kind === "try"
    ? body.expr
    : {
        kind: "call" as const,
        path: "Ok::<_, tsonic_rust_runtime::TsonicError>",
        args: [body],
      };
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
    expr: { kind: "method-call", receiver: mapped, method: "transpose", args: [] },
  };
  return fact.lowering === "and-then"
    ? { kind: "method-call", receiver: transposed, method: "flatten", args: [] }
    : transposed;
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
    const planned = planRustSourceAccessorCall(node, fact, read.method, [], context);
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
    const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
    if (receiver === undefined) {
      return undefined;
    }
    if (fact.dispatch === undefined) {
      return (fact.storage === "project-object"
        ? readRustProjectObjectField
        : readRustStructuralObjectField)(receiver, fact.storageIndex, fact.resultCarrier);
    }
    if (context.syntheticNames === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.project-dispatch-temporary",
        "Project property dispatch requires a finalized hygienic-name scope.",
      ));
      return undefined;
    }
    const receiverName = allocateRustSyntheticName(
      context.syntheticNames,
      "dispatch_receiver",
    );
    return {
      kind: "block",
      bindings: [{ name: receiverName, value: receiver }],
      value: readRustProjectDispatchedField(
        { kind: "path", path: receiverName },
        fact.dispatch.read,
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
    (payload, field) => (field.storage === "project-object"
      ? readRustProjectObjectField
      : readRustStructuralObjectField)(payload, field.storageIndex, fact.resultCarrier),
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
  method: string,
  args: readonly RustExpr[],
  context: RustPlanContext,
  receiverOverride?: RustExpr,
): RustExpr | undefined {
  if (fact.receiver.kind === "static") {
    const value = rustSourceTypeCarrierValue(fact.receiver.typeCarrier);
    const ownerPath = value === undefined ? undefined : sourceTypePath(context, value);
    return ownerPath === undefined
      ? undefined
      : { kind: "call", path: `${ownerPath}::${method}`, args };
  }
  const receiverNode = Node_Expression(context.input.ast, node);
  const receiver = receiverOverride ?? (receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context));
  return receiver === undefined
    ? undefined
    : { kind: "method-call", receiver, method, args };
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
  return { kind: "try", expr: expression };
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
  const value = fact.storage === "project-object"
    ? rustSourceTypeCarrierValue(fact.resultCarrier)
    : undefined;
  const typePath = value === undefined ? undefined : sourceTypePath(context, value);
  if (fact.storage === "project-object" && typePath === undefined) {
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
    const kind = property === undefined ? undefined : ast.kindName(property);
    if (property === undefined ||
      (kind !== "KindPropertyAssignment" && kind !== "KindShorthandPropertyAssignment")) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, property ?? node),
        "rust.backend.record-fields",
        "Object literal contains a property without a finalized record-field assignment.",
      ));
      return undefined;
    }
    const nameNode = ast.name(property);
    const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
    const initializer = ObjectLiteralProperty_Value(context.input.ast, property);
    const planned = initializer === undefined ? undefined : planExpression(initializer, context);
    if (sourceName.length === 0 || fieldsBySourceName.has(sourceName) || planned === undefined) {
      return undefined;
    }
    fieldsBySourceName.set(sourceName, planned);
  }
  if (fieldsBySourceName.size !== fact.fields.length ||
    fact.fields.some((field) => !fieldsBySourceName.has(field.sourceName)) ||
    new Set(fact.fields.map((field) => field.sourceName)).size !== fact.fields.length ||
    new Set(fact.fields.map((field) => field.storageIndex)).size !== fact.fields.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-fields",
      "Object literal properties do not match the finalized ordered record-field fact.",
    ));
    return undefined;
  }
  const values: RustExpr[] = [];
  for (const field of [...fact.fields].sort((left, right) => left.storageIndex - right.storageIndex)) {
    const value = fieldsBySourceName.get(field.sourceName);
    if (field.storageIndex !== values.length || value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  context.usedAliases?.add("rt");
  return fact.storage === "project-object"
    ? createRustProjectObject(typePath!, values)
    : createRustStructuralObject(values);
}
