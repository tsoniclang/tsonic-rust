import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustErrorBoundaryForProjectMember } from "../program/plan-context.js";
import { rustErrorType, rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustCallTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustSourceIndexRead } from "../objects/indexed-records.js";
import { readRustProjectDispatchedField, rustProjectObjectDispatchField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRole } from "../objects/project-field-dispatch.js";
import { readRustSourceStaticField } from "../declarations/classes/static-field-storage.js";
import { readRustStoredObjectField, rustStoredObjectFieldSupportsBorrowedRead } from "../objects/project-storage.js";
import { planRustValueFieldLocation, rustSourceFieldHasValueReceiver } from "../objects/value-fields.js";
import { planRustReceiverAlias } from "../objects/polymorphism/receiver-aliases.js";
import { planOptionalChainExpression } from "./optional-chains.js";
import { rustOperationFact } from "./fundamentals.js";
import { finishProviderOperationExpression, planProviderOperationExpression } from "./conversions.js";
import { planExpression } from "./entry.js";
import { rustSourceStorageView } from "./input-shaping.js";
import { planRustSharedReceiver, requireRustReadOwnership } from "./typed-locations.js";
import { planRustSourceUnionFieldProjection, readRustUnionField } from "./unions.js";
import { planRustBuiltinErrorProperty } from "./builtin-errors.js";
import { planRustBorrowedElementRead } from "./borrowed-element-reads.js";
import { planRustComputedMemberExpression } from "./computed-members.js";
import { planRustUnionProperty } from "./union-properties.js";
import { planRustIndexedFieldRead } from "./indexed-locations.js";

export function planPropertyAccess(node: Node, context: RustPlanContext): RustExpr | undefined {
  const borrowed = context.input.program.records.borrowedElementRead.get(node);
  if (borrowed !== undefined) return planRustComputedMemberExpression(node, context,
    selected => planRustBorrowedElementRead(node, borrowed, selected, planPropertyAccessInner));
  return planOptionalChainExpression(node, context, selected => planRustComputedMemberExpression(node, selected,
    input => planPropertyAccessInner(node, input)));
}

function planPropertyAccessInner(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  switch (fact?.kind) {
    case "source-indexed-field": return planRustIndexedFieldRead(node, fact, context);
    case "union-property": return planRustUnionProperty(node, fact, context);
    case "source-index-signature": return planRustSourceIndexRead(node, fact, context, planExpression);
    case "builtin-error-property": return planRustBuiltinErrorProperty(node, fact, context);
    case "source-method-property": return planSourceMethodPropertyRead(node, fact, context);
    case "source-accessor": {
      const selected = fact.read ?? failRustPlannerInvariant("An admitted property read requires its exact native getter.", node);
      const value = planRustSourceAccessorCall(node, fact, "read", [], context);
      return value === undefined ? undefined : finishRustSourceAccessorCall(node, selected.declaration, "read", value, context);
    }
    case "source-static-field": return readRustSourceStaticField(fact, context)
      ?? failRustPlannerInvariant("An admitted static property requires its exact native storage path.", node);
    case "source-field": return planSourceFieldRead(node, fact, context);
    case "source-union-field": return planSourceUnionFieldRead(node, fact, context);
    case "source-enum-member": {
      const owner = rustTypeFromCarrierInContext(fact.resultCarrier, context)
        ?? failRustPlannerInvariant("An admitted enum member requires its exact native owner type.", node);
      return { kind: "associated-value", owner, name: fact.name };
    }
    case "provider-operation": {
      if (fact.abi.operationKind !== "property" || fact.abi.sourceArguments.length !== 0)
        failRustPlannerInvariant("An admitted provider property requires its exact zero-argument native ABI.", node);
      const value = planProviderOperationExpression(context, fact, Node_Expression(context.input.program.source.ast, node), [], node, { resultUse: "value" });
      if (value === undefined) failRustPlannerInvariant("An admitted provider property requires its complete native operation syntax.", node);
      return finishProviderOperationExpression(context, fact, value, node);
    }
    default: return failRustPlannerInvariant("An admitted property requires its selected native member operation.", node);
  }
}

function planSourceFieldRead(node: Node, fact: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>,
  context: RustPlanContext): RustExpr | undefined {
  if (rustSourceFieldHasValueReceiver(node, context)) {
    const location = planRustValueFieldLocation(node, context, "read");
    if (location === undefined) failRustPlannerInvariant("An admitted value field requires its exact native read place.", node);
    return location.bindings.length === 0 ? location.read : rustValueBlock(location.bindings, location.read);
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const storage = receiverNode === undefined ? undefined : rustSourceStorageView({ stage: "source", node: receiverNode }, context);
  const location = storage === undefined ? undefined : context.valueFieldLocations?.get(storage) ??
    (rustSourceFieldHasValueReceiver(storage, context) ? planRustValueFieldLocation(storage, context, "read") : undefined);
  if (location?.withRead !== undefined && fact.dispatch === undefined && fact.valueSemantics.kind === "stored" &&
    rustStoredObjectFieldSupportsBorrowedRead(fact.storage, fact.receiverCarrier, fact.storageIndex, context)) {
    const read = location.withRead(receiver => readRustStoredObjectField(fact.storage, fact.receiverCarrier, receiver, fact.storageIndex, fact.resultCarrier, context));
    if (read === undefined) failRustPlannerInvariant("An admitted borrowed field requires its native stored value.", node);
    return location.bindings.length === 0 ? read : rustValueBlock(location.bindings, read);
  }
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context, "value",
    fact.valueSemantics.kind === "stored" && requireRustReadOwnership(receiverNode, context).value.kind === "borrow"
      ? "shared-receiver" : "value");
  if (receiverNode === undefined || receiver === undefined) failRustPlannerInvariant("An admitted source field requires its native receiver.", node);
  if (fact.valueSemantics.kind === "receiver-alias" && fact.dispatch === undefined) {
    if (fact.accessMode !== "read") failRustPlannerInvariant("An admitted receiver-alias value requires its exact native read role.", node);
    return planRustReceiverAlias(receiver, fact.receiverCarrier, fact.resultCarrier, context);
  }
  if (fact.dispatch === undefined) return readRustStoredObjectField(fact.storage, fact.receiverCarrier, receiver, fact.storageIndex, fact.resultCarrier, context);
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted field dispatch requires its native hygienic scope.", node);
  const selected = fact.declaration === undefined ? undefined : context.input.program.records.projectFieldDispatch.get(fact.declaration);
  if (selected === undefined) failRustPlannerInvariant("An admitted field dispatch requires its exact native field plan.", node);
  const role = planRustProjectFieldDispatchRole(selected, "read", context);
  if (role === undefined) failRustPlannerInvariant("An admitted field dispatch requires its native read ABI.", node);
  const name = allocateRustSyntheticName(names, "dispatch_receiver");
  const read = readRustProjectDispatchedField({ kind: "path", path: name }, fact.dispatch.read, role);
  if (read === undefined) failRustPlannerInvariant("An admitted field dispatch requires its native read syntax.", node);
  return rustValueBlock([{ name, value: planRustSharedReceiver(receiverNode, receiver, context) }], read);
}

function planSourceMethodPropertyRead(node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-method-property" }>, context: RustPlanContext): RustExpr {
  const source = Node_Expression(context.input.program.source.ast, node);
  const receiver = source === undefined ? undefined : planExpression(source, context);
  const names = context.syntheticNames;
  if (receiver === undefined || names === undefined) failRustPlannerInvariant("An admitted bound method requires its native receiver and hygienic scope.", node);
  const name = allocateRustSyntheticName(names, "method_receiver");
  return rustValueBlock([{ name, value: receiver }], planRustBoundProjectMethodCallable(fact.declaration, fact.receiverCarrier,
    { kind: "path", path: name }, fact.callableCarrier, context));
}

export function planRustBoundProjectMethodCallable(declaration: Node, receiverCarrier: TargetTypeRef, receiver: RustExpr,
  callableCarrier: TargetTypeRef, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.boundMethod.get(declaration, receiverCarrier, callableCarrier)
    ?? failRustPlannerInvariant("An admitted bound method requires its exact native dispatch and callable ABI.", declaration);
  const type = rustTypeFromCarrierInContext(callableCarrier, context);
  const names = context.syntheticNames;
  if (type === undefined || names === undefined) failRustPlannerInvariant("An admitted bound method requires its native callable type and hygienic scope.", declaration);
  const name = allocateRustSyntheticName(names, "method_arguments");
  const call: RustExpr = { kind: "method-call", method: selected.method,
    receiver: selected.dispatch ? { kind: "method-call", receiver: { kind: "field", receiver, name: rustProjectObjectDispatchField }, method: "clone", args: [] } : receiver,
    args: selected.parameters.map((_parameter, index) => ({ kind: "field", receiver: { kind: "path", path: name }, name: String(index) })) };
  context.usedAliases?.add("rt");
  return { kind: "associated-call", owner: type, method: "new", args: [{ kind: "closure-block",
    params: [{ name, mutable: false }], move: true, async: false, body: { statements: [{ kind: "tail",
      expr: selected.fallible ? call : { kind: "call", path: "Ok", args: [call] } }] } }] };
}

function planSourceUnionFieldRead(node: Node, fact: Extract<RustTargetOperationFact, { readonly kind: "source-union-field" }>,
  context: RustPlanContext): RustExpr | undefined {
  const source = Node_Expression(context.input.program.source.ast, node);
  const receiver = source === undefined ? undefined : planExpression(source, context);
  if (receiver === undefined) failRustPlannerInvariant("An admitted source-union field requires its native receiver.", node);
  return planRustSourceUnionFieldProjection(node, receiver, fact, context, (payload, field, index) => {
    if (field.valueSemantics.kind === "receiver-alias" && field.dispatch === undefined)
      return planRustReceiverAlias({ kind: "method-call", receiver: payload, method: "clone", args: [] }, fact.variants[index]!.carrier, fact.resultCarrier, context);
    return readRustUnionField(field, fact.variants[index]!.carrier, payload, fact.resultCarrier, context);
  });
}

export function planRustSourceAccessorCall(node: Node,
  fact: Pick<Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>, "read" | "write" | "receiver" | "dispatch">,
  role: "read" | "write", args: readonly RustExpr[], context: RustPlanContext, receiverOverride?: RustExpr): RustExpr {
  const selected = role === "read" ? fact.read : fact.write;
  if (selected === undefined || args.length !== (role === "read" ? 0 : 1)) failRustPlannerInvariant("An admitted accessor requires its exact selected native role and arity.", node);
  if (fact.receiver.kind === "static") {
    const owner = rustCallTypeFromCarrierInContext(fact.receiver.typeCarrier, context)
      ?? failRustPlannerInvariant("An admitted static accessor requires its native owner type.", node);
    return { kind: "associated-call", owner, method: selected.method, args };
  }
  const source = receiverOverride === undefined ? Node_Expression(context.input.program.source.ast, node) : undefined;
  const receiver = receiverOverride ?? (source === undefined ? undefined : planExpression(source, context));
  if (receiver === undefined) failRustPlannerInvariant("An admitted instance accessor requires its native receiver.", node);
  if (fact.dispatch === undefined) {
    const self = context.input.program.records.selfMode.get(selected.declaration)
      ?? failRustPlannerInvariant("An admitted accessor requires its exact native receiver mode.", selected.declaration);
    return { kind: "method-call", receiver, method: selected.method, args, receiverMode: self.mode };
  }
  return { kind: "method-call", receiver: { kind: "method-call", receiver: { kind: "field", receiver, name: rustProjectObjectDispatchField },
    method: "clone", args: [] }, method: selected.method, args };
}

export function finishRustSourceAccessorCall(node: Node, declaration: Node, role: "read" | "write", expression: RustExpr,
  context: RustPlanContext): RustExpr | undefined {
  const effect = context.input.program.records.sourceAccessorEffects.get(node)?.[role]
    ?? failRustPlannerInvariant("An admitted accessor requires its exact post-fixpoint effect.", node);
  return finishRustSourceAccessorEffect(node, declaration, expression, context, effect);
}

export function finishRustSourceAccessorEffect(node: Node, declaration: Node, expression: RustExpr, context: RustPlanContext,
  effect: "infallible" | "fallible"): RustExpr | undefined {
  if (effect === "infallible") return expression;
  const region = context.fallibleBoundary;
  const source = rustErrorBoundaryForProjectMember(declaration, context);
  if (region === undefined || source === undefined) failRustPlannerInvariant("An admitted fallible accessor requires its exact active native error boundary.", node);
  return rustPropagateLocalError(region, rustErrorType(source), expression);
}
