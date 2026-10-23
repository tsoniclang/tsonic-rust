import type { RustInitializerErrorSelection } from "../../../target-model/records/error-regions.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import {
  rustErrorType, rustInjectLocalError, rustInjectNativeError, rustLocalErrorOwner,
  rustPropagateLocalError, rustPropagateMappedErrorJoin, type RustFallibleBoundary,
} from "./fallible-boundaries.js";

export function planRustInitializerLifecycleResult(
  selection: RustInitializerErrorSelection,
  operand: RustFallibleBoundary,
  lifecycle: RustFallibleBoundary,
  expression: RustExpr,
): RustExpr {
  if (selection.kind === "package" && operand.kind === "source-package") {
    const propagated = rustPropagateLocalError(lifecycle, operand.errorType, expression);
    if (propagated !== undefined) return propagated;
  }
  if (selection.kind === "native" && operand.kind === "native") {
    const sources = new Map(selection.sources.map(source => [source.identity, source]));
    const propagated = rustPropagateMappedErrorJoin(lifecycle, operand.join, expression,
      "initializer_error", "initializer_payload", (channel, payload) => {
        const source = sources.get(channel.identity);
        if (source === undefined) return undefined;
        if (source.kind === "module") return rustInjectNativeError(lifecycle,
          { identity: source.identity, errorType: channel.errorType }, payload);
        const owner = rustLocalErrorOwner(lifecycle);
        return owner === undefined || !rustTypeEquals(rustErrorType(owner), channel.errorType) ? undefined
          : rustInjectLocalError(lifecycle, payload);
      });
    if (propagated !== undefined) return propagated;
  }
  return failRustPlannerInvariant("An admitted initializer requires its exact original module and local lifecycle channels.");
}
