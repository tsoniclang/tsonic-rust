import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import type { RustCallableParameterAbi } from "../../../../analysis/facts/callable-adapters.js";
import { rustProjectCallableAdaptersKey } from "../../../../analysis/facts/project-callable-adapters.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../../../target-model/types/index.js";
import type { RustExpr, RustFunctionParam, RustImplFunction, RustStmt, RustType } from "../../../target-ast/nodes.js";
import { rustTypeEquals } from "../../../target-ast/inspection/type-equality.js";
import { applyRustCallableValueAdapter, planRustCallableArguments } from "../../declarations/callables/adapters.js";
import { rustSelfParameter } from "../../declarations/callables/self-parameter.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput, rustErrorBoundaryForProjectMember, rustErrorType } from "../../program/plan-context.js";
import { rustParameterTypeFromCarrierInContext, rustReturnTypeFromCarrierInContext } from "../../types/render.js";
import { applyRustFallibleResultExpression } from "../../types/fallible-shape.js";
import { readRustProjectMethodOverride } from "../project-objects.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
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
  const concrete = context.input.program.projectTypes.definitionForCarrier(concreteCarrier);
  const representation = context.input.program.objectRepresentations.representationFor(concrete);
  const matches = concrete === undefined ? []
    : (context.input.program.facts.getFact(concrete.declaration, rustProjectCallableAdaptersKey) ?? [])
      .filter(adapter => adapter.contract === contract && adapter.implementation === implementation && adapter.slot === slot);
  const adapter = matches.length === 1 ? matches[0] : undefined;
  if (representation === undefined || adapter === undefined ||
    !matchesAbi(adapter.parameters, adapter.returnCarrier, shape.params, shape.returnType, shape.errorType, context) ||
    !matchesAbi(adapter.implementationParameters, adapter.implementationReturnCarrier,
      helper.params, helper.returnType, helper.errorType, context) ||
    !matchesAbi(adapter.parameterAdapters.map(parameter => parameter.target), adapter.implementationReturnCarrier,
      helper.params, helper.returnType, helper.errorType, context) ||
    !rustTypeEquals(helper.errorType, shape.errorType) ||
    (helper.isUnsafe === true) !== shape.isUnsafe) {
    return reject();
  }
  const boundary = shape.errorType === undefined ? undefined : rustErrorBoundaryForProjectMember(contract, context);
  if (shape.errorType !== undefined && (boundary === undefined || !rustTypeEquals(rustErrorType(boundary), shape.errorType))) {
    return reject();
  }
  const syntheticNames = createRustSyntheticNameState(context.input.program.source.ast, contract, shape.params.map(parameter => parameter.name));
  const selectedContext = { ...context, syntheticNames, fallibleBoundary: boundary };
  const used = new Set(adapter.parameterAdapters.flatMap(parameter => {
    switch (parameter.kind) {
      case "omitted": return [];
      case "fixed-rest": return parameter.contractParameterIndexes;
      default: return [parameter.contractParameterIndex];
    }
  }));
  const parameters = shape.params.map((parameter, index) => ({
    ...parameter,
    name: used.has(index) || parameter.name.startsWith("_") ? parameter.name : `_${parameter.name}`,
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
  });
  if (result === undefined) return reject();
  const statements: RustStmt[] = [...arguments_.statements];
  if (overrideStoragePath !== undefined) {
    if (helper.errorType === undefined) return reject();
    const overrideName = allocateRustSyntheticName(syntheticNames, "method_override");
    const overrideResult = adaptResult({
      kind: "method-call", receiver: { kind: "path", path: overrideName }, method: "call",
      args: [{ kind: "tuple-literal", elements: arguments_.adaptedArguments }],
    });
    if (overrideResult === undefined) return reject();
    statements.push({
      kind: "if-let-some", binding: overrideName,
      expression: readRustProjectMethodOverride({ kind: "path", path: "self" }, overrideStoragePath, representation),
      body: { statements: [{ kind: "return", expr: overrideResult }] },
    });
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

  function adaptResult(invocation: RustExpr): RustExpr | undefined {
    const call: RustExpr = helper.isUnsafe === true ? { kind: "unsafe", expression: invocation } : invocation;
    const value: RustExpr = helper.errorType === undefined ? call : {
      kind: "try", expr: call, operandErrorType: helper.errorType, resultErrorType: shape.errorType!,
    };
    const converted = applyRustCallableValueAdapter(value, adapter!.resultAdapter, contract, selectedContext);
    return converted === undefined || shape.errorType === undefined ? converted
      : applyRustFallibleResultExpression(converted, { errorType: shape.errorType });
  }

  function reject(): undefined {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, implementation),
      "rust.backend.project-dispatch-signature",
      "Selected project member implementation does not preserve its finalized contract-to-implementation Rust ABI adapter."));
    return undefined;
  }
}

function matchesAbi(
  parameters: readonly RustCallableParameterAbi[],
  returnCarrier: TargetTypeRef,
  emittedParameters: readonly RustFunctionParam[],
  emittedReturn: RustType | undefined,
  errorType: RustType | undefined,
  context: RustPlanContext,
): boolean {
  if (parameters.length !== emittedParameters.length || parameters.some((parameter, index) => {
    const type = rustParameterTypeFromCarrierInContext(parameter.parameterCarrier, context);
    return type === undefined || !rustTypeEquals(type, emittedParameters[index]?.type);
  })) return false;
  const unit = isRustUnitCarrier(returnCarrier) || errorType !== undefined && isRustNeverCarrier(returnCarrier);
  const result = unit ? undefined : rustReturnTypeFromCarrierInContext(returnCarrier, context);
  return (unit || result !== undefined) && rustTypeEquals(result, emittedReturn);
}
