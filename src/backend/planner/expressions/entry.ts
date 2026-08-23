import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
} from "../../../target-model/types/index.js";
import {
  KindBinaryExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Operand,
} from "@tsonic/target-api/source";
import {
  rustContextualValueConversionFactKey,
  rustFlowReadProjectionFactKey,
  rustOptionProjectionFactKey,
  rustProjectDowncastFactKey,
  rustProjectUpcastFactKey,
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyRustValueConversion } from "./conversions.js";
import { diagnosticInput, sourceTypePath } from "../program/plan-context.js";
import { findRustUpdateSourceAccessor } from "./updates/source.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpressionInner } from "./dispatch.js";
import { planRustFlowReadProjection } from "./flow-reads.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { planRustProjectDowncast } from "../objects/project-downcasts.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../objects/project-objects.js";
import { rustSelectedAccessorRequiresUnsafe, rustSelectedCallRequiresUnsafe, tryPlanRustExplicitSafetyExpression } from "../safety/explicit-safety.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustValueCarrierBeforeContextualConversion } from "../../../analysis/facts/value-carrier-queries.js";
import { tryPlanRustNativePointerOperation } from "./native-pointers.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export type RustExpressionResultUse = "value" | "discarded";

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
  const flowRead = context.input.program.facts.getFact(node, rustFlowReadProjectionFactKey);
  const upcast = context.input.program.facts.getFact(node, rustProjectUpcastFactKey);
  const downcast = context.input.program.facts.getFact(node, rustProjectDowncastFactKey);
  const contextualConversion = context.input.program.facts.getFact(
    node,
    rustContextualValueConversionFactKey,
  );
  const projection = context.input.program.facts.getFact(node, rustOptionProjectionFactKey);
  let currentCarrier = override?.carrier ??
    flowRead?.sourceCarrier ??
    upcast?.sourceCarrier ??
    downcast?.sourceCarrier ??
    contextualConversion?.sourceCarrier ??
    projection?.sourceCarrier ??
    context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  let flowSelected = planned;
  if (flowRead !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, flowRead.sourceCarrier)) {
      const sourceValue = planRustNonConsumingValue(node, flowSelected, context);
      const selected = flowRead.kind === "representation-conversion"
        ? applyRustValueConversion(
            context,
            sourceValue,
            flowRead.conversion,
            node,
            false,
          )
        : planRustFlowReadProjection(node, sourceValue, flowRead, context);
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

export function planExpressionBeforeValueProjections(
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

export function planRawExpression(
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
  fact: import("../../../analysis/facts/keys.js").RustContextualValueConversionFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceCarrier = rustValueCarrierBeforeContextualConversion(
    context.input.program.facts,
    node,
  );
  if (!rustTargetTypeRefEquals(sourceCarrier, fact.sourceCarrier)) {
    const left = context.input.program.source.ast.kindName(node) === KindBinaryExpression
      ? BinaryExpression_Left(context.input.program.source.ast, node)
      : undefined;
    const right = context.input.program.source.ast.kindName(node) === KindBinaryExpression
      ? BinaryExpression_Right(context.input.program.source.ast, node)
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
        `carrier.left=${JSON.stringify(context.input.program.facts.getRuntimeCarrierFact(left)?.carrier)}`,
        `carrier.right=${JSON.stringify(context.input.program.facts.getRuntimeCarrierFact(right)?.carrier)}`,
        `operation=${JSON.stringify(context.input.program.facts.getFact(node, rustTargetOperationFactKey))}`,
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
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  if (operation?.kind === "source-accessor" &&
    rustSelectedAccessorRequiresUnsafe(node, "getter", context.input)) {
    return "accessor";
  }
  const kind = context.input.program.source.ast.kindName(node);
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(context.input.program.source.ast, node);
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
  fact: import("../../../analysis/facts/keys.js").RustProjectUpcastFact,
  actual: TargetTypeRef | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const targetDefinition = context.input.program.projectTypes.definitionForCarrier(fact.targetCarrier);
  const targetValue = rustSourceTypeCarrierValue(fact.targetCarrier);
  const targetPath = targetValue === undefined ? undefined : sourceTypePath(context, targetValue);
  const relationship = targetDefinition === undefined
    ? { kind: "unrelated" as const }
    : context.input.program.projectTypes.relationship(fact.sourceCarrier, targetDefinition);
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
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
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
