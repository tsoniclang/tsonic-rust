import type { Node } from "@tsonic/tsts";
import type { RustSourceErrorEffectEdge } from "../../../../analysis/facts/source-error-effects.js";
import { rustErrorEffectsFactKey } from "../../../../analysis/facts/error-effects.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustExpr, RustType } from "../../../target-ast/nodes.js";
import { rustTypeEquals } from "../../../target-ast/inspection/type-equality.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { planRustSelectedErrorRegion } from "../../program/error-regions.js";
import { rustInjectLocalError, rustInjectNativeError, rustLocalErrorOwner, rustErrorType,
  rustPropagateLocalError, rustPropagateMappedErrorJoin } from "../../program/fallible-boundaries.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { rustInfallibleTargetId } from "../../../../target-model/types/carriers/source-types.js";

export function planRustSourceErrorPropagation(
  node: Node,
  edge: RustSourceErrorEffectEdge,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const source = context.input.program.facts.getFact(edge.declaration, rustErrorEffectsFactKey);
  if (source === undefined || source.localErrors !== edge.effects.localErrors ||
    source.nativeErrors.length !== edge.nativeErrors.length) return reject(node, context);
  const channels = new Map(edge.nativeErrors.map(channel => [channel.source.identity, channel]));
  if (channels.size !== edge.nativeErrors.length) return reject(node, context);
  const instantiated = source.nativeErrors.map(selected => {
    const channel = channels.get(selected.identity);
    return channel === undefined || !rustTargetTypeRefEquals(selected.errorType, channel.source.errorType) ||
      !edge.effects.nativeErrors.some(target => target.identity === channel.target.identity &&
        rustTargetTypeRefEquals(target.errorType, channel.target.errorType))
      ? undefined : { identity: selected.identity, errorType: channel.target.errorType };
  });
  if (instantiated.some(channel => channel === undefined) || edge.effects.nativeErrors.some(target =>
    !edge.nativeErrors.some(channel => channel.target.identity === target.identity))) return reject(node, context);
  const planned = planRustSelectedErrorRegion(edge.declaration, { localErrors: source.localErrors,
    nativeErrors: instantiated as NonNullable<typeof instantiated[number]>[] }, context);
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
    if (channel?.target.errorType.kind === "target-named" && channel.target.errorType.id === rustInfallibleTargetId)
      return { kind: "match", expression: payload, arms: [] };
    const targetType: RustType | undefined = channel === undefined ? undefined
      : rustTypeFromCarrierInContext(channel.target.errorType, context);
    return channel === undefined || targetType === undefined ? undefined : rustInjectNativeError(active,
      { identity: channel.target.identity, errorType: targetType }, payload);
  }) ?? reject(node, context);
}

function reject(node: Node, context: RustPlanContext): undefined {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
    "rust.backend.source-call-error-correspondence",
    "A source invocation requires exact declaration-to-caller error channels in the active region."));
  return undefined;
}
