import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableCall } from "../../../../target-model/records/native-protocols.js";
import type { RustNativeCallableInput } from "../../../../target-model/records/native-protocols.js";
import type { RustCallGenericArgument, RustExpr } from "../../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustPropagateNativeError } from "../../program/fallible-boundaries.js";
import { failRustPlannerInvariant } from "../../../invariants.js";
import { createRustSharedReferenceArgument } from "../input-shaping.js";

export function planRustNativeInputInvocation(
  call: RustNativeCallableCall,
  callable: RustExpr,
  args: readonly RustExpr[],
  genericArguments: readonly RustCallGenericArgument[] | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.nativeInputInvocation.get(call.node)
    ?? failRustPlannerInvariant("An admitted native input call requires its exact receiver and error plan.", call.node);
  const receiver = selected.reference ? callable : createRustSharedReferenceArgument(context, callable, selected.callee);
  return planRustNativeProtocolInvocation(call.input, receiver, args, genericArguments, context);
}

export function planRustNativeProtocolInvocation(
  input: RustNativeCallableInput,
  receiver: RustExpr,
  args: readonly RustExpr[],
  genericArguments: readonly RustCallGenericArgument[] | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.input.program.records.nativeProtocolInput.get(input) !== true || args.length !== input.protocol.method.parameters.length)
    failRustPlannerInvariant("An admitted native protocol invocation requires its exact input and native arity.", input.owner);
  const owner = rustTypeFromCarrierInContext(input.implementation, context);
  const trait = rustTypeFromCarrierInContext(input.trait, context);
  if (owner === undefined || trait === undefined) failRustPlannerInvariant("An admitted native protocol requires its renderable implementation and trait.", input.owner);
  return {
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
  if (result === undefined) failRustPlannerInvariant("An admitted native callable invocation requires its exact active error channel.", node);
  return result;
}
