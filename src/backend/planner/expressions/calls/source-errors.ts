import type { Node } from "@tsonic/tsts";
import type { RustSourceErrorEffectEdge } from "../../../../target-model/records/errors/source-error-effects.js";
import type { RustSourceErrorRegionEmission } from "../../../../target-model/records/errors/error-emission.js";

import type { RustExpr, RustType } from "../../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../../target-ast/syntax/type-equality.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { planRustSelectedErrorRegion } from "../../program/error-regions.js";
import { rustInjectLocalError, rustInjectNativeError, rustLocalErrorOwner, rustErrorType,
  rustPropagateLocalError, rustPropagateNativeError, rustPropagateMappedErrorJoin,
  type RustFallibleBoundary } from "../../program/fallible-boundaries.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planRustJsRejectionValue } from "../js-rejection.js";
import { rustEliminateInfallibleResult } from "../../types/fallible-shape.js";

export function planRustSourceErrorPropagation(
  node: Node,
  edge: RustSourceErrorEffectEdge,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const selection = context.input.program.records.sourceErrorRegion.get(edge);
  if (selection === undefined) return reject(node, context);
  return planRustSelectedSourceErrorPropagation(node, selection, expression, context);
}

export function planRustSelectedSourceErrorPropagation(
  node: Node,
  selection: RustSourceErrorRegionEmission,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const channels = selection.channels;
  const planned = planRustSelectedErrorRegion(selection.operand, context, node);
  if (planned === undefined) return reject(node, context);
  const operand = planned.boundary;
  if (operand === undefined) {
    if (context.syntheticNames === undefined) return reject(node, context);
    return rustEliminateInfallibleResult(expression,
      allocateRustSyntheticName(context.syntheticNames, "source_value"),
      allocateRustSyntheticName(context.syntheticNames, "source_error"));
  }
  const active = context.fallibleBoundary;
  if (active === undefined) return reject(node, context);
  if (operand.kind === "source-package") {
    const route = selection.local;
    const propagated = route === undefined ? undefined : route.kind === "local"
      ? rustPropagateLocalError(active, operand.errorType, expression)
      : rustPropagateNativeError(active, { identity: route.targetIdentity, errorType: operand.errorType }, expression);
    return propagated ?? reject(node, context);
  }
  if (context.syntheticNames === undefined) return reject(node, context);
  const errorName = allocateRustSyntheticName(context.syntheticNames, "source_error");
  const payloadName = allocateRustSyntheticName(context.syntheticNames, "source_error_payload");
  return rustPropagateMappedErrorJoin(active, operand.join, expression, errorName, payloadName, (selected, payload) => {
    if (operand.local?.source.identity === selected.identity) {
      return injectLocalError(selection.local, active, selected.errorType, payload);
    }
    const channel = channels.get(selected.identity);
    if (channel?.uninhabited === true)
      return { kind: "match", expression: payload, arms: [] };
    if (channel?.jsRejection === true)
      return planRustJsRejectionValue(node, payload, context);
    return channel === undefined ? undefined : rustInjectNativeError(active,
      { identity: channel.targetIdentity, errorType: selected.errorType }, payload);
  }) ?? reject(node, context);
}

function injectLocalError(
  route: RustSourceErrorRegionEmission["local"],
  active: RustFallibleBoundary,
  sourceType: RustType,
  payload: RustExpr,
): RustExpr | undefined {
  if (route === undefined) return undefined;
  if (route.kind === "native") return rustInjectNativeError(active,
    { identity: route.targetIdentity, errorType: sourceType }, payload);
  const owner = rustLocalErrorOwner(active);
  if (owner === undefined) return undefined;
  const targetType = rustErrorType(owner);
  const imported: RustExpr = rustTypeEquals(sourceType, targetType) ? payload : {
    kind: "associated-call", owner: targetType, method: "from", args: [payload],
  };
  return rustInjectLocalError(active, imported);
}

function reject(node: Node, _context: RustPlanContext): never {
  return failRustPlannerInvariant("An admitted source invocation requires its declaration-to-caller error channels in the active region.", node);
}
