import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustSourceCallEffectsFact } from "../../../../analysis/facts/keys.js";
import type { RustNativeCallableCall, RustNativeCallableInput } from "../../../../analysis/callables/native-inputs.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import type { RustCallGenericArgument, RustExpr } from "../../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { diagnosticInput, type RustPlanContext } from "../../program/plan-context.js";
import { rustPropagateNativeError } from "../../program/fallible-boundaries.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { createRustSharedReferenceArgument } from "../input-shaping.js";
import { effectivePlannedExpressionCarrier } from "../fundamentals.js";

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
  const callee = Node_Expression(context.input.program.source.ast, call.node);
  if (callee === undefined) return undefined;
  const carrier = effectivePlannedExpressionCarrier(callee, context);
  if (carrier === undefined) return undefined;
  const receiver = carrier.kind === "reference" ? callable : createRustSharedReferenceArgument(context, callable, callee);
  return planRustNativeProtocolInvocation(call.input, receiver, args, genericArguments, context);
}

export function planRustNativeProtocolInvocation(
  input: RustNativeCallableInput,
  receiver: RustExpr,
  args: readonly RustExpr[],
  genericArguments: readonly RustCallGenericArgument[] | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!context.input.program.callableValues.native.inputs.includes(input) ||
    args.length !== input.protocol.method.parameters.length) return undefined;
  const owner = rustTypeFromCarrierInContext(input.implementation, context);
  const trait = rustTypeFromCarrierInContext(input.trait, context);
  return owner === undefined || trait === undefined ? undefined : {
    kind: "associated-call", owner, trait, method: "invoke",
    args: [receiver, ...args],
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
