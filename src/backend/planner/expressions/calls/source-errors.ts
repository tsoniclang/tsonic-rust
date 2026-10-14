import type { Node } from "@tsonic/tsts";
import type { RustSourceErrorEffectEdge } from "../../../../target-model/records/source-error-effects.js";

import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../../target-ast/inspection/type-equality.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { planRustSelectedErrorRegion } from "../../program/error-regions.js";
import { rustInjectLocalError, rustInjectNativeError, rustLocalErrorOwner, rustErrorType,
  rustPropagateLocalError, rustPropagateMappedErrorJoin } from "../../program/fallible-boundaries.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";

export function planRustSourceErrorPropagation(
  node: Node,
  edge: RustSourceErrorEffectEdge,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const selection = context.input.program.errorRegions.sourceFor(edge);
  if (selection === undefined) return reject(node, context);
  const channels = new Map(selection.channels.map(channel => [channel.sourceIdentity, channel]));
  const planned = planRustSelectedErrorRegion(selection.operand, context);
  if (planned === undefined) return reject(node, context);
  const operand = planned.boundary;
  if (operand === undefined) return expression;
  const active = context.fallibleBoundary;
  if (active === undefined) return reject(node, context);
  if (operand.kind === "source-package") return rustPropagateLocalError(active, operand.errorType, expression) ?? reject(node, context);
  if (context.syntheticNames === undefined) return reject(node, context);
  const errorName = allocateRustSyntheticName(context.syntheticNames, "source_error");
  const payloadName = allocateRustSyntheticName(context.syntheticNames, "source_error_payload");
  return rustPropagateMappedErrorJoin(active, operand.join, expression, errorName, payloadName, (selected, payload) => {
    if (operand.local?.source.identity === selected.identity) {
      const owner = rustLocalErrorOwner(active);
      if (owner === undefined) return undefined;
      const targetType = rustErrorType(owner);
      const imported: RustExpr = rustTypeEquals(selected.errorType, targetType) ? payload : {
        kind: "associated-call", owner: targetType, method: "from", args: [payload],
      };
      return rustInjectLocalError(active, imported);
    }
    const channel = channels.get(selected.identity);
    if (channel?.uninhabited === true)
      return { kind: "match", expression: payload, arms: [] };
    return channel === undefined ? undefined : rustInjectNativeError(active,
      { identity: channel.targetIdentity, errorType: selected.errorType }, payload);
  }) ?? reject(node, context);
}

function reject(node: Node, context: RustPlanContext): undefined {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
    "rust.backend.source-call-error-correspondence",
    "A source invocation requires exact declaration-to-caller error channels in the active region."));
  return undefined;
}
