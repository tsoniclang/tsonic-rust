import { requireRustReadOwnership } from "./typed-locations.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustOptionalStorageValue } from "../../../target-model/types/projections.js";
import { planRustOptionalStorageOperation } from "./optional-storage.js";
import {
  isRustUnitCarrier,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import {
  KindBinaryExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Operand,
} from "@tsonic/target-api/source";

import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { planProviderRecordCopy } from "./provider-record-copy.js";
import { planRustEmptyRecordConversion } from "./empty-record-conversion.js";

import { planRustObjectReferenceView } from "./object-reference-views.js";
import { diagnosticInput, sourceTypePath } from "../program/plan-context.js";
import { findRustUpdateSourceAccessor } from "./updates/source.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { planExpressionInner } from "./dispatch.js";
import { planRustFlowReadProjection } from "./flow-read-projections.js";
import { createRustSharedReferenceArgument } from "./input-shaping.js";
import { planRustProjectDowncast } from "../objects/project-downcasts.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../objects/project-objects.js";
import { rustSelectedAccessorRequiresUnsafe, rustSelectedCallRequiresUnsafe } from "../safety/explicit-safety.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext, rustUnionTypePathInContext } from "../types/render.js";
import { rustValueCarrierBeforeContextualConversion, rustProjectUpcastSourceMatches, rustValueReferenceReborrow } from "../../../analysis/conversions/value-carrier-queries.js";
import { rustCompilerOwnedContextualConversionMatches, rustContextualRuntimeConversionContract } from "../../../target-model/conversions/contextual.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { planRustNativeHandler } from "./native-handlers.js";
import type { Node } from "@tsonic/tsts";
import { planRustGenericCallableFlow } from "./generic-callable-flow.js";
import { planRustCallableConversion } from "./callable-conversions.js";
import { planRustProjectUnionMapping } from "./project-union-mappings.js";
import type { RustFlowReadProjectionFact } from "../../../target-model/records/value-projections.js";
import { planRustIntegerTruncation } from "./integer-truncation.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustNativeFutureCallableResult } from "../../../target-model/types/carriers/generic-callables.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import { planRustDiscardedPromise } from "./discarded-promises.js";

export type RustExpressionResultUse = "value" | "discarded";
export type RustExpressionAccess = "value" | "shared-reference" | "shared-place" | "shared-receiver";

export function planExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse = "value",
  access: RustExpressionAccess = "value",
): RustExpr | undefined {
  return planProjectedExpression(node, context, resultUse, "option", access);
}

export function planExpressionBeforeOptionProjection(
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  return planProjectedExpression(node, context, "value", "contextual");
}

export function planExpressionBeforeContextualConversion(
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  return planProjectedExpression(node, context, "value", "source");
}

function planProjectedExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
  finalStage: "source" | "contextual" | "option",
  access: RustExpressionAccess = "value",
): RustExpr | undefined {
  const ownership = context.input.program.ownership.reads.get(node);
  const selectedBorrow = access === "value" && ownership?.value.kind === "borrow";
  if (selectedBorrow) access = "shared-place";
  const override = context.expressionOverrides?.get(node);
  const key = context.input.program.records.indexedFieldKeyArgument.get(node);
  if (key !== undefined && finalStage !== "source" && override === undefined) {
    const type = rustTypeFromCarrierInContext(key.carrier, context);
    if (type?.kind !== "named" || type.genericArguments?.some(argument => argument.kind !== "type" && argument.kind !== "const")) return undefined;
    const value: RustExpr = { kind: "path", path: type.path,
      genericArguments: type.genericArguments?.filter(argument => argument.kind === "type" || argument.kind === "const"),
    };
    const selected: RustExpr = access === "shared-reference" ? { kind: "reference", expr: value } : value;
    if (!key.evaluate) return selected;
    const effect = planExpressionBeforeValueProjections(node, context, "discarded");
    return effect === undefined ? undefined : { kind: "evaluate-then", effect, discard: "value", value: selected };
  }
  const planned = planExpressionBeforeValueProjections(node, context, resultUse,
    ownership?.source.kind === "borrow" ? "shared-place" : selectedBorrow ? "value" : access);
  if (planned === undefined || resultUse === "discarded") {
    return planned;
  }
  const flowRead = context.input.program.records.flowReadProjection.get(node);
  const upcast = context.input.program.records.projectUpcast.get(node);
  const downcast = context.input.program.records.projectDowncast.get(node);
  const lifetimeReconciliation = context.input.program.records.callScopedLifetimeReconciliation.get(node);
  const contextualConversion = context.input.program.records.contextualValueConversion.get(node);
  const projection = context.input.program.records.optionProjection.get(node);
  const objectView = context.input.program.records.objectReferenceView.get(node);
  const fusedProjectUnion = finalStage !== "source" && flowRead?.kind === "union-map" &&
    contextualConversion?.conversion.kind === "project-union-map" &&
    rustTargetTypeRefEquals(flowRead.selectedCarrier, contextualConversion.sourceCarrier) &&
    context.flowReadOverrides?.has(node) !== true &&
    (override === undefined || rustTargetTypeRefEquals(override.carrier, flowRead.sourceCarrier)) &&
    upcast === undefined && downcast === undefined && lifetimeReconciliation === undefined && objectView === undefined
    ? flowRead : undefined;
  const borrowableFlow = (override === undefined || override.valueForm === "shared-reference") &&
    context.flowReadOverrides?.has(node) !== true &&
    ((flowRead?.kind === "source-union" || flowRead?.kind === "runtime-union") && flowRead.project === undefined ||
      flowRead?.kind === "option-value" && rustOptionalStorageValue(flowRead.sourceCarrier) === undefined) &&
    rustOptionElementCarrier(flowRead.selectedCarrier) === undefined &&
    upcast === undefined && downcast === undefined && lifetimeReconciliation === undefined &&
    projection === undefined && objectView === undefined;
  const borrowFlow = borrowableFlow && access !== "value" && contextualConversion === undefined;
  const borrowConversionInput = borrowableFlow && finalStage !== "source" && contextualConversion !== undefined &&
    rustTargetTypeRefEquals(flowRead?.selectedCarrier, contextualConversion.sourceCarrier) &&
    (rustContextualRuntimeConversionContract(contextualConversion.conversion,
      context.input.program.typeDefinitions)?.sourceMode === "ref" ||
      contextualConversion.conversion.kind === "project-union-map" && !(requireRustReadOwnership(node, context).value.kind === "move"));
  let borrowedFlowApplied = false;
  const referenceReborrow = rustValueReferenceReborrow(context.input.program.records, node,
    context.input.program.typeDefinitions);
  const finish = (value: RustExpr): RustExpr => access === "shared-receiver" ? value
    : access === "shared-place"
    ? borrowedFlowApplied ? { kind: "dereference", pointer: value } : value
    : access !== "shared-reference" || borrowFlow || projection === undefined &&
      referenceReborrow !== undefined && rustTargetTypeRefEquals(referenceReborrow.target, currentCarrier) ? value
      : createRustSharedReferenceArgument(context, value, node);
  let currentCarrier = override?.carrier ??
    flowRead?.sourceCarrier ??
    upcast?.sourceCarrier ??
    downcast?.sourceCarrier ??
    lifetimeReconciliation?.sourceCarrier ??
    contextualConversion?.sourceCarrier ??
    objectView?.sourceCarrier ??
    projection?.sourceCarrier ??
    context.input.program.records.runtimeCarrier.get(node)?.carrier;
  let flowSelected = planned;
  if (fusedProjectUnion !== undefined) {
    if (!rustTargetTypeRefEquals(currentCarrier, fusedProjectUnion.sourceCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.flow-read-order",
        "The finalized union composition conflicts with its exact input carrier."));
      return undefined;
    }
    currentCarrier = fusedProjectUnion.selectedCarrier;
  } else if (flowRead !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, flowRead.sourceCarrier)) {
      const selected = planRustFlowReadProjection(
        node,
        flowSelected,
        flowRead,
        context,
        borrowFlow || borrowConversionInput,
      );
      if (selected === undefined) {
        return undefined;
      }
      flowSelected = selected;
      borrowedFlowApplied = borrowFlow;
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
        ? planRustProjectUpcast(node, converted, upcast, currentCarrier, context, "borrowed")
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
  if (lifetimeReconciliation !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, lifetimeReconciliation.sourceCarrier)) {
      currentCarrier = lifetimeReconciliation.selectedCarrier;
    } else if (!rustTargetTypeRefEquals(currentCarrier, lifetimeReconciliation.selectedCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.call-scoped-lifetime-reconciliation-order",
        "The finalized call-scoped lifetime reconciliation is not composable with the expression's current exact carrier.",
      ));
      return undefined;
    }
  }
  if (finalStage === "source") return converted;
  let contextuallyConverted = converted;
  if (objectView !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, objectView.sourceCarrier)) {
      const selected = planRustObjectReferenceView(node, contextuallyConverted, objectView, context);
      if (selected === undefined) return undefined;
      contextuallyConverted = selected;
      currentCarrier = objectView.targetCarrier;
    } else if (!rustTargetTypeRefEquals(currentCarrier, objectView.targetCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.object-view-order",
        "The finalized object view does not match the current expression carrier."));
      return undefined;
    }
  }
  if (contextualConversion !== undefined) {
    if (rustTargetTypeRefEquals(currentCarrier, contextualConversion.sourceCarrier)) {
      const selected = applyRustContextualValueConversion(
        node,
        contextuallyConverted,
        contextualConversion,
        context,
        borrowConversionInput,
        fusedProjectUnion,
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
  if (finalStage === "contextual") {
    return contextuallyConverted;
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
    return finish(contextuallyConverted);
  }
  if (projection?.kind === "none") {
    const resultCarrier = context.valueDestinations?.get(node) ?? projection.resultCarrier;
    const optionType = rustTypeFromCarrierInContext(resultCarrier, context, "absence");
    const anonymous = rustNativeFutureCallableResult(resultCarrier)?.optional === true;
    if (optionType === undefined && !anonymous || rustOptionElementCarrier(resultCarrier) === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.option-none-carrier",
        "An exact Option projection requires a renderable finalized Option result carrier.",
      ));
      return undefined;
    }
    const value: RustExpr = rustOptionalStorageValue(projection.resultCarrier) === undefined
      ? anonymous ? { kind: "path", path: "None" }
        : { kind: "associated-value", owner: optionType!, name: "None" }
      : planRustOptionalStorageOperation(resultCarrier, "absent", [], context);
    if (contextuallyConverted.kind === "bottom") return contextuallyConverted;
    return finish(contextuallyConverted.kind === "none" || contextuallyConverted.kind === "path" || contextuallyConverted.kind === "associated-value"
      ? value
      : { kind: "evaluate-then", effect: contextuallyConverted,
          discard: isRustUnitCarrier(currentCarrier) ? "unit" : "value", value });
  }
  return finish(projection?.kind === "some"
    ? rustOptionalStorageValue(projection.resultCarrier) === undefined
      ? { kind: "call", path: "Some", args: [contextuallyConverted] }
      : planRustOptionalStorageOperation(projection.resultCarrier, "present", [contextuallyConverted], context)
    : contextuallyConverted);
}

export function planExpressionBeforeValueProjections(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
  access: RustExpressionAccess = "value",
): RustExpr | undefined {
  const override = context.expressionOverrides?.get(node);
  if (override === undefined || override.valueForm !== "storage" || access !== "value") {
    return override?.expression ?? planRawExpression(node, context, resultUse, access);
  }
  return requireRustReadOwnership(node, context).snapshot?.kind === "clone"
    ? cloneRustExpression(override.expression) : override.expression;
}

export function planRawExpression(
  node: Node,
  context: RustPlanContext,
  resultUse: RustExpressionResultUse,
  access: RustExpressionAccess = "value",
): RustExpr | undefined {
  const diagnosticCount = context.diagnostics.length;
  const nativeHandler = context.input.program.records.nativeHandler.get(node);
  const nativeCall = nativeHandler?.kind === "js-string-conversion" || nativeHandler?.kind === "typed-location";
  let planned: RustExpr | undefined;
  if (nativeHandler !== undefined && !nativeCall) {
    planned = planRustNativeHandler(node, nativeHandler, context, resultUse, planExpression);
  } else if (
    rustExpressionUnsafeRequirement(node, context) !== undefined &&
    (context.explicitUnsafeContextDepth ?? 0) === 0
  ) {
    context.diagnostics.push({
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      category: "error",
      source: "tsonic-rust",
      message: "The selected Rust operation requires an explicit unsafecontext() source region at this use site.",
      sourceNode: node,
    });
    planned = undefined;
  } else if (nativeHandler !== undefined) {
    planned = planRustNativeHandler(node, nativeHandler, context, resultUse, planExpression);
  } else {
    planned = planExpressionInner(node, context, resultUse, access);
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
  const discardedPromise = context.input.program.promiseResults.get(node)?.discard;
  return discardedPromise === undefined ? planned : planRustDiscardedPromise(node, planned, discardedPromise, context);
}

function applyRustContextualValueConversion(
  node: Node,
  expression: RustExpr,
  fact: import("../../../target-model/records/value-projections.js").RustContextualValueConversionFact,
  context: RustPlanContext,
  sourceIsSharedReference = false,
  upstream?: Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }>,
): RustExpr | undefined {
  const sourceCarrier = rustValueCarrierBeforeContextualConversion(
    context.input.program.records,
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
        `carrier.left=${JSON.stringify(context.input.program.records.runtimeCarrier.get(left)?.carrier)}`,
        `carrier.right=${JSON.stringify(context.input.program.records.runtimeCarrier.get(right)?.carrier)}`,
        `operation=${JSON.stringify(context.input.program.records.targetOperation.get(node))}`,
      ],
    });
    return undefined;
  }
  if (fact.conversion.kind === "native-trait-object-upcast" ||
    fact.conversion.kind === "reference-reborrow") {
    if (!rustCompilerOwnedContextualConversionMatches(
      fact.sourceCarrier,
      fact.targetCarrier,
      fact.conversion, context.input.program.typeDefinitions,
    )) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.contextual-value-conversion",
        "Compiler-owned contextual Rust conversion is not an exact closed carrier transition.",
      ));
      return undefined;
    }
    return expression;
  }
  if (fact.conversion.kind === "generic-callable-flow") {
    return planRustGenericCallableFlow(node, fact.conversion, expression, context);
  }
  if (fact.conversion.kind === "project-union-map") {
    const owned = !sourceIsSharedReference && context.expressionOverrides?.get(node)?.valueForm !== "shared-reference" &&
      (requireRustReadOwnership(node, context).value.kind === "move");
    return planRustProjectUnionMapping(node, expression, fact.conversion, fact.sourceCarrier,
      fact.targetCarrier, context, owned,
      (value, upcast, owned) => planRustProjectUpcast(node, value, upcast, upcast.sourceCarrier,
        context, owned ? "owned" : "borrowed"), upstream);
  }
  if (fact.conversion.kind === "callable-adapter") {
    return rustCompilerOwnedContextualConversionMatches(fact.sourceCarrier, fact.targetCarrier, fact.conversion, context.input.program.typeDefinitions)
      ? planRustCallableConversion(fact.conversion, expression, node, context) : undefined;
  }
  if (fact.conversion.kind === "integer-truncation") {
    const selected = planRustIntegerTruncation(expression, fact, context);
    if (selected === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.integer-truncation", "Native integer truncation requires its exact classified call and range proof."));
    }
    return selected;
  }
  if (fact.conversion.kind === "provider-record-copy") {
    return planProviderRecordCopy(fact.conversion, expression, node, context);
  }
  if (fact.conversion.kind === "empty-record") {
    return planRustEmptyRecordConversion(fact.conversion, expression, node, context);
  }
  const contract = rustValueConversionContract(fact.conversion, context.input.program.typeDefinitions);
  if (contract === undefined ||
    !rustTargetTypeRefEquals(contract.target, fact.targetCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.contextual-value-conversion",
      "Contextual Rust value conversion has no exact finalized target carrier.",
    ));
    return undefined;
  }
  return applyRustValueConversion(context, expression, fact.conversion, node, false, sourceIsSharedReference);
}

function rustExpressionUnsafeRequirement(
  node: Node,
  context: RustPlanContext,
): "call" | "accessor" | "provider-operation" | undefined {
  if (rustSelectedCallRequiresUnsafe(node, context.input)) {
    return "call";
  }
  const operation = context.input.program.records.targetOperation.get(node);
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
  fact: import("../../../target-model/records/value-projections.js").RustProjectUpcastFact,
  actual: TargetTypeRef | undefined,
  context: RustPlanContext,
  ownership: "owned" | "borrowed",
): RustExpr | undefined {
  if (!rustTargetTypeRefEquals(actual, fact.sourceCarrier) ||
    !rustProjectUpcastSourceMatches(fact, context.input.program.typeDefinitions)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.project-upcast", "Project-type upcast has no exact finalized source variant correspondence."));
    return undefined;
  }
  if (fact.sourceVariants !== undefined) {
    const typePath = rustUnionTypePathInContext(fact.sourceCarrier, context);
    if (typePath === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.project-upcast", "Project-type upcast has no emitted source union."));
      return undefined;
    }
    const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
    const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
    for (const variant of fact.sourceVariants) {
      const name = allocateRustSyntheticName(names, "upcast_variant");
      const projected = planRustProjectUpcast(node, { kind: "path", path: name }, {
        sourceCarrier: variant.carrier, targetCarrier: fact.targetCarrier,
      }, variant.carrier, context, "borrowed");
      if (projected === undefined) return undefined;
      arms.push({
        pattern: { kind: "tuple-variant", path: `${typePath}::${variant.name}`,
          elements: [{ kind: "binding", name }] },
        expression: projected,
      });
    }
    return { kind: "match", expression: { kind: "reference", expr: expression }, arms };
  }
  const targetDefinition = context.input.program.projectTypes.definitionForCarrier(fact.targetCarrier);
  const targetValue = rustSourceTypeCarrierValue(fact.targetCarrier);
  const targetPath = targetValue === undefined ? undefined : sourceTypePath(context, targetValue);
  const relationship = targetDefinition === undefined
    ? { kind: "unrelated" as const }
    : context.input.program.projectTypes.relationship(fact.sourceCarrier, targetDefinition);
  if (relationship.kind !== "related" ||
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
  return rustValueBlock([{ name: valueName, value: expression }], {
      kind: "struct-literal",
      path: targetPath,
      fields: [rustProjectObjectIdentityField, rustProjectObjectDispatchField].map(name => {
        if (name === rustProjectObjectIdentityField && rustStructuralObjectCarrierValue(fact.sourceCarrier) !== undefined) {
          return { name, value: cloneRustExpression({
            kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: valueName },
              name: rustProjectObjectDispatchField }, method: "object_identity", args: [],
          }) };
        }
        const field: RustExpr = { kind: "field", receiver: { kind: "path", path: valueName }, name };
        return { name, value: ownership === "owned" ? field : cloneRustExpression(field) };
      }),
    });
}
