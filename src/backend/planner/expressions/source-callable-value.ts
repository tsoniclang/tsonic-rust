import type { RustSourceCallableValueFact } from "../../../analysis/facts/keys.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../rust-ast/nodes.js";
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

export function planRustSourceCallableValue(
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
  const path = sourceModuleItemPath(context, value.fileName, value.name);
  if (callableType === undefined || path === undefined ||
    !isValidRustIdentifier(value.name)) {
    return undefined;
  }
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
    args: value.parameterCarriers.map((_carrier, index) => {
      const argument: RustExpr = {
        kind: "field",
        receiver: { kind: "path", path: argumentsName },
        name: String(index),
      };
      const mode = value.argumentModes[index];
      return mode === "ref"
        ? { kind: "reference", expr: argument }
        : mode === "mut-ref"
          ? { kind: "reference", expr: argument, mutable: true }
          : argument;
    }),
  };
  const fallible = context.input.facts.getFact(
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
  const callableResult = applyRustFallibleResultExpression(
    fallible
      ? {
          kind: "try",
          expr: invocation,
          resultErrorType: currentErrorType,
          operandErrorType: rustErrorType(sourceBoundary!),
        }
      : invocation,
    { errorType: currentErrorType },
  );
  const mutableArguments = value.argumentModes.some((mode) => mode === "mut-ref");
  const implementation: RustExpr = mutableArguments
    ? {
        kind: "closure-block",
        params: [{ name: argumentsName, mutable: true }],
        move: true,
        async: false,
        body: { statements: [{ kind: "tail", expr: callableResult }] },
      }
    : {
        kind: "closure",
        params: [{ name: argumentsName, byRefCopy: false }],
        body: callableResult,
      };
  context.usedAliases?.add("rt");
  return {
    kind: "associated-call",
    owner: callableType,
    method: "new",
    args: [implementation],
  };
}
