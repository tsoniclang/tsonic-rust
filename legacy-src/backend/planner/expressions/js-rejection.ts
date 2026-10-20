import { failTargetPlannerInvariant } from "@tsonic/target-api/artifacts";
import type { Node } from "@tsonic/tsts";
import { rustJsValueTargetType } from "../../../target-model/types/carriers/js.js";
import { rustJsRejectionErrorIdentity } from "../../../target-model/records/error-effects.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustBoundaryErrorVariants } from "../program/error-variants.js";
import { rustInjectNativeError, rustPropagateNativeError } from "../program/fallible-boundaries.js";
import { registerAliasFromPath, type RustPlanContext } from "../program/plan-context.js";
import { rustJsRejectionErrorType } from "../types/error-boundary.js";

export function planRustJsRejectionPropagation(
  node: Node,
  result: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const region = context.fallibleBoundary;
  if (region === undefined) return undefined;
  if (region.kind === "native") return rustPropagateNativeError(region,
    { identity: rustJsRejectionErrorIdentity, errorType: rustJsRejectionErrorType }, result);
  if (context.syntheticNames === undefined)
    failTargetPlannerInvariant("tsonic-rust", "JS rejection propagation requires sealed hygienic name state.", node);
  const error = allocateRustSyntheticName(context.syntheticNames, "rejection");
  const converted = planRustJsRejectionValue(node, { kind: "path", path: error }, context);
  if (converted === undefined) return undefined;
  const mapped: RustExpr = { kind: "method-call", receiver: result, method: "map_err",
    args: [{ kind: "closure", params: [{ name: error }], body: converted }] };
  return { kind: "try", expr: mapped, operandErrorType: region.errorType, resultErrorType: region.errorType };
}

export function planRustJsRejectionValue(node: Node, error: RustExpr, context: RustPlanContext): RustExpr | undefined {
  const region = context.fallibleBoundary;
  if (region === undefined) return undefined;
  if (region.kind === "native") return rustInjectNativeError(region,
    { identity: rustJsRejectionErrorIdentity, errorType: rustJsRejectionErrorType }, error);
  const inventory = planRustBoundaryErrorVariants(context.input.program, region.owner);
  const retained = inventory?.variants.find(variant => variant.kind === "retained");
  const closed = inventory?.variants.find(variant => variant.kind === "closed" &&
    rustTargetTypeRefEquals(variant.carrier, rustJsValueTargetType()));
  if (retained === undefined || closed === undefined || context.syntheticNames === undefined)
    failTargetPlannerInvariant("tsonic-rust", "A caught JS rejection requires its sealed retained and closed payload routes.", node);
  registerAliasFromPath(context, region.owner.errorTypePath);
  const payload = allocateRustSyntheticName(context.syntheticNames, "rejection_payload");
  return {
    kind: "match", expression: { kind: "method-call", receiver: error, method: "into_error", args: [] },
    arms: [
      { pattern: { kind: "tuple-variant", path: "Ok", elements: [{ kind: "binding", name: payload }] },
        expression: { kind: "call", path: `${region.owner.errorTypePath}::${retained.name}`,
          args: [{ kind: "path", path: payload }] } },
      { pattern: { kind: "tuple-variant", path: "Err", elements: [{ kind: "binding", name: payload }] },
        expression: { kind: "call", path: `${region.owner.errorTypePath}::${closed.name}`,
          args: [{ kind: "path", path: payload }] } },
    ],
  };
}
