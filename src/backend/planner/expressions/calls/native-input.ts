import type { Node } from "@tsonic/tsts";
import type { RustSourceCallEffectsFact } from "../../../../analysis/facts/keys.js";
import type { RustNativeCallableCall } from "../../../../analysis/callables/native-inputs.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustCallGenericArgument, RustExpr } from "../../../target-ast/nodes.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";
import { rustPropagateNativeError } from "../../program/fallible-boundaries.js";
import { missingFactDiagnostic } from "../../diagnostics.js";

export function rustNativeInputEffectsMatch(
  call: RustNativeCallableCall,
  effects: RustSourceCallEffectsFact,
): boolean {
  return effects.invocation === "fallible" &&
    effects.awaiting === (call.completion === undefined ? "not-applicable" : "fallible") &&
    closedMetadataEquals(effects.nativeInput, {
      invocationError: call.invocationError, invocationErrorSource: call.invocationErrorSource,
      awaitErrors: call.awaitErrors, awaitErrorSources: call.awaitErrorSources,
    });
}

export function planRustNativeInputInvocation(
  call: RustNativeCallableCall,
  callable: RustExpr,
  args: readonly RustExpr[],
  genericArguments: readonly RustCallGenericArgument[] | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const owner = rustTypeFromCarrierInContext(call.input.implementation, context);
  const trait = rustTypeFromCarrierInContext(call.input.protocol.trait, context);
  return owner === undefined || trait === undefined ? undefined : {
    kind: "associated-call", owner, trait, method: "invoke",
    args: [{ kind: "reference", expr: callable }, ...args],
    ...(genericArguments === undefined ? {} : { genericArguments }),
  };
}

export function planRustNativeInputPropagation(
  node: Node,
  call: RustNativeCallableCall,
  expression: RustExpr,
  context: RustPlanContext,
): RustExpr | undefined {
  const region = context.fallibleBoundary;
  const errorType = rustTypeFromCarrierInContext(call.invocationError, context);
  const result = region === undefined || errorType === undefined ? undefined :
    rustPropagateNativeError(region, { identity: call.invocationErrorSource, errorType }, expression);
  if (result === undefined) context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
    "rust.backend.native-callable-error-channel", "Native callable invocation requires its exact selected error channel in the active region."));
  return result;
}
