import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { RustTargetOperationFact } from "../../../analysis/facts/operations/facts.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustRecordFieldResult } from "../objects/record-fields.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustValueFieldLocation } from "../objects/value-fields.js";
import { rustMutatedBindingFactKey, rustSourceBindingFactKey } from "../../../analysis/facts/keys.js";
import { rustLocationStorageForReference, planRustNonConsumingValue } from "./typed-locations.js";

export type RustIndexedFieldOperation = Extract<RustTargetOperationFact, { readonly kind: "source-indexed-field" }>;

export function planRustIndexedFieldLocation(
  node: Node, fact: RustIndexedFieldOperation, context: RustPlanContext, access: "read" | "write",
): RustValueFieldLocation | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const ast = context.input.program.source.ast;
  const receiverNode = Node_Expression(ast, node);
  const keyNode = ElementAccessExpression_ArgumentExpression(ast, node);
  const plannedReceiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const direct = receiverNode === undefined || plannedReceiver === undefined ? undefined
    : planRustNonConsumingValue(receiverNode, plannedReceiver, context);
  const binding = receiverNode === undefined ? undefined : context.input.program.facts.getFact(receiverNode, rustSourceBindingFactKey);
  const stable = (direct?.kind === "path" || direct?.kind === "reference") && binding !== undefined &&
    context.input.program.facts.getFact(binding.sourceDeclaration, rustMutatedBindingFactKey) === undefined &&
    rustLocationStorageForReference(receiverNode!, context) === undefined;
  const receiver = stable ? direct : plannedReceiver;
  const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
  if (receiver === undefined || key === undefined || keyNode === undefined) return undefined;
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "field_owner");
  const keyName = allocateRustSyntheticName(context.syntheticNames, "field_key");
  const owner: RustExpr = stable ? receiver : { kind: "path", path: receiverName };
  const keyReference: RustExpr = { kind: "path", path: keyName };
  const read = planRustIndexedFieldCall(fact, { kind: "reference", expr: owner }, keyReference, undefined, context);
  if (read === undefined) return undefined;
  return {
    bindings: [
      ...(stable ? [] : [{ name: receiverName, value: receiver }]),
      { name: keyName, value: planRustSharedReceiver(keyNode, key, context) },
    ], read,
    write: value => access !== "write" ? undefined : planRustIndexedFieldCall(fact,
      { kind: "reference", expr: owner }, keyReference, value, context),
  };
}

export function planRustIndexedFieldRead(node: Node, fact: RustIndexedFieldOperation, context: RustPlanContext): RustExpr | undefined {
  const ast = context.input.program.source.ast;
  const receiverNode = Node_Expression(ast, node);
  const keyNode = ElementAccessExpression_ArgumentExpression(ast, node);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const key = keyNode === undefined ? undefined : planExpression(keyNode, context);
  if (receiverNode === undefined || receiver === undefined || keyNode === undefined || key === undefined) return undefined;
  return planRustIndexedFieldCall(fact, planRustSharedReceiver(receiverNode, receiver, context),
    planRustSharedReceiver(keyNode, key, context), undefined, context);
}

export function planRustIndexedFieldCall(
  fact: RustIndexedFieldOperation,
  receiver: RustExpr,
  key: RustExpr,
  value: RustExpr | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const owner = rustTypeFromCarrierInContext(fact.receiverCarrier, context);
  const keyType = rustTypeFromCarrierInContext(fact.keyCarrier, context);
  const error = rustTypeFromCarrierInContext(rustProgramErrorTargetType(), context);
  if (owner === undefined || keyType === undefined || error === undefined) return undefined;
  context.usedAliases?.add("rt");
  const trait: RustType = { kind: "named", path: value === undefined ? "rt::ReadField" : "rt::WriteField",
    genericArguments: [{ kind: "type", type: keyType }, { kind: "type", type: error }] };
  return rustRecordFieldResult({ kind: "associated-call", owner, trait,
    method: value === undefined ? "read_field" : "write_field",
    args: value === undefined ? [receiver, key] : [receiver, key, value],
  }, context);
}
