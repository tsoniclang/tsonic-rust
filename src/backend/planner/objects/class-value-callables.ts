import type { RustClassValueCallable } from "../../../analysis/objects/class-value-callables.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr, RustFunctionParam, RustItem } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorBoundaryForProjectMember, rustErrorType } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { applyRustCallableValueAdapter, planRustCallableArguments } from "../declarations/callable-adapters.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";

export function planRustClassValueForwarder(
  callable: RustClassValueCallable, name: string, context: RustPlanContext,
): RustItem | undefined {
  const boundary = rustCurrentErrorBoundary(context);
  const owner = rustTypeFromCarrierInContext(callable.ownerCarrier, context);
  const returnType = rustTypeFromCarrierInContext(callable.resultAdapter.targetCarrier, context);
  if (boundary === undefined || owner === undefined || returnType === undefined) return undefined;
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, callable.declaration, []);
  const localContext = { ...context, syntheticNames, fallibleBoundary: boundary };
  const parameters = callable.parameters.map(parameter => {
    const type = rustTypeFromCarrierInContext(parameter.parameterCarrier, localContext);
    return type === undefined ? undefined : { name: allocateRustSyntheticName(syntheticNames, "argument"), type };
  });
  if (parameters.some(parameter => parameter === undefined)) return undefined;
  const params = parameters as readonly RustFunctionParam[];
  const arguments_ = planRustCallableArguments({ declaration: callable.declaration, parameters: params,
    parameterAbis: callable.parameters, parameterAdapters: callable.parameterAdapters }, localContext);
  if (arguments_ === undefined) return undefined;
  let invocation: RustExpr = { kind: "associated-call", owner, method: callable.targetName, args: arguments_.adaptedArguments };
  if (context.input.program.facts.getFact(callable.declaration, rustFallibleFactKey) !== undefined) {
    const operand = rustErrorBoundaryForProjectMember(callable.declaration, context);
    if (operand === undefined) return undefined;
    invocation = { kind: "try", expr: invocation, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(operand) };
  }
  const result = applyRustCallableValueAdapter(invocation, callable.resultAdapter, callable.declaration, localContext);
  if (result === undefined) return undefined;
  return { kind: "function", name, visibility: "crate", generics: { parameters: [], wherePredicates: [] },
    params, returnType, errorType: rustErrorType(boundary),
    body: { statements: [...arguments_.statements, { kind: "tail", expr: { kind: "call", path: "Ok", args: [result] } }] },
  };
}
