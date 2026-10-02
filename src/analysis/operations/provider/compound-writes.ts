import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { selectJsSurfaceMemberWrite } from "../../../policy/operations/source-profiles/js/member-reads.js";
import { selectRustSourceProfileIndexMembers } from "./selected-members.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { finalizeRustProviderOperationAbi } from "../../facts/finalized-operation-abi.js";
import { rustCompoundWriteFactKey } from "../../facts/operations/keys.js";
import { rustOperationContext, type RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustEffectiveValueCarrier } from "../../facts/value-carrier-queries.js";

export function recordRustCompoundWrite(
  walk: RustFactWalk,
  expression: Node,
  left: Node,
  resultCarrier: TargetTypeRef,
): void {
  const fact = selectRustCompoundWrite(walk, left, resultCarrier);
  if (fact !== undefined) walk.context.facts.set(expression, rustCompoundWriteFactKey,
    fact, [{ message: "rust exact selected compound-write index ABI" }]);
}

export function selectRustCompoundWrite(
  walk: RustFactWalk,
  left: Node,
  resultCarrier: TargetTypeRef,
): Extract<import("../../facts/keys.js").RustTargetOperationFact, { kind: "runtime-set" }> | undefined {
  if (!walk.jsEnabled || walk.context.ast.kindName(left) !== "KindElementAccessExpression") return;
  const context = rustOperationContext(walk, left);
  const selected = context.semanticsFor(left).operations.elementAccess(left);
  const members = selected === undefined ? undefined : selectRustSourceProfileIndexMembers({
    expression: left, receiver: selected.receiver.expression, sourceReceiverType: selected.receiver.type,
    sourceArgumentType: selected.argument.type,
  }, context, walk.operationOptions);
  const receiver = Node_Expression(context.ast, left);
  const index = ElementAccessExpression_ArgumentExpression(context.ast, left);
  const receiverCarrier = rustEffectiveValueCarrier(context.facts, receiver);
  const indexCarrier = context.facts.getRuntimeCarrierFact(index)?.carrier;
  if (members?.profile !== "js" || receiverCarrier === undefined || indexCarrier === undefined) return;
  const selection = selectJsSurfaceMemberWrite(members.members, {
    operationKind: "index-set",
    receiverCarrier, argumentCarriers: [indexCarrier, resultCarrier],
  }, members.readonly, context.typeDefinitions);
  if (selection?.fact.kind !== "runtime-set" ||
    !rustTargetTypeRefEquals(selection.parameterCarriers?.[1], resultCarrier)) return;
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "index-set", form: selection.fact.target,
    sourceReceiverCarrier: receiverCarrier,
    sourceArgumentCarriers: [indexCarrier, resultCarrier],
    declaredSourceArgumentCarriers: selection.parameterCarriers,
    resultCarrier: rustUnitTargetType(), isAsync: false, isFallible: selection.fact.fallible === true,
    ...(selection.fact.fallible === true ? { errorBoundary: "source-program" as const } : {}),
  }, context.typeDefinitions);
  return abi === undefined ? undefined : {
    kind: "runtime-set", operationId: selection.fact.operationId, abi,
  };
}
