import type { Node } from "@tsonic/tsts";
import type { RustNativeCallableCall } from "../../../../target-model/records/native/native-protocols.js";
import type { RustNativeCallableInput } from "../../../../target-model/records/native/native-protocols.js";
import type { RustCallGenericArgument, RustExpr } from "../../../target-ast/syntax/nodes.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustPropagateNativeError } from "../../program/fallible-boundaries.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { createRustSharedReferenceArgument } from "../input-shaping.js";
import type { RustErasedInputArgument } from "../../../../target-model/records/calls/erased-input-arguments.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { rustCallableProtocol } from "../../../../target-model/types/index.js";

export function planRustNativeInputInvocation(
  call: RustNativeCallableCall,
  callable: RustExpr,
  args: readonly RustExpr[],
  genericArguments: readonly RustCallGenericArgument[] | undefined,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.nativeInputInvocation.get(call.node)
    ?? failRustPlannerInvariant("An admitted native input call requires its exact receiver and error plan.", call.node);
  const receiver = selected.reference ? callable : createRustSharedReferenceArgument(context,
    { stage: "source", expression: callable, node: selected.callee });
  const erased = args.map((value, index) => {
    const argument = context.input.program.records.erasedInputArgument.get(call.node, index);
    return argument === undefined ? value : planRustErasedInputArgument(argument, value, call.node, context);
  });
  return planRustNativeProtocolInvocation(call.input, receiver, erased, genericArguments, context);
}

// A native input erased into a type-erased runtime callable parameter: the boxed callable invokes the input and
// converts its invocation error into the parameter's error (bound by the retained-input requirement).
function planRustErasedInputArgument(argument: RustErasedInputArgument, value: RustExpr, node: Node, context: RustPlanContext): RustExpr {
  const names = context.syntheticNames ?? failRustPlannerInvariant("An erased native input argument requires its name scope.", node);
  const name = allocateRustSyntheticName(names, "erased_input");
  const argumentsName = allocateRustSyntheticName(names, argument.parameterCount === 0 ? "_arguments" : "arguments");
  const invocation = planRustNativeProtocolInvocation(argument.input, { kind: "reference", expr: { kind: "path", path: name } },
    Array.from({ length: argument.parameterCount }, (_unused, index): RustExpr =>
      ({ kind: "field", receiver: { kind: "path", path: argumentsName }, name: String(index) })), undefined, context)
    ?? failRustPlannerInvariant("An erased native input argument requires its native protocol invocation.", node);
  const parameters = rustCallableProtocol(argument.carrier)?.parameters;
  const argumentsType = parameters === undefined ? undefined : rustTypeFromCarrierInContext({ kind: "tuple", elements: parameters }, context);
  if (argumentsType === undefined) failRustPlannerInvariant("An erased native input argument requires its rendered argument tuple.", node);
  context.usedAliases?.add("rt");
  return rustValueBlock([{ name, mutable: false, value }], { kind: "associated-call", owner: { kind: "named", path: "rt::Callable" },
    method: "new", args: [{ kind: "closure", move: true, params: [{ name: argumentsName, byRefCopy: false, type: argumentsType }],
      body: { kind: "method-call", receiver: invocation, method: "map_err", args: [{ kind: "path", path: "core::convert::Into::into" }] } }] });
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
  const caught = context.input.program.records.nativeInputInvocation.get(node)?.caught;
  if (caught !== undefined && region?.kind === "source-package" && errorType !== undefined) {
    // In a catching try body the invocation error converts into the catch's program error (the owner's Into bound).
    return { kind: "try", expr: { kind: "method-call", receiver: expression, method: "map_err",
      genericArguments: [{ kind: "type", type: region.errorType }, { kind: "type", type: { kind: "infer" } }],
      args: [{ kind: "path", path: "core::convert::Into::into" }] }, operandErrorType: region.errorType, resultErrorType: region.errorType };
  }
  const result = region === undefined || errorType === undefined ? undefined :
    rustPropagateNativeError(region, { identity: call.invocationErrorSource, errorType }, expression);
  if (result === undefined) failRustPlannerInvariant("An admitted native callable invocation requires its exact active error channel.", node);
  return result;
}
