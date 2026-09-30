import type { Node } from "@tsonic/tsts";
import type { RustGeneratorFact } from "../../../../analysis/facts/keys.js";
import { rustSourceCallEffectsFactKey, rustSourceCallableReturnFactKey } from "../../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustNativeFutureCallableResult } from "../../../../target-model/types/carriers/generic-callables.js";
import type { RustType } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustCurrentErrorBoundary, rustErrorType } from "../../program/plan-context.js";

export function resolveRustCallableOutwardReturnType(
  declaration: Node, carrier: TargetTypeRef | undefined, context: RustPlanContext,
): RustType | undefined {
  const native = carrier === undefined ? undefined : rustNativeFutureCallableResult(carrier);
  if (native === undefined) return rustReturnTypeFromCarrierInContext(carrier, context);
  const effects = context.input.program.facts.getFact(declaration, rustSourceCallEffectsFactKey);
  const boundary = rustCurrentErrorBoundary(context);
  const output = rustTypeFromCarrierInContext(native.output, context);
  if (effects === undefined || effects.awaiting === "not-applicable" || output === undefined ||
    effects.awaiting === "fallible" && boundary === undefined) return undefined;
  const futureOutput: RustType = effects.awaiting === "fallible"
    ? { kind: "named", path: "Result", genericArguments: [
        { kind: "type", type: output }, { kind: "type", type: rustErrorType(boundary!) },
      ] } : output;
  const completion = context.input.program.facts.getFact(declaration, rustSourceCallableReturnFactKey)?.implementationCompletion;
  if (completion === "absence" && !native.optional) return undefined;
  const future: RustType = completion !== undefined
    ? { kind: "named", path: "core::future::Ready", genericArguments: [{ kind: "type", type: futureOutput }] }
    : { kind: "impl-trait", bounds: [{ kind: "trait-type", reference: { trait: {
        kind: "named", path: "core::future::Future", genericArguments: [
          { kind: "associated-equality", name: "Output", genericArguments: [], type: futureOutput },
        ],
      } } }], outlives: [] };
  return native.optional ? { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: future }] } : future;
}

export function resolveRustCallableBodyReturnType(
  outwardReturnType: RustType | undefined,
  generator: RustGeneratorFact | undefined,
  context: RustPlanContext,
): RustType | undefined {
  if (generator === undefined) {
    return outwardReturnType ?? { kind: "unit" };
  }
  return rustTypeFromCarrierInContext(generator.returnType, context);
}
