import { Node_Type } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustArrayEntryBinding, rustArrayEntryPayloadExcludesNullish } from "../control-flow/array-entry-values.js";
import { rustOptionalChainFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import {
  isRustAbsenceCarrier,
  isRustOptionCarrier,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";

export function selectedOptionNullishRelationship(
  walk: RustFactWalk,
  leftNode: Node,
  rightNode: Node,
  leftCarrier: TargetTypeRef | undefined,
  rightCarrier: TargetTypeRef | undefined,
): { readonly depths: readonly number[]; readonly negated: boolean } | undefined {
  const selected = (depths: readonly number[], negated = false) => Object.freeze({ depths: Object.freeze(depths), negated });
  const leftIsOption = isRustOptionCarrier(leftCarrier);
  const rightIsOption = isRustOptionCarrier(rightCarrier);
  const optionNode = leftIsOption && isRustAbsenceCarrier(rightCarrier)
    ? leftNode
    : rightIsOption && isRustAbsenceCarrier(leftCarrier)
      ? rightNode
      : undefined;
  const nullishNode = optionNode === leftNode
    ? rightNode
    : optionNode === rightNode
      ? leftNode
      : undefined;
  if (optionNode === undefined || nullishNode === undefined) {
    return undefined;
  }
  const selectedCarrier = optionNode === leftNode ? leftCarrier : rightCarrier;
  if (selectedCarrier?.kind === "target-named" && selectedCarrier.sourceAbsence === true ||
    rustOptionalStorageValue(selectedCarrier) !== undefined) return selected([0]);
  const optionalChain = walk.context.facts.get(optionNode, rustOptionalChainFactKey) ??
    walk.context.facts.resolve(optionNode, rustOptionalChainFactKey);
  if (optionalChain?.lowering === "map" &&
    rustTargetTypeRefEquals(optionalChain.resultCarrier, optionNode === leftNode ? leftCarrier : rightCarrier)) {
    return selected([0]);
  }
  if (rustArrayEntryBinding(walk, optionNode) !== undefined) {
    if (!rustArrayEntryPayloadExcludesNullish(walk, optionNode)) return undefined;
    return selected([0]);
  }
  const optionFact = walk.context.facts.get(optionNode, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(optionNode, rustTargetOperationFactKey) ??
    walk.preparedCallbackCalls.get(optionNode)?.prepared.template;
  const matchingDepths: number[] = [];
  let payloadDepth = 0;
  if (optionFact?.kind === "provider-operation" &&
    optionFact.sourceAbsenceCarrier !== undefined) {
    const comparedNullishCarrier = optionNode === leftNode ? rightCarrier : leftCarrier;
    if (comparedNullishCarrier === undefined) {
      return undefined;
    }
    if (rustTargetTypeRefEquals(optionFact.sourceAbsenceCarrier, comparedNullishCarrier)) {
      matchingDepths.push(0);
    }
    const payload = rustOptionElementCarrier(optionNode === leftNode ? leftCarrier : rightCarrier);
    if (isRustAbsenceCarrier(payload)) {
      if (!rustTargetTypeRefEquals(payload, optionFact.sourceResultCarrier)) return undefined;
      const presentMatches = rustTargetTypeRefEquals(payload, comparedNullishCarrier);
      return (matchingDepths.length === 1) === presentMatches
        ? selected([], presentMatches) : selected([0], presentMatches);
    }
    if (!isRustOptionCarrier(payload)) return selected(matchingDepths);
    if (!rustTargetTypeRefEquals(payload, optionFact.sourceResultCarrier)) return undefined;
    payloadDepth = 1;
  }
  const optionSemantics = walk.context.semanticsFor(optionNode);
  const nullishSemantics = walk.context.semanticsFor(nullishNode);
  let optionType = optionSemantics.types.expressionType(optionNode);
  let optionalDeclaration = false;
  if (optionFact?.kind === "provider-operation" &&
    walk.context.ast.kindName(optionNode) === "KindElementAccessExpression") {
    const access = optionSemantics.operations.elementAccess(optionNode);
    const selected = access === undefined ? undefined
      : optionSemantics.types.selectIndexedAccess(access.receiver.type, access.argument.type);
    if (selected?.kind !== "resolved") return undefined;
    optionType = selected.readType;
  }
  if (optionFact?.kind === "provider-operation" && payloadDepth === 0) {
    const access = walk.context.ast.kindName(optionNode) === "KindElementAccessExpression"
      ? optionSemantics.operations.elementAccess(optionNode)
      : walk.context.ast.kindName(optionNode) === "KindPropertyAccessExpression"
        ? optionSemantics.operations.propertyAccess(optionNode)
        : undefined;
    const annotation = Node_Type(walk.context.ast, access?.selectedDeclaration);
    optionalDeclaration = access?.selectedDeclaration !== undefined &&
      walk.context.ast.questionToken(access.selectedDeclaration) !== undefined;
    if (annotation !== undefined) {
      optionType = optionSemantics.types.authoredType(annotation);
    }
  }
  const nullishType = nullishSemantics.types.expressionType(nullishNode);
  if (optionType === undefined || nullishType === undefined ||
    !nullishSemantics.types.isNullish(nullishType)) {
    return undefined;
  }
  const members = optionSemantics.types.isUnion(optionType)
    ? optionSemantics.types.unionOrIntersectionTypes(optionType)
    : [optionType];
  const hasAbsence = optionalDeclaration || members.some((member) => optionSemantics.types.isNullish(member));
  if (!hasAbsence) {
    return undefined;
  }
  if (!matchingDepths.includes(payloadDepth)) {
    matchingDepths.push(payloadDepth);
  }
  return selected(matchingDepths);
}
