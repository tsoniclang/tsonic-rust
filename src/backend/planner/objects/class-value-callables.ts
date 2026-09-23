import type { RustClassValueCallable } from "../../../analysis/objects/class-value-callables.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr, RustFunctionParam, RustImplFunction } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary, rustErrorBoundaryForProjectMember, rustErrorType, sourceModuleItemPath } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { applyRustCallableValueAdapter, planRustCallableArguments } from "../declarations/callable-adapters.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustSelfParameter } from "../declarations/self-parameter.js";
import { applyRustFallibleResultExpression } from "../types/fallible-shape.js";

export function planRustClassValueForwarder(
  callable: RustClassValueCallable, name: string, context: RustPlanContext, construction = false,
): RustImplFunction | undefined {
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
  const definition = context.input.program.projectTypes.definitionForCarrier(callable.ownerCarrier);
  const environment = definition === undefined ? undefined : context.input.program.classValues.forDeclaration(definition.declaration)?.environment;
  const contextArgument: RustExpr[] = environment === undefined ? [] : construction
    ? environment.instancesUseEnvironment || environment.initializationUsesEnvironment ? [{ kind: "path", path: "self" }] : []
    : environment.consumers.includes(callable.declaration) ? [{ kind: "path", path: "self" }] : [];
  let invocation: RustExpr = { kind: "associated-call", owner, method: callable.targetName,
    args: [...contextArgument, ...arguments_.adaptedArguments] };
  const moduleFunction = construction ? undefined : context.input.program.projectTypes.memberSlotName(callable.declaration, "static");
  if (moduleFunction !== undefined) {
    const ast = context.input.program.source.ast;
    const path = sourceModuleItemPath(context, ast.getFileName(ast.getSourceFile(callable.declaration)), moduleFunction);
    if (path === undefined) return undefined;
    invocation = { kind: "call", path, args: [...contextArgument, ...arguments_.adaptedArguments] };
  }
  if (context.input.program.facts.getFact(callable.declaration, rustFallibleFactKey) !== undefined) {
    const operand = rustErrorBoundaryForProjectMember(callable.declaration, context);
    if (operand === undefined) return undefined;
    invocation = { kind: "try", expr: invocation, resultErrorType: rustErrorType(boundary), operandErrorType: rustErrorType(operand) };
  }
  const result = applyRustCallableValueAdapter(invocation, callable.resultAdapter, callable.declaration, localContext);
  if (result === undefined) return undefined;
  return { name, visibility: "private", generics: { parameters: [], wherePredicates: [] },
    selfParam: rustSelfParameter(construction ? "rc" : "ref"),
    params, returnType, errorType: rustErrorType(boundary),
    body: { statements: [...arguments_.statements, { kind: "tail", expr:
      applyRustFallibleResultExpression(result, { errorType: rustErrorType(boundary) }) }] },
  };
}
