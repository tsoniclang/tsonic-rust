import type { RustOperationAnalysisContext } from "../../../program/operation-context.js";
import { rustCallableProtocol } from "../../../../target-model/types/index.js";

import { resolveRustTargetTypeRef } from "../../../source-evidence/types/resolution/source.js";

import { selectedCallCalleeDeclaration } from "../operators.js";
import { selectRustOptionalChain } from "../../../../policy/operations/flow/optional-chains.js";

import type { RustCheckedCallSelectionInput } from "../../../../policy/model/contracts.js";

import type { RustOperationsProviderOptions } from "../model.js";
import type { RustOptionalCallGuard } from "../../../../target-model/records/calls/optional-calls.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

import { selectedCallReceiverValueCarrier } from "./instantiation.js";
type RustOptionalCallResult =
  | {
      readonly kind: "resolved";
      readonly resultCarrier: TargetTypeRef;
      readonly fact?: import("../../../../target-model/operations/model.js").RustOptionalChainFact;
    }
  | { readonly kind: "rejected"; readonly message: string };

export function selectRustOptionalCallResult(
  request: RustCheckedCallSelectionInput,
  innerResultCarrier: TargetTypeRef,
  context: RustOperationAnalysisContext,
  options: RustOperationsProviderOptions,
  exactGuard?: RustOptionalCallGuard,
): RustOptionalCallResult {
  if (!request.source.optionalChain) {
    return { kind: "resolved", resultCarrier: innerResultCarrier };
  }
  const receiver = request.source.sourceReceiver;
  const guard = exactGuard?.guard ?? receiver?.expression ?? request.source.sourceCallee.expression;
  const receiverType = receiver === undefined ? undefined : context.currentSemantics.types.expressionType(receiver.expression);
  const sourceGuardCarrier = exactGuard?.sourceGuardCarrier ?? (receiver === undefined
    ? resolveRustTargetTypeRef(
        selectedCallCalleeDeclaration(request) ?? request.source.sourceCallee.expression,
        context,
        options,
      )
    : resolveRustTargetTypeRef(receiverType, context, options));
  const selectedGuardCarrier = exactGuard?.selectedGuardCarrier ?? (receiver === undefined
    ? resolveRustTargetTypeRef(
        request.sourceSelectedDeclaration,
        context,
        options,
      )
    : selectedCallReceiverValueCarrier(request, context, options));
  if (rustCallableProtocol(selectedGuardCarrier) === undefined &&
    selectedGuardCarrier?.kind !== "function-pointer" && receiver === undefined) {
    return {
      kind: "rejected",
      message: "Optional direct calls require exact callable selected-signature evidence.",
    };
  }
  const selection = selectRustOptionalChain({
    expression: request.source.call,
    guard,
    operationKind: "method",
    sourceGuardCarrier,
    selectedGuardCarrier,
    innerResultCarrier,
  });
  if (selection.kind === "rejected") {
    return selection;
  }
  return selection.kind === "direct"
    ? { kind: "resolved", resultCarrier: selection.resultCarrier }
    : {
        kind: "resolved",
        resultCarrier: selection.fact.resultCarrier,
        fact: selection.fact,
      };
}
