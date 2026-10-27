import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import type { RustNativeErrorJoinPlan, RustNativeErrorJoinSelection } from "../types/native-error-joins.js";
import type { RustSourcePackageErrorBoundary } from "../../../target-model/records/errors/source-package-errors.js";

export interface RustLocalErrorChannel {
  readonly owner: RustSourcePackageErrorBoundary;
  readonly source: RustNativeErrorJoinSelection;
}

export type RustFallibleBoundary =
  | { readonly kind: "source-package"; readonly errorType: RustType; readonly owner: RustSourcePackageErrorBoundary }
  | { readonly kind: "native"; readonly errorType: RustType; readonly join: RustNativeErrorJoinPlan;
      readonly local: RustLocalErrorChannel | undefined };

export function rustErrorType(owner: RustSourcePackageErrorBoundary): Extract<RustType, { readonly kind: "named" }> {
  return { kind: "named", path: owner.errorTypePath, identity: owner.errorTypeIdentity };
}

export function rustPackageFallibleBoundary(owner: RustSourcePackageErrorBoundary): RustFallibleBoundary {
  return Object.freeze({ kind: "source-package", errorType: rustErrorType(owner), owner });
}

export function rustNativeFallibleBoundary(
  join: RustNativeErrorJoinPlan,
  local?: RustLocalErrorChannel,
): RustFallibleBoundary | undefined {
  // A boundary exists only for a complete join whose local channel, if any, is an accepted source carrying the
  // owner's own error type; callers reject the region otherwise.
  if (join.errorType === undefined || local !== undefined &&
    (!join.accepts(local.source) || !rustTypeEquals(rustErrorType(local.owner), local.source.errorType))) return undefined;
  return Object.freeze({ kind: "native", errorType: join.errorType, join,
    local: local === undefined ? undefined : Object.freeze({ ...local, source: Object.freeze({ ...local.source }) }) });
}

export function rustLocalErrorOwner(region: RustFallibleBoundary): RustSourcePackageErrorBoundary | undefined {
  return region.kind === "source-package" ? region.owner : region.local?.owner;
}

export function rustInjectNativeError(
  region: RustFallibleBoundary,
  source: RustNativeErrorJoinSelection,
  error: RustExpr,
): RustExpr | undefined {
  return region.kind === "native" ? region.join.inject(source, error)
    : rustTypeEquals(region.errorType, source.errorType) ? error : undefined;
}

export function rustPropagateNativeError(
  region: RustFallibleBoundary,
  source: RustNativeErrorJoinSelection,
  result: RustExpr,
): RustExpr | undefined {
  return region.kind === "native" ? region.join.propagate(source, result)
    : rustTypeEquals(region.errorType, source.errorType)
      ? { kind: "try", expr: result, operandErrorType: source.errorType, resultErrorType: region.errorType } : undefined;
}

export function rustPropagateMappedErrorJoin(
  region: RustFallibleBoundary, operand: RustNativeErrorJoinPlan, expression: RustExpr,
  errorName: string, payloadName: string,
  select: (source: RustNativeErrorJoinSelection, value: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  if (operand.errorType === undefined) return undefined;
  const error: RustExpr = { kind: "path", path: errorName };
  const mapped = operand.mapError(error, payloadName, select);
  if (mapped === undefined) return undefined;
  const result: RustExpr = mapped === error && rustTypeEquals(operand.errorType, region.errorType) ? expression
    : { kind: "method-call", receiver: expression, method: "map_err",
      genericArguments: [{ kind: "type", type: region.errorType }, { kind: "type", type: { kind: "infer" } }],
      args: [{ kind: "closure", params: [{ name: errorName }], body: mapped }] };
  return { kind: "try", expr: result, operandErrorType: region.errorType, resultErrorType: region.errorType };
}

export function rustInjectLocalError(region: RustFallibleBoundary, error: RustExpr): RustExpr | undefined {
  return region.kind === "source-package" ? error : region.local === undefined
    ? undefined : rustInjectNativeError(region, region.local.source, error);
}

export function rustPropagateLocalError(
  region: RustFallibleBoundary,
  operandErrorType: RustType,
  result: RustExpr,
): RustExpr | undefined {
  if (region.kind === "source-package") {
    return { kind: "try", expr: result, operandErrorType, resultErrorType: region.errorType };
  }
  const local = region.local;
  if (local === undefined) return undefined;
  const converted: RustExpr = rustTypeEquals(operandErrorType, local.source.errorType) ? result : {
    kind: "method-call", receiver: result, method: "map_err",
    args: [{ kind: "associated-value", owner: local.source.errorType, name: "from" }],
  };
  return rustPropagateNativeError(region, local.source, converted);
}
