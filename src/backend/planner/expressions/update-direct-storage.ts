import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../target-model/records/operations/finalized-operation.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustDirectStorageEmission } from "../../../target-model/records/storage/direct-storage.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustFinalizedInputPlanOverrides } from "../project/provider-evaluation-scope.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustSourceBindingPath } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustCapturedBinding, type RustExpressionPlanner } from "./typed-locations.js";
import { planRustUnionProjection } from "./union-mappings.js";

export type RustProviderOperationExpressionPlanner = (context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>, receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[], operationNode: Node,
  options: { readonly resultUse: "value" | "storage"; readonly overrides?: RustFinalizedInputPlanOverrides }) => RustExpr | undefined;

export function planRustDirectStorageCore(operand: Node, context: RustPlanContext,
  inputOverrides: ReadonlyMap<RustFinalizedSourceInput, RustExpr> | undefined,
  planExpression: RustExpressionPlanner, planProviderOperation: RustProviderOperationExpressionPlanner): RustExpr | undefined {
  const override = context.expressionOverrides?.get(operand);
  if (override !== undefined) return override.valueForm === "storage" ? override.expression : undefined;
  const selected = context.input.program.records.directStorage.get(operand)
    ?? failRustPlannerInvariant("An admitted storage query requires its sealed native place selection.", operand);
  if (selected.kind === "unavailable") return undefined;
  const expression = planRustSelectedDirectStorage(operand, selected, context, inputOverrides, planExpression, planProviderOperation);
  return expression === undefined || selected.projection === undefined ? expression : { kind: "dereference", pointer: planRustUnionProjection(
    operand, expression, selected.projection.emission,
    selected.projection.access === "mutable" ? "mutable-reference" : "shared-reference", context) };
}

function planRustSelectedDirectStorage(operand: Node, selected: Exclude<RustDirectStorageEmission, { readonly kind: "unavailable" }>,
  context: RustPlanContext, inputOverrides: ReadonlyMap<RustFinalizedSourceInput, RustExpr> | undefined,
  planExpression: RustExpressionPlanner, planProviderOperation: RustProviderOperationExpressionPlanner): RustExpr | undefined {
  if (selected.kind === "identifier") {
    const captured = rustCapturedBinding(operand, context);
    if (captured !== undefined) {
      if (captured.storage !== "value") return undefined;
      return captured.borrowed === undefined ? captured.expression : { kind: "dereference", pointer: captured.expression };
    }
    const binding = context.input.program.records.sourceBinding.get(operand)
      ?? failRustPlannerInvariant("An admitted direct binding requires its exact source identity.", operand);
    const path = rustSourceBindingPath(context, binding)
      ?? failRustPlannerInvariant("An admitted direct binding requires its native name path.", operand);
    return { kind: "path", path };
  }
  if (selected.kind === "this") return { kind: "path", path: "self" };
  if (selected.kind === "parenthesized") return planRustDirectStorageCore(selected.inner, context, inputOverrides, planExpression, planProviderOperation);
  if (selected.kind === "field") {
    const receiver = planRustDirectStorageCore(selected.receiver, context, inputOverrides, planExpression, planProviderOperation);
    return receiver === undefined ? undefined : selected.path.reduce<RustExpr>((value, name) => ({ kind: "field", receiver: value, name }), receiver);
  }
  if (selected.kind === "provider") {
    const inputs = new Map(inputOverrides ?? []);
    if (selected.receiverInput !== undefined) {
      const receiver = selected.receiver ?? failRustPlannerInvariant("An admitted provider place requires its native receiver.", operand);
      const explicit = context.expressionOverrides?.get(receiver);
      const storage = explicit?.valueForm === "storage" ? explicit.expression
        : planRustDirectStorageCore(receiver, context, inputOverrides, planExpression, planProviderOperation);
      if (storage === undefined) return undefined;
      if (!directStorageRemainsSelected(receiver, selected.index === undefined ? [] : [selected.index], explicit?.valueForm === "storage", context))
        failRustPlannerInvariant("An admitted provider place requires stable selected receiver storage.", operand);
      inputs.set(selected.receiverInput, storage);
    }
    return planProviderOperation(context, selected.operation, selected.receiver,
      selected.index === undefined ? [] : [selected.index], operand,
      { resultUse: "storage", ...(inputs.size === 0 ? {} : { overrides: { sourceValues: new Map(), inputs } }) });
  }
  const explicit = context.expressionOverrides?.get(selected.receiver);
  const receiver = explicit?.valueForm === "storage" ? explicit.expression
    : planRustDirectStorageCore(selected.receiver, context, inputOverrides, planExpression, planProviderOperation);
  if (receiver === undefined) return undefined;
  const target: RustExpr = selected.kind === "tuple" ? { kind: "field", receiver, name: String(selected.position) }
    : { kind: "index", receiver, index: { kind: "int-literal", text: String(selected.position) } };
  if (!selected.evaluateIndex) return target;
  if (!directStorageRemainsSelected(selected.receiver, [selected.index], explicit?.valueForm === "storage", context))
    failRustPlannerInvariant("An admitted indexed place requires stable selected receiver storage.", operand);
  const effect = planExpression(selected.index, context)
    ?? failRustPlannerInvariant("An admitted indexed place requires its original index evaluation.", selected.index);
  return { kind: "evaluate-then", effect, discard: "value", value: target };
}

export function directStorageRemainsSelected(receiver: Node, laterExpressions: readonly Node[],
  receiverAlreadySelected: boolean, context: RustPlanContext): boolean {
  if (receiverAlreadySelected || laterExpressions.length === 0) return true;
  const identity = context.input.program.records.directStorageIdentity.get(receiver)
    ?? failRustPlannerInvariant("An admitted writable projection requires its sealed native storage identity.", receiver);
  for (const node of laterExpressions) {
    const effectful = context.input.program.records.storageEffectful.get(node)
      ?? failRustPlannerInvariant("An admitted writable projection requires its sealed source effects.", node);
    if (effectful && (!identity.resolved || identity.invalidatedRoots.has(node))) return false;
  }
  return true;
}
