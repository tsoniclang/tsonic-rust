import type { RustSourceCallableValueFact } from "../../../analysis/facts/keys.js";
import { rustClosureCaptureFactKey, rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  isValidRustIdentifier,
  rustCurrentErrorBoundary,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  sourceModuleItemPath,
} from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import { applyRustFallibleResultExpression } from "../types/fallible-shape.js";
import { rustCallableConstructionType } from "./fundamentals.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { planRustCapturedEnvironment } from "./capture-environments.js";
import { planRustLexicalFunctionArguments } from "../declarations/callables/lexical-functions.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";

export function planRustSourceCallableValue(
  value: RustSourceCallableValueFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const lexical = context.input.program.lexicalFunctions.forDeclaration(value.sourceDeclaration);
  if (lexical === undefined) return planRustSourceCallableValueConstruction(value, context);
  if (lexical.kind === "resolved" && lexical.inlineValueReference !== undefined) {
    return planRustSourceCallableValueConstruction(value, context);
  }
  const name = context.input.program.names.callableValueNameForDeclaration(value.sourceDeclaration);
  if (name === undefined || lexical.kind !== "resolved" || !lexical.valueObserved) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, value.sourceDeclaration),
      "rust.backend.lexical-function-value", "A lexical function value lost its exact activation-owned binding."));
    return undefined;
  }
  const captured = [...(context.capturedBindings ?? [])].reverse()
    .find(binding => binding.declaration === value.sourceDeclaration);
  const expression: RustExpr = captured?.expression ?? { kind: "path", path: name };
  const referent = expression.kind === "reference" ? expression.expr : expression;
  return value.carrier.kind === "function-pointer"
    ? captured?.borrowed === undefined ? referent : { kind: "dereference", pointer: expression }
    : { kind: "method-call", receiver: referent, method: "clone", args: [] };
}

export function planRustSourceCallableValueConstruction(
  value: RustSourceCallableValueFact,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, value.sourceDeclaration),
      "rust.backend.callable-value-name",
      "Project-source callable values require a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const callableType = rustCallableConstructionType(value.carrier, context);
  const lexical = context.input.program.lexicalFunctions.forDeclaration(value.sourceDeclaration);
  if (lexical?.kind === "unresolved") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, value.sourceDeclaration),
      "rust.backend.lexical-function-value", lexical.reason));
    return undefined;
  }
  const path = lexical === undefined ? sourceModuleItemPath(context, value.fileName, value.name) : value.name;
  if (path === undefined || !isValidRustIdentifier(value.name)) {
    return undefined;
  }
  if (value.carrier.kind === "function-pointer") {
    if (lexical?.kind === "resolved" && lexical.captures.length > 0) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, value.sourceDeclaration),
        "rust.backend.function-pointer-capture", "A native Rust function pointer cannot retain a lexical environment."));
      return undefined;
    }
    return { kind: "path", path };
  }
  const argumentsType = rustTypeFromCarrierInContext({ kind: "tuple", elements: value.parameterCarriers }, context);
  if (callableType === undefined || argumentsType === undefined) {
    return undefined;
  }
  const captures = lexical === undefined ? [] : context.input.program.facts.getFact(value.sourceDeclaration, rustClosureCaptureFactKey)?.captures;
  if (captures === undefined) return undefined;
  const environment = planRustCapturedEnvironment(value.sourceDeclaration, captures, context,
    { staticStorage: true, mutableValueCapture: false });
  if (environment === undefined) return undefined;
  const invocationContext = { ...context, capturedBindings: environment.capturedBindings };
  const environmentArguments = planRustLexicalFunctionArguments(value.sourceDeclaration, invocationContext);
  if (environmentArguments === undefined) return undefined;
  const allocatedArgumentsName = allocateRustSyntheticName(
    context.syntheticNames,
    "callable_arguments",
  );
  const argumentsName = value.parameterCarriers.length === 0
    ? `_${allocatedArgumentsName}`
    : allocatedArgumentsName;
  const invocation: RustExpr = {
    kind: "call",
    path,
    args: [...value.parameterCarriers.map((_carrier, index): RustExpr => ({
        kind: "field",
        receiver: { kind: "path", path: argumentsName },
        name: String(index),
      })), ...environmentArguments],
  };
  const fallible = context.input.program.facts.getFact(
    value.sourceDeclaration,
    rustFallibleFactKey,
  ) !== undefined;
  const currentBoundary = rustCurrentErrorBoundary(context);
  const sourceBoundary = fallible
    ? rustErrorBoundaryForProjectMember(value.sourceDeclaration, context)
    : undefined;
  if (currentBoundary === undefined || fallible && sourceBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, value.sourceDeclaration),
      "rust.backend.callable-value-error-boundary",
      "Project-source callable value has no exact error boundary.",
    ));
    return undefined;
  }
  const currentErrorType = rustErrorType(currentBoundary);
  const completed: RustExpr = fallible
      ? {
          kind: "try",
          expr: invocation,
          resultErrorType: currentErrorType,
          operandErrorType: rustErrorType(sourceBoundary!),
        }
      : invocation;
  const callableResult: RustExpr = rustTargetTypeRefEquals(value.resultCarrier, rustUnitTargetType())
    ? { kind: "evaluate-then", effect: completed, discard: "unit",
        value: applyRustFallibleResultExpression({ kind: "tuple-literal", elements: [] }, { errorType: currentErrorType }) }
    : applyRustFallibleResultExpression(completed, { errorType: currentErrorType });
  const implementation: RustExpr = captures.length > 0
    ? {
        kind: "closure-block",
        params: [{ name: argumentsName, type: argumentsType }],
        move: true,
        async: false,
        body: { statements: [{ kind: "tail", expr: callableResult }] },
      }
    : {
        kind: "closure",
        params: [{ name: argumentsName, byRefCopy: false, type: argumentsType }],
        body: callableResult,
      };
  context.usedAliases?.add("rt");
  const constructed: RustExpr = {
    kind: "associated-call",
    owner: callableType,
    method: "new",
    args: [implementation],
  };
  return environment.bindings.length === 0 ? constructed : rustValueBlock(environment.bindings, constructed);
}
