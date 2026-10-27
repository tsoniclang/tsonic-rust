import type { RustSourceCallableValueFact } from "../../../target-model/records/operations/operation-selections.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { sourceModuleItemPath } from "../program/plan-context.js";
import { applyRustFallibleResultExpression } from "../types/fallible-shape.js";
import { rustCallableConstructionType } from "../types/constructions.js";
import { planRustCapturedEnvironment } from "./capture-environments.js";
import { planRustLexicalFunctionArguments } from "../declarations/callables/lexical-functions.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { planRustGenericCallableValue } from "./generic-callables.js";

export function planRustSourceCallableValue(value: RustSourceCallableValueFact, context: RustPlanContext): RustExpr | undefined {
  const selected = context.input.program.records.sourceCallableEmission.get(value.sourceDeclaration, value.carrier)
    ?? failRustPlannerInvariant("An admitted source callable requires its exact native value plan.", value.sourceDeclaration);
  if (selected.binding === undefined) return planRustSourceCallableValueConstruction(value, context);
  const captured = [...(context.capturedBindings ?? [])].reverse().find(binding => binding.declaration === value.sourceDeclaration);
  const expression: RustExpr = captured?.expression ?? { kind: "path", path: selected.binding };
  return selected.construction.kind === "pointer"
    ? captured?.borrowed === undefined ? expression : { kind: "dereference", pointer: expression }
    : { kind: "method-call", receiver: expression, method: "clone", args: [] };
}

export function planRustSourceCallableValueConstruction(value: RustSourceCallableValueFact, context: RustPlanContext,
  representation: "value" | "producer" = "value"): RustExpr | undefined {
  const selected = context.input.program.records.sourceCallableEmission.get(value.sourceDeclaration, value.carrier)?.construction
    ?? failRustPlannerInvariant("An admitted source callable requires its exact native construction plan.", value.sourceDeclaration);
  if (selected.kind === "generic") return planRustGenericCallableValue(value.sourceDeclaration, value.carrier, context);
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted source callable requires its finalized hygienic-name scope.", value.sourceDeclaration);
  const path = selected.lexical ? value.name : sourceModuleItemPath(context, value.fileName, value.name);
  if (path === undefined) failRustPlannerInvariant("An admitted source callable requires its exact native item path.", value.sourceDeclaration);
  if (selected.kind === "pointer") return { kind: "path", path };
  const callableType = rustCallableConstructionType(selected.physical, context);
  const argumentsType = rustTypeFromCarrierInContext(selected.arguments, context);
  const errorType = rustTypeFromCarrierInContext(selected.error, context);
  if (callableType === undefined || argumentsType === undefined || errorType === undefined)
    failRustPlannerInvariant("An admitted callable value requires its renderable native storage, arguments and error boundary.", value.sourceDeclaration);
  const environment = planRustCapturedEnvironment(value.sourceDeclaration, selected.captures, context,
    { staticStorage: selected.staticStorage, mutableValueCapture: false });
  if (environment === undefined) return undefined;
  const environmentArguments = planRustLexicalFunctionArguments(value.sourceDeclaration, { ...context, capturedBindings: environment.capturedBindings });
  if (environmentArguments === undefined) return undefined;
  const allocated = allocateRustSyntheticName(context.syntheticNames, "callable_arguments");
  const argumentsName = value.parameterCarriers.length === 0 ? `_${allocated}` : allocated;
  const invocation: RustExpr = { kind: "call", path,
    args: [...value.parameterCarriers.map((_carrier, index): RustExpr => ({ kind: "field", receiver: { kind: "path", path: argumentsName }, name: String(index) })),
      ...environmentArguments] };
  const callableResult: RustExpr = selected.fallible ? invocation : selected.unit
    ? { kind: "evaluate-then", effect: invocation, discard: "unit", value: applyRustFallibleResultExpression({ kind: "tuple-literal", elements: [] }, { errorType }) }
    : applyRustFallibleResultExpression(invocation, { errorType });
  const implementation: RustExpr = selected.captures.length > 0
    ? { kind: "closure-block", params: [{ name: argumentsName, type: argumentsType }], move: true, async: false,
      body: { statements: [{ kind: "tail", expr: callableResult }] } }
    : { kind: "closure", params: [{ name: argumentsName, byRefCopy: false, type: argumentsType }], body: callableResult };
  context.usedAliases?.add("rt");
  if (representation === "producer") return environment.bindings.length === 0 ? implementation : rustValueBlock(environment.bindings, implementation);
  const constructed: RustExpr = { kind: "associated-call", owner: callableType, method: "new", args: [implementation] };
  return environment.bindings.length === 0 ? constructed : rustValueBlock(environment.bindings, constructed);
}
