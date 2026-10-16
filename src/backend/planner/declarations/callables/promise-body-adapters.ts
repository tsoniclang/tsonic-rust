import type { Node } from "@tsonic/tsts";
import type { RustBlock, RustExpr, RustGenerics, RustCallGenericArgument } from "../../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../../target-ast/inspection/type-equality.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustInjectNativeError, rustErrorType, type RustFallibleBoundary } from "../../program/fallible-boundaries.js";
import { planRustJsRejectionRegion } from "../../program/js-rejection-regions.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { wrapRustJsPromiseBody, wrapRustJsPromiseCompletion } from "./async-promise.js";

export function rustPromiseBodyGenericArguments(generics: RustGenerics): readonly RustCallGenericArgument[] {
  return generics.parameters.flatMap((parameter): RustCallGenericArgument[] => parameter.kind === "lifetime" ? []
    : parameter.kind === "type" ? [{ kind: "type", type: { kind: "named", path: parameter.name } }]
    : [{ kind: "const", value: { kind: "path", path: parameter.name } }]);
}

export function planRustPromiseBodyObjectAdapter(
  declaration: Node,
  invocation: RustExpr,
  nativeBoundary: RustFallibleBoundary | undefined,
  context: RustPlanContext,
): RustBlock | undefined {
  const asynchronous = context.input.program.records.asyncFunction.get(declaration);
  if (asynchronous?.kind !== "js-promise") return undefined;
  let completion: RustExpr = asynchronous.lowering.kind === "factory" ? { kind: "await", expr: invocation } : invocation;
  if (nativeBoundary !== undefined) {
    const region = context.input.program.errorRegions.get(declaration);
    const objectBoundary = region === undefined ? undefined : planRustJsRejectionRegion(declaration, region, context)?.boundary;
    if (objectBoundary === undefined || context.syntheticNames === undefined) return undefined;
    if (!rustTypeEquals(nativeBoundary.errorType, objectBoundary.errorType)) {
      const errorName = allocateRustSyntheticName(context.syntheticNames, "promise_error");
      const error: RustExpr = { kind: "path", path: errorName };
      const converted = nativeBoundary.kind === "native"
        ? nativeBoundary.join.mapError(error, allocateRustSyntheticName(context.syntheticNames, "promise_payload"),
            (source, payload) => rustInjectNativeError(objectBoundary, source, payload))
        : rustInjectNativeError(objectBoundary,
            { identity: `package:${nativeBoundary.owner.errorTypeIdentity}`, errorType: rustErrorType(nativeBoundary.owner) }, error);
      if (converted === undefined) return undefined;
      completion = { kind: "method-call", receiver: completion, method: "map_err",
        args: [{ kind: "closure", params: [{ name: errorName }], body: converted }] };
    }
  }
  return asynchronous.lowering.kind === "settled"
    ? wrapRustJsPromiseCompletion(completion, nativeBoundary !== undefined)
    : wrapRustJsPromiseBody({ statements: [{ kind: "tail", expr: completion }] },
        nativeBoundary !== undefined, asynchronous.lowering);
}
