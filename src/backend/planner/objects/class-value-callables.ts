import type { RustClassValueCallable } from "../../../target-model/records/callables/class-value-callables.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustPackageFallibleBoundary, rustErrorType } from "../program/fallible-boundaries.js";

import type { RustExpr, RustFunctionParam, RustImplFunction } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorBoundaryForProjectMember, sourceModuleItemPath } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { applyRustCallableValueAdapter } from "../declarations/callables/adapters.js";
import { planRustCallableArguments } from "../declarations/callables/parameter-adapters.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustSelfParameter } from "../declarations/callables/self-parameter.js";
import { applyRustFallibleResultExpression } from "../types/fallible-shape.js";

export function planRustClassValueForwarder(
  callable: RustClassValueCallable, name: string, context: RustPlanContext, construction = false,
): RustImplFunction | undefined {
  const boundary = rustCurrentErrorBoundary(context);
  const owner = rustTypeFromCarrierInContext(callable.ownerCarrier, context);
  const returnType = rustTypeFromCarrierInContext(callable.resultAdapter.targetCarrier, context);
  if (boundary === undefined || owner === undefined || returnType === undefined) failRustPlannerInvariant("An admitted class forwarder requires its sealed owner, result and native error ABI.", callable.declaration);
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, callable.declaration, []);
  const localContext = { ...context, syntheticNames, fallibleBoundary: rustPackageFallibleBoundary(boundary) };
  const parameters = callable.parameters.map(parameter => {
    const type = rustTypeFromCarrierInContext(parameter.parameterCarrier, localContext);
    if (type === undefined) failRustPlannerInvariant("An admitted class forwarder parameter requires its native carrier.", callable.declaration);
    return { name: allocateRustSyntheticName(syntheticNames, "argument"), type };
  });
  const params: readonly RustFunctionParam[] = parameters;
  const arguments_ = planRustCallableArguments({ declaration: callable.declaration, parameters: params,
    parameterAbis: callable.parameters, parameterAdapters: callable.parameterAdapters }, localContext);
  if (arguments_ === undefined) failRustPlannerInvariant("An admitted class forwarder requires its native argument adaptations.", callable.declaration);
  const selected = context.input.program.records.classValueForwarder.get(callable, construction);
  if (selected === undefined) failRustPlannerInvariant("An admitted class forwarder requires its sealed invocation form.", callable.declaration);
  const contextArgument: RustExpr[] = selected.environmentArgument ? [{ kind: "path", path: "self" }] : [];
  let invocation: RustExpr = { kind: "associated-call", owner, method: callable.targetName,
    args: [...contextArgument, ...arguments_.adaptedArguments] };
  const moduleFunction = selected.moduleFunction;
  if (moduleFunction !== undefined) {
    const path = sourceModuleItemPath(context, moduleFunction.fileName, moduleFunction.name);
    if (path === undefined) failRustPlannerInvariant("An admitted class forwarder requires its native module item path.", callable.declaration);
    invocation = { kind: "call", path, args: [...contextArgument, ...arguments_.adaptedArguments] };
  }
  if (context.input.program.records.fallible.get(callable.declaration) !== undefined) {
    const operand = rustErrorBoundaryForProjectMember(callable.declaration, context);
    if (operand === undefined) failRustPlannerInvariant("An admitted fallible class forwarder requires its native operand error ABI.", callable.declaration);
    invocation = { kind: "try", expr: invocation, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(operand) };
  }
  const result = applyRustCallableValueAdapter(invocation, callable.resultAdapter, callable.declaration, localContext);
  if (result === undefined) failRustPlannerInvariant("An admitted class forwarder requires its native result adaptation.", callable.declaration);
  return { kind: "function", name, visibility: "private", generics: { parameters: [], wherePredicates: [] },
    selfParam: rustSelfParameter(construction ? "rc" : "ref"),
    params: arguments_.parameters, returnType, errorType: rustErrorType(boundary),
    body: { statements: [...arguments_.statements, { kind: "tail", expr:
      applyRustFallibleResultExpression(result, { errorType: rustErrorType(boundary) }) }] },
  };
}
