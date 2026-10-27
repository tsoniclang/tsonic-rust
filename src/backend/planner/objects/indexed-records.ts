import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustIndexedRecordStorage } from "../../../target-model/records/objects/indexed-records.js";
import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { planExpression as planRustExpression } from "../expressions/entry.js";
import { planRustSharedReceiver } from "../expressions/typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectStateType } from "./polymorphism/names.js";
import { createRustProjectObject } from "./project-objects.js";
import { copyRustProjectObjectIndexStorage, readRustProjectObjectIndex, writeRustProjectObjectIndex } from "./project-index-storage.js";

type SourceIndexFact = Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>;
type ExpressionPlanner = typeof planRustExpression;

export function planRustSourceIndexKey(
  node: Node, _fact: SourceIndexFact, context: RustPlanContext, planExpression: ExpressionPlanner, borrowed: boolean,
): RustExpr {
  const selected = context.input.program.records.indexedRecordAccess.get(node);
  if (selected === undefined) failRustPlannerInvariant("An admitted index access requires its exact native key plan.", node);
  if (selected.key.kind === "literal") return { kind: borrowed ? "str-literal" : "string-literal", value: selected.key.value };
  const expression = planExpression(selected.key.expression, context, "value", borrowed ? "shared-reference" : "value");
  if (expression === undefined) failRustPlannerInvariant("An admitted index access requires its native key expression.", selected.key.expression);
  return expression;
}

export function planRustSourceIndexRead(
  node: Node, fact: SourceIndexFact, context: RustPlanContext, planExpression: ExpressionPlanner,
): RustExpr {
  const selected = context.input.program.records.indexedRecordAccess.get(node);
  if (selected === undefined || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted index read requires its sealed receiver/key plan and hygienic scope.", node);
  const receiver = planExpression(selected.receiver, context);
  const key = planRustSourceIndexKey(node, fact, context, planExpression, true);
  const storage = planRustIndexedRecordStorage(fact.receiverCarrier, fact.keyCarrier, fact.resultCarrier, fact.storage, context);
  if (receiver === undefined) failRustPlannerInvariant("An admitted index read requires its native receiver value.", selected.receiver);
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_receiver");
  const keyName = allocateRustSyntheticName(context.syntheticNames, "index_key");
  return rustValueBlock([
    { name: receiverName, value: planRustSharedReceiver(selected.receiver, receiver, context) },
    { name: keyName, value: key },
  ], storage.read({ kind: "path", path: receiverName }, { kind: "path", path: keyName }));
}

export function planRustIndexedRecordStorage(
  carrier: TargetTypeRef, key: TargetTypeRef, value: TargetTypeRef, storage: RustIndexedRecordStorage, context: RustPlanContext,
) {
  const selected = context.input.program.records.indexedRecordStorage.get(carrier, key, value, storage);
  if (selected === undefined) failRustPlannerInvariant("An admitted indexed record requires its exact native storage contract.");
  const type = rustTypeFromCarrierInContext(selected.carrier, context);
  if (type === undefined) failRustPlannerInvariant("An admitted indexed record requires its native carrier syntax.");
  if (selected.kind === "record") {
    context.usedAliases?.add("rt");
    return {
      read(receiver: RustExpr, index: RustExpr): RustExpr { return { kind: "method-call", receiver, method: selected.read, args: [index] }; },
      write(receiver: RustExpr, index: RustExpr, item: RustExpr): RustExpr { return { kind: "method-call", receiver, method: "set", args: [index, item] }; },
      copyEntries(receiver: RustExpr, destination: RustExpr): RustExpr { return { kind: "method-call", receiver, method: "copy_entries_to", args: [{ kind: "reference", mutable: true, expr: destination }] }; },
      construct(entries: RustExpr): RustExpr { return { kind: "associated-call", owner: type, method: "from_map", args: [entries] }; },
    };
  }
  const state = rustProjectStateType(selected.carrier, context);
  if (type.kind !== "named" || state?.kind !== "named") failRustPlannerInvariant("An admitted indexed project record requires its native wrapper and state types.");
  return {
    read(receiver: RustExpr, index: RustExpr): RustExpr { return readRustProjectObjectIndex(receiver, selected.name, index, value, selected.representation, context); },
    write(receiver: RustExpr, index: RustExpr, item: RustExpr): RustExpr | undefined { return writeRustProjectObjectIndex(receiver, selected.name, index, item, selected.representation); },
    copyEntries(receiver: RustExpr, destination: RustExpr): RustExpr { context.usedAliases?.add("rt"); return copyRustProjectObjectIndexStorage(receiver, selected.name, destination, selected.representation); },
    construct(entries: RustExpr): RustExpr { return createRustProjectObject(type.path, state.path, [{ name: selected.name, value: entries }], selected.representation); },
  };
}
