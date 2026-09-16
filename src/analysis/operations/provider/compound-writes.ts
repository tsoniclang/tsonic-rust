import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { resolveSelectedJsSourceMember } from "../../../policy/evidence/selected-source.js";
import { selectJsSurfaceOperation } from "../../../policy/operations/js-surface.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { finalizeRustProviderOperationAbi } from "../../facts/finalized-operation-abi.js";
import { rustCompoundWriteFactKey } from "../../facts/operations/keys.js";
import { rustOperationContext, type RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export function recordRustCompoundWrite(
  walk: RustFactWalk,
  expression: Node,
  left: Node,
  resultCarrier: TargetTypeRef,
): void {
  if (!walk.jsEnabled || walk.context.ast.kindName(left) !== "KindElementAccessExpression") return;
  const context = rustOperationContext(walk, left);
  const selected = context.facts.getSelectedTargetOperator(left);
  const identity = resolveSelectedJsSourceMember(context,
    selected?.provenance?.sourceSelectedWriteDeclaration ?? selected?.provenance?.sourceSelectedDeclaration,
    walk.sourceProfiles);
  const receiver = Node_Expression(context.ast, left);
  const index = ElementAccessExpression_ArgumentExpression(context.ast, left);
  const receiverCarrier = context.facts.getRuntimeCarrierFact(receiver)?.carrier;
  const indexCarrier = context.facts.getRuntimeCarrierFact(index)?.carrier;
  if (identity === undefined || receiverCarrier === undefined || indexCarrier === undefined) return;
  const selection = selectJsSurfaceOperation({
    ownerName: identity.ownerName, memberName: identity.memberName, operationKind: "index-set",
    receiverCarrier, argumentCarriers: [indexCarrier, resultCarrier],
  }, context.typeDefinitions);
  if (selection?.fact.kind !== "runtime-set" ||
    !rustTargetTypeRefEquals(selection.parameterCarriers?.[1], resultCarrier)) return;
  const abi = finalizeRustProviderOperationAbi({
    operationKind: "index-set", form: selection.fact.target,
    sourceReceiverCarrier: receiverCarrier,
    sourceArgumentCarriers: [indexCarrier, resultCarrier],
    declaredSourceArgumentCarriers: selection.parameterCarriers,
    resultCarrier: rustUnitTargetType(), isAsync: false, isFallible: false,
  }, context.typeDefinitions);
  if (abi !== undefined) context.facts.set(expression, rustCompoundWriteFactKey, {
    kind: "runtime-set", operationId: selection.fact.operationId, abi,
  }, [{ message: "rust exact selected compound-write index ABI" }]);
}
