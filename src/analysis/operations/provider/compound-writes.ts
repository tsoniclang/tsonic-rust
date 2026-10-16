import { requireRustRecord } from "../../program/records/required-records.js";
import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { selectJsSurfaceMemberWrite } from "../../../policy/operations/source-profiles/js/member-reads.js";
import { selectRustSourceProfileIndexMembers } from "./selected-members.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { finalizeRustProviderOperationAbi } from "../finalized-operation/finalize.js";

import { rustOperationContext, type RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustEffectiveValueCarrier } from "../../conversions/value-carrier-queries.js";
import { selectRustProviderSourceReceiver } from "./source-qualifiers.js";

export function recordRustCompoundWrite(
  walk: RustFactWalk,
  expression: Node,
  left: Node,
  resultCarrier: TargetTypeRef,
): void {
  walk.context.records.assertOpen();
  const fact = selectRustCompoundWrite(walk, left, resultCarrier);
  if (fact !== undefined) {
    requireRustRecord(walk.context.requiredRecords, "compoundWrite", expression, fact.operationId, "recordRustCompoundWrite");
    walk.context.records.compoundWrites.index(expression, fact.operationId, fact.abi);
  }
}

export function selectRustCompoundWrite(
  walk: RustFactWalk,
  left: Node,
  resultCarrier: TargetTypeRef,
): Extract<import("../../../target-model/records/operations.js").RustTargetOperationFact, { kind: "runtime-set" }> | undefined {
  if (!walk.jsEnabled || walk.context.ast.kindName(left) !== "KindElementAccessExpression") return;
  const context = rustOperationContext(walk, left);
  const selected = context.semanticsFor(left).operations.elementAccess(left);
  const members = selected === undefined ? undefined : selectRustSourceProfileIndexMembers({
    expression: left, receiver: selected.receiver.expression, sourceReceiverType: selected.receiver.type,
    sourceArgumentType: selected.argument.type,
  }, context, walk.operationOptions);
  const receiver = Node_Expression(context.ast, left);
  const index = ElementAccessExpression_ArgumentExpression(context.ast, left);
  const receiverCarrier = rustEffectiveValueCarrier(context.records, receiver);
  const indexCarrier = context.records.runtimeCarrier.get(index)?.carrier;
  if (members?.profile !== "js" || receiverCarrier === undefined || indexCarrier === undefined) return;
  const selection = selectJsSurfaceMemberWrite(members.members, {
    operationKind: "index-set",
    receiverCarrier, argumentCarriers: [indexCarrier, resultCarrier],
  }, members.readonly, context.typeDefinitions);
  if (selection?.fact.kind !== "runtime-set" ||
    !rustTargetTypeRefEquals(selection.parameterCarriers?.[1], resultCarrier)) return;
  const sourceReceiver = receiver === undefined ? undefined
    : selectRustProviderSourceReceiver(receiver, receiverCarrier, context, walk.operationOptions);
  if (sourceReceiver === undefined) return;
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "index-set", form: selection.fact.target,
    sourceReceiver,
    sourceArgumentCarriers: [indexCarrier, resultCarrier],
    declaredSourceArgumentCarriers: selection.parameterCarriers,
    resultCarrier: rustUnitTargetType(), isAsync: false, isFallible: selection.fact.fallible === true,
    ...(selection.fact.fallible === true ? { errorBoundary: "source-program" as const } : {}),
  }, context.typeDefinitions);
  return abi === undefined ? undefined : {
    kind: "runtime-set", operationId: selection.fact.operationId, abi,
  };
}
