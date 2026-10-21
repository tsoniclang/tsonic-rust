import type { Node } from "@tsonic/tsts";
import { rustPackageFallibleBoundary } from "../../program/fallible-boundaries.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustExpr, RustImplFunction, RustStmt, RustType } from "../../../target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../../target-ast/syntax/type-equality.js";
import { applyRustCallableValueAdapter } from "../../declarations/callables/adapters.js";
import { planRustCallableArguments } from "../../declarations/callables/parameter-adapters.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustErrorBoundaryForProjectMember, rustErrorType } from "../../program/plan-context.js";
import { applyRustFallibleResultExpression } from "../../types/fallible-shape.js";
import { readRustProjectMethodOverride } from "../project-objects.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { ProjectCallableShape } from "./model.js";

export function planRootCallableForwarder(
  concreteCarrier: TargetTypeRef,
  contract: Node,
  implementation: Node,
  slot: string,
  rootType: RustType,
  helper: RustImplFunction,
  shape: ProjectCallableShape,
  overrideStoragePath: readonly string[] | undefined,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const concrete = context.input.program.records.projectType.get(concreteCarrier);
  const representation = context.input.program.records.objectRepresentation.get(concrete);
  const adapter = concrete === undefined ? undefined
    : context.input.program.records.projectCallableAdapter.get(concrete.declaration, contract, implementation, slot);
  if (representation === undefined || adapter === undefined) {
    return reject();
  }
  const boundary = shape.errorType === undefined ? undefined : rustErrorBoundaryForProjectMember(contract, context);
  if (shape.errorType !== undefined && (boundary === undefined || !rustTypeEquals(rustErrorType(boundary), shape.errorType))) {
    return reject();
  }
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, contract, shape.params.map(parameter => parameter.name));
  const selectedContext = { ...context, syntheticNames,
    fallibleBoundary: boundary === undefined ? undefined : rustPackageFallibleBoundary(boundary) };
  const parameters = shape.params.map(parameter => ({
    ...parameter,
    mutable: false,
  }));
  const arguments_ = planRustCallableArguments({
    declaration: contract,
    parameters,
    parameterAbis: adapter.parameters,
    parameterAdapters: adapter.parameterAdapters,
  }, selectedContext);
  if (arguments_ === undefined) return reject();
  const result = adaptResult({
    kind: "associated-call", owner: rootType, method: helper.name,
    args: [{ kind: "path", path: "self" }, ...arguments_.adaptedArguments],
  }, helper.errorType);
  if (result === undefined) return reject();
  const statements: RustStmt[] = [...arguments_.statements];
  if (overrideStoragePath !== undefined) {
    if (shape.errorType === undefined) return reject();
    const overrideName = allocateRustSyntheticName(syntheticNames, "method_override");
    const overrideResult = adaptResult({
      kind: "method-call", receiver: { kind: "path", path: overrideName }, method: "call",
      args: [{ kind: "tuple-literal", elements: arguments_.adaptedArguments }],
    }, shape.errorType);
    if (overrideResult === undefined) return reject();
    statements.push({ kind: "expr", expr: { kind: "if-let", pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name: overrideName }] }, expression: readRustProjectMethodOverride({ kind: "path", path: "self" }, overrideStoragePath, representation), whenTrue: { kind: "block", body: { statements: [{ kind: "return", expr: overrideResult }] } } } });
  }
  statements.push({ kind: "tail", expr: result });
  return { kind: "function",
    name: slot, visibility: "private", generics: helper.generics, selfParam: rustSelfParameter("rc"),
    params: parameters,
    ...(shape.returnType === undefined ? {} : { returnType: shape.returnType }),
    ...(shape.errorType === undefined ? {} : { errorType: shape.errorType }),
    ...(shape.isUnsafe ? { isUnsafe: true } : {}),
    body: { statements },
  };

  function adaptResult(invocation: RustExpr, invocationErrorType: RustType | undefined): RustExpr | undefined {
    const call: RustExpr = helper.isUnsafe === true ? { kind: "unsafe", expression: invocation } : invocation;
    const value: RustExpr = invocationErrorType === undefined ? call : {
      kind: "try", expr: call, operandErrorType: invocationErrorType, resultErrorType: shape.errorType!,
    };
    const converted = applyRustCallableValueAdapter(value, adapter!.resultAdapter, contract, selectedContext);
    return converted === undefined || shape.errorType === undefined ? converted
      : applyRustFallibleResultExpression(converted, { errorType: shape.errorType });
  }

  function reject(): never {
    return failRustPlannerInvariant("An admitted project member requires its exact sealed contract-to-implementation native ABI adapter.", implementation);
  }
}
