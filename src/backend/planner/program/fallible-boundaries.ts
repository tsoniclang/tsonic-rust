import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import type { RustNativeErrorJoinPlan, RustNativeErrorJoinSelection } from "../types/native-error-joins.js";
import type { RustSourcePackageErrorBoundary } from "./source-package-errors.js";

export interface RustLocalErrorChannel {
  readonly owner: RustSourcePackageErrorBoundary;
  readonly source: RustNativeErrorJoinSelection;
}

export type RustFallibleBoundary =
  | { readonly kind: "source-package"; readonly errorType: RustType; readonly owner: RustSourcePackageErrorBoundary }
  | { readonly kind: "native"; readonly errorType: RustType; readonly join: RustNativeErrorJoinPlan;
      readonly local: RustLocalErrorChannel | undefined };

export function rustErrorType(owner: RustSourcePackageErrorBoundary): RustType {
  return { kind: "named", path: owner.errorTypePath, identity: owner.errorTypeIdentity };
}

export function rustPackageFallibleBoundary(owner: RustSourcePackageErrorBoundary): RustFallibleBoundary {
  return Object.freeze({ kind: "source-package", errorType: rustErrorType(owner), owner });
}

export function rustNativeFallibleBoundary(
  join: RustNativeErrorJoinPlan,
  local?: RustLocalErrorChannel,
): RustFallibleBoundary | undefined {
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
  return region.kind === "native" ? region.join.inject(source, error) : undefined;
}

export function rustPropagateNativeError(
  region: RustFallibleBoundary,
  source: RustNativeErrorJoinSelection,
  result: RustExpr,
): RustExpr | undefined {
  return region.kind === "native" ? region.join.propagate(source, result) : undefined;
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
