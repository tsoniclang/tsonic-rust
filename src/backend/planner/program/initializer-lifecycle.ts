import type { RustInitializerErrorSelection } from "../../../target-model/records/errors/error-regions.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../target-ast/syntax/type-equality.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import {
  rustErrorType, rustInjectLocalError, rustInjectNativeError, rustLocalErrorOwner, type RustFallibleBoundary,
} from "./fallible-boundaries.js";

export function planRustInitializerLifecycleResult(
  selection: RustInitializerErrorSelection,
  operand: RustFallibleBoundary,
  lifecycle: RustFallibleBoundary,
  expression: RustExpr,
): RustExpr {
  const error: RustExpr = { kind: "path", path: "initializer_error" };
  let mapped: RustExpr | undefined;
  if (selection.kind === "package" && operand.kind === "source-package") {
    const local = rustLocalErrorOwner(lifecycle);
    if (local !== undefined) {
      const type = rustErrorType(local);
      const imported: RustExpr = rustTypeEquals(type, operand.errorType) ? error
        : { kind: "associated-call", owner: type, method: "from", args: [error] };
      mapped = rustInjectLocalError(lifecycle, imported);
    }
  }
  if (selection.kind === "native" && operand.kind === "native") {
    const sources = new Map(selection.sources.map(source => [source.identity, source]));
    mapped = operand.join.mapError(error, "initializer_payload", (channel, payload) => {
        const source = sources.get(channel.identity);
        if (source === undefined) return undefined;
        if (source.kind === "module") return rustInjectNativeError(lifecycle,
          { identity: source.identity, errorType: channel.errorType }, payload);
        const owner = rustLocalErrorOwner(lifecycle);
        return owner === undefined || !rustTypeEquals(rustErrorType(owner), channel.errorType) ? undefined
          : rustInjectLocalError(lifecycle, payload);
    });
  }
  if (mapped === undefined)
    return failRustPlannerInvariant("An admitted initializer requires its exact original module and local lifecycle channels.");
  return mapped === error && rustTypeEquals(operand.errorType, lifecycle.errorType) ? expression : {
    kind: "method-call", receiver: expression, method: "map_err",
    genericArguments: [{ kind: "type", type: lifecycle.errorType }, { kind: "type", type: { kind: "infer" } }],
    args: [{ kind: "closure", params: [{ name: "initializer_error" }], body: mapped }],
  };
}
