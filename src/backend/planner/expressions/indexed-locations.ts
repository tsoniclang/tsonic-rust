import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustRecordFieldResult } from "../objects/record-fields.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustValueFieldLocation } from "../objects/value-fields.js";

export type RustIndexedFieldOperation = Extract<RustTargetOperationFact, { readonly kind: "source-indexed-field" }>;

export function planRustIndexedFieldLocation(node: Node, fact: RustIndexedFieldOperation,
  context: RustPlanContext, access: "read" | "write"): RustValueFieldLocation {
  const selected = context.input.program.records.indexedLocation.get(node)
    ?? failRustPlannerInvariant("An admitted indexed field requires its sealed native location.", node);
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted indexed location requires its native name scope.", node);
  const receiver = planExpression(selected.receiver, context)
    ?? failRustPlannerInvariant("An admitted indexed location requires its native receiver.", selected.receiver);
  const key = selected.key === undefined ? rustIndexedPropertyKey(node, fact, context)
    : planExpression(selected.key, context) ?? failRustPlannerInvariant("An admitted indexed location requires its native key.", selected.key);
  const receiverName = allocateRustSyntheticName(names, "field_owner");
  const keyName = allocateRustSyntheticName(names, "field_key");
  // The field traits take the owner by reference: an evaluated owner is bound as a shared borrow, so later reads of the
  // same place (the read half of a compound or self-referencing write) still see it.
  const owner: RustExpr = selected.stableReceiver ? { kind: "reference", expr: receiver } : { kind: "path", path: receiverName };
  const keyReference: RustExpr = { kind: "path", path: keyName };
  return {
    bindings: [
      ...(selected.stableReceiver ? [] : [{ name: receiverName, value: planRustSharedReceiver(selected.receiver, receiver, context)
        ?? failRustPlannerInvariant("An admitted indexed location requires its shared native owner.", selected.receiver) }]),
      { name: keyName, value: selected.key === undefined ? { kind: "reference", expr: key }
        : planRustSharedReceiver(selected.key, key, context) ?? failRustPlannerInvariant("An admitted indexed key requires its native shared read.", selected.key) },
    ],
    read: planRustIndexedFieldCall(node, fact, owner, keyReference, undefined, context),
    write: value => access === "write"
      ? planRustIndexedFieldCall(node, fact, owner, keyReference, value, context) : undefined,
  };
}

export function planRustIndexedFieldRead(node: Node, fact: RustIndexedFieldOperation, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.indexedLocation.get(node)
    ?? failRustPlannerInvariant("An admitted indexed read requires its sealed native location.", node);
  const receiver = planExpression(selected.receiver, context)
    ?? failRustPlannerInvariant("An admitted indexed read requires its native owner.", selected.receiver);
  const key = selected.key === undefined ? rustIndexedPropertyKey(node, fact, context)
    : planExpression(selected.key, context) ?? failRustPlannerInvariant("An admitted indexed read requires its native key.", selected.key);
  return planRustIndexedFieldCall(node, fact,
    planRustSharedReceiver(selected.receiver, receiver, context)
      ?? failRustPlannerInvariant("An admitted indexed read requires its shared native owner.", selected.receiver),
    selected.key === undefined ? { kind: "reference", expr: key }
      : planRustSharedReceiver(selected.key, key, context)
        ?? failRustPlannerInvariant("An admitted indexed read requires its shared native key.", selected.key), undefined, context);
}

function rustIndexedPropertyKey(node: Node, fact: RustIndexedFieldOperation, context: RustPlanContext): RustExpr {
  const type = rustTypeFromCarrierInContext(fact.keyCarrier, context);
  if (type?.kind !== "named") failRustPlannerInvariant("An admitted indexed property requires its native field-key type.", node);
  return { kind: "path", path: type.path,
    genericArguments: type.genericArguments?.filter(argument => argument.kind === "type" || argument.kind === "const") };
}

export function planRustIndexedFieldCall(node: Node, fact: RustIndexedFieldOperation, receiver: RustExpr, key: RustExpr,
  value: RustExpr | undefined, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.indexedLocation.get(node)
    ?? failRustPlannerInvariant("An admitted indexed call requires its native location evidence.", node);
  const owner = rustTypeFromCarrierInContext(fact.receiverCarrier, context);
  const keyType = rustTypeFromCarrierInContext(fact.keyCarrier, context);
  const error = rustTypeFromCarrierInContext(selected.errorCarrier, context);
  if (owner === undefined || keyType === undefined || error === undefined)
    failRustPlannerInvariant("An admitted indexed call requires its exact native owner, key and error types.", node);
  context.usedAliases?.add("rt");
  const trait: RustType = { kind: "named", path: value === undefined ? "rt::ReadField" : "rt::WriteField",
    genericArguments: [{ kind: "type", type: keyType }, { kind: "type", type: error }] };
  return rustRecordFieldResult({ kind: "associated-call", owner, trait, method: value === undefined ? "read_field" : "write_field",
    args: value === undefined ? [receiver, key] : [receiver, key, value] }, context)
    ?? failRustPlannerInvariant("An admitted indexed call requires its native completion.", node);
}
