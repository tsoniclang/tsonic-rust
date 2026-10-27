import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustFlowReadProjectionFact, RustProjectUpcastFact, RustContextualValueConversionFact } from "../../../target-model/records/objects/value-projections.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { requireRustReadOwnership } from "./typed-locations.js";
import { createRustSharedReferenceArgument } from "./input-shaping.js";
import { planExpressionInner } from "./dispatch.js";
import { planRustNativeHandler } from "./native-handlers.js";
import { planRustFlowReadProjection } from "./flow-read-projections.js";
import { planRustProjectDowncast } from "../objects/project-downcasts.js";
import { planRustObjectReferenceView } from "./object-reference-views.js";
import { planRustGenericCallableFlow } from "./generic-callable-flow.js";
import { planRustProjectUnionMapping } from "./project-union-mappings.js";
import { planRustCallableConversion } from "./callable-conversions.js";
import { planRustCallableJoinWrite } from "./shared-callable-writes.js";
import { planRustIntegerTruncation } from "./integer-truncation.js";
import { planProviderRecordCopy } from "./provider-record-copy.js";
import { planRustEmptyRecordConversion } from "./empty-record-conversion.js";
import { applyRustValueConversion } from "./value-conversions.js";
import { planRustAbsentValue, planRustPresentValue } from "./optional-storage.js";
import { planRustDiscardedPromise } from "./discarded-promises.js";
import { planRustExpressionExit } from "./eager-exits.js";
import { rustTypeFromCarrierInContext, rustUnionTypePathInContext } from "../types/render.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../objects/project-objects.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export type RustExpressionResultUse = "value" | "discarded";
export type RustExpressionAccess = "value" | "shared-reference" | "shared-place" | "shared-receiver";

export function planExpression(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse = "value",
  access: RustExpressionAccess = "value"): RustExpr | undefined {
  return planProjectedExpression(node, context, resultUse, "option", access);
}

export function planExpressionBeforeOptionProjection(node: Node, context: RustPlanContext): RustExpr | undefined {
  return planProjectedExpression(node, context, "value", "contextual");
}

export function planExpressionBeforeContextualConversion(node: Node, context: RustPlanContext): RustExpr | undefined {
  return planProjectedExpression(node, context, "value", "source");
}

function planProjectedExpression(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse,
  finalStage: "source" | "contextual" | "option", access: RustExpressionAccess = "value"): RustExpr | undefined {
  const ownership = context.input.program.records.readOwnership.get(node);
  const selectedBorrow = access === "value" && ownership?.value.kind === "borrow";
  if (selectedBorrow) access = "shared-place";
  const override = context.expressionOverrides?.get(node);
  const key = context.input.program.records.indexedFieldKeyArgument.get(node);
  if (key !== undefined && finalStage !== "source" && override === undefined) {
    const type = rustTypeFromCarrierInContext(key.carrier, context);
    if (type?.kind !== "named") failRustPlannerInvariant("An admitted field-key argument requires its native const carrier.", node);
    const value: RustExpr = { kind: "path", path: type.path,
      genericArguments: type.genericArguments?.filter(argument => argument.kind === "type" || argument.kind === "const") };
    const selected: RustExpr = access === "shared-reference" ? { kind: "reference", expr: value } : value;
    if (!key.evaluate) return selected;
    const effect = planExpressionBeforeValueProjections(node, context, "discarded");
    if (effect === undefined) failRustPlannerInvariant("An admitted field-key argument requires its original source effects.", node);
    return { kind: "evaluate-then", effect, discard: "value", value: selected };
  }
  const projection = resultUse === "discarded" ? undefined : rustValueProjectionFor(node, override?.carrier, context);
  // A contextual conversion that consumes its source (`JsValue::from(handle)`) reads an owned value even when the
  // converted result is then borrowed; the read ownership (move or clone) applies to that source read.
  const consumes = access !== "value" && finalStage !== "source" && projection?.contextualConsumesSource === true &&
    !projection.contextualIdentity;
  let value = planExpressionBeforeValueProjections(node, context, resultUse, ownership?.source.kind === "borrow" ? "shared-place"
    : selectedBorrow || consumes ? "value" : access);
  if (value === undefined || resultUse === "discarded") return value;
  const selected = projection
    ?? failRustPlannerInvariant("An admitted expression requires its exact sealed projection composition.", node);
  if (selected.exits) return value;
  const flowOverridden = context.flowReadOverrides?.has(node) === true;
  const fused = finalStage !== "source" && !flowOverridden ? selected.fused : undefined;
  const borrowed = selected.borrowable && !flowOverridden && (override === undefined || override.valueForm === "shared-reference");
  const borrowFlow = borrowed && access !== "value" && selected.contextual === undefined;
  const borrowConversion = borrowed && finalStage !== "source" && selected.borrowConversion;
  const borrowedOptionIdentity = finalStage === "option" && !flowOverridden && selected.borrowedOptionIdentity;
  if (fused === undefined && selected.flow !== undefined && !borrowedOptionIdentity)
    value = planRustFlowReadProjection(node, value, selected.flow, context, borrowFlow || borrowConversion);
  if (selected.upcast !== undefined) value = planRustProjectUpcast(node, value, selected.upcast, context, "borrowed");
  else if (selected.downcast !== undefined) value = planRustProjectDowncast(node, value, selected.downcast, context);
  if (value === undefined) failRustPlannerInvariant("An admitted expression requires its native source-stage projection.", node);
  if (finalStage === "source") return value;
  if (selected.object !== undefined) value = planRustObjectReferenceView(node, value, selected.object, context);
  if (value === undefined) failRustPlannerInvariant("An admitted expression requires its native object view.", node);
  // A joined callable write changes the callable's error; the contextual conversion (a union wrap, an option) then
  // places the written callable.
  const joinWrite = context.input.program.records.callableJoinWrite.get(node);
  if (joinWrite !== undefined) value = planRustCallableJoinWrite(joinWrite, value, node, context);
  if (selected.contextual !== undefined && !selected.contextualIdentity)
    value = applyRustContextualValueConversion(node, value, selected.contextual, context, borrowConversion, fused);
  if (value === undefined) failRustPlannerInvariant("An admitted expression requires its native contextual projection.", node);
  if (finalStage === "contextual") return value;
  if (selected.option?.kind === "none") {
    const absent = planRustAbsentValue(context.valueDestinations?.get(node) ?? selected.option.resultCarrier, context);
    value = selected.preserveAbsenceEffect ? { kind: "evaluate-then", effect: value, discard: selected.absenceDiscard, value: absent } : absent;
  } else if (selected.option?.kind === "some" && !borrowedOptionIdentity) value = planRustPresentValue(selected.option.resultCarrier, value, context);
  if (access === "shared-receiver") return value;
  if (access === "shared-place") return borrowFlow ? { kind: "dereference", pointer: value } : value;
  // A contextual conversion to a shared reference (`AsRef::<str>::as_ref(&owned)`) already yields the shared reference;
  // borrowing it again is clippy::needless_borrow.
  const sharedResult = selected.option === undefined && selected.contextual?.targetCarrier.kind === "reference" &&
    selected.contextual.targetCarrier.mutable !== true;
  return access !== "shared-reference" || borrowFlow || selected.option === undefined && selected.referenceReborrow || sharedResult
    ? value : createRustSharedReferenceArgument(context, { stage: "source", expression: value, node });
}

// An override may carry the node's own carrier specialized by the planning context (a dispatch specialization or a
// generic instantiation); it then composes the projections sealed for the node's own carrier.
export function rustValueProjectionFor(node: Node, carrier: TargetTypeRef | undefined, context: RustPlanContext) {
  const records = context.input.program.records;
  const exact = records.valueProjection.get(node, carrier);
  if (exact !== undefined || carrier === undefined) return exact;
  const raw = records.runtimeCarrier.get(node)?.carrier;
  return raw !== undefined && rustTargetTypeRefEquals(substituteRustTargetGenerics(raw, context.typeParameterSubstitutions ?? new Map(),
    context.lifetimeSubstitutions ?? new Map()), carrier) ? records.valueProjection.get(node, raw) : undefined;
}

export function planExpressionBeforeValueProjections(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse,
  access: RustExpressionAccess = "value"): RustExpr | undefined {
  const override = context.expressionOverrides?.get(node);
  if (override === undefined) return planRawExpression(node, context, resultUse, access);
  return override.valueForm === "storage" && access === "value" && requireRustReadOwnership(node, context).snapshot?.kind === "clone"
    ? cloneRustExpression(override.expression) : override.expression;
}

export function planRawExpression(node: Node, context: RustPlanContext, resultUse: RustExpressionResultUse,
  access: RustExpressionAccess = "value"): RustExpr {
  const exit = context.input.program.records.expressionExit.get(node);
  if (exit !== undefined) return planRustExpressionExit(node, exit, context, planExpression);
  const handler = context.input.program.records.nativeHandler.get(node);
  const planned = handler === undefined ? planExpressionInner(node, context, resultUse, access)
    : planRustNativeHandler(node, handler, context, resultUse, planExpression);
  if (planned === undefined) failRustPlannerInvariant("An admitted expression requires its finalized native syntax.", node);
  const discarded = context.input.program.records.promiseResult.get(node)?.discard;
  return discarded === undefined ? planned : planRustDiscardedPromise(node, planned, discarded, context);
}

function applyRustContextualValueConversion(node: Node, expression: RustExpr, fact: RustContextualValueConversionFact,
  context: RustPlanContext, shared: boolean, upstream: Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }> | undefined): RustExpr | undefined {
  const conversion = fact.conversion;
  switch (conversion.kind) {
    case "native-trait-object-upcast":
    case "reference-reborrow": return expression;
    case "generic-callable-flow": return planRustGenericCallableFlow(node, conversion, expression, context);
    case "project-union-map": return planRustProjectUnionMapping(node, expression, conversion, fact.sourceCarrier, fact.targetCarrier, context,
      !shared && context.expressionOverrides?.get(node)?.valueForm !== "shared-reference" && requireRustReadOwnership(node, context).value.kind === "move",
      (value, cast, owns) => planRustProjectUpcast(node, value, cast, context, owns ? "owned" : "borrowed"), upstream);
    case "callable-adapter": return planRustCallableConversion(conversion, expression, node, context);
    case "integer-truncation": return planRustIntegerTruncation(expression, context, node);
    case "provider-record-copy": return planProviderRecordCopy(conversion, expression, node, context);
    case "empty-record": return planRustEmptyRecordConversion(conversion, expression, node, context);
    default: return applyRustValueConversion(context, { stage: "source", expression, node }, conversion, node, shared);
  }
}

export function planRustProjectUpcast(node: Node, expression: RustExpr, fact: RustProjectUpcastFact,
  context: RustPlanContext, ownership: "owned" | "borrowed"): RustExpr {
  const selected = context.input.program.records.projectUpcastEmission.get(fact)
    ?? failRustPlannerInvariant("An admitted upcast requires its exact native heritage and storage plan.", node);
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted upcast requires its native hygienic scope.", node);
  if (selected.kind === "union") {
    const path = rustUnionTypePathInContext(fact.sourceCarrier, context)
      ?? failRustPlannerInvariant("An admitted union upcast requires its native owner path.", node);
    const arms = selected.variants.map((variant): { readonly pattern: RustPattern; readonly expression: RustExpr } => {
      const name = allocateRustSyntheticName(names, "upcast_variant");
      return { pattern: { kind: "tuple-variant", path: `${path}::${variant.name}`, elements: [{ kind: "binding", name }] },
        expression: planRustProjectUpcast(node, { kind: "path", path: name }, variant.fact, context, "borrowed") };
    });
    return { kind: "match", expression: { kind: "reference", expr: expression }, arms };
  }
  const target = rustTypeFromCarrierInContext(fact.targetCarrier, context);
  if (target?.kind !== "named") failRustPlannerInvariant("An admitted upcast requires its exact native target type.", node);
  const name = allocateRustSyntheticName(names, "upcast_value");
  const value: RustExpr = { kind: "path", path: name };
  // A borrowed source stays usable after the upcast: it is bound by reference and its fields are cloned.
  return rustValueBlock([{ name, value: ownership === "owned" ? expression : { kind: "reference", expr: expression } }], {
    kind: "struct-literal", path: target.path,
    fields: [rustProjectObjectIdentityField, rustProjectObjectDispatchField].map(field => {
      if (field === rustProjectObjectIdentityField && selected.structural) return { name: field, value: cloneRustExpression({ kind: "method-call",
        receiver: { kind: "field", receiver: value, name: rustProjectObjectDispatchField }, method: "object_identity", args: [] }) };
      const access: RustExpr = { kind: "field", receiver: value, name: field };
      return { name: field, value: ownership === "owned" ? access : cloneRustExpression(access) };
    }) });
}
