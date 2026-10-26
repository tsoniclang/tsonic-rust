import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustReturnExpression } from "../statements/completion-exits.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function planGeneratorResumeExpression(resume: RustExpr, context: RustPlanContext): RustExpr {
  const activeErrorType = context.returnResult?.errorType;
  if (context.syntheticNames === undefined || activeErrorType === undefined || typeof context.generator?.errorUninhabited !== "boolean")
    failRustPlannerInvariant("An admitted generator resume requires its native name scope and body error carrier.", context.callableDeclaration ?? context.sourceFile);
  const next = allocateRustSyntheticName(context.syntheticNames, "generator_next");
  const returned = allocateRustSyntheticName(context.syntheticNames, "generator_return");
  const error = allocateRustSyntheticName(context.syntheticNames, "generator_error");
  context.usedAliases?.add("rt");
  return { kind: "match", expression: resume, arms: [
    { pattern: { kind: "tuple-variant", path: "rt::GeneratorResume::Next", elements: [{ kind: "binding", name: next }] }, expression: { kind: "path", path: next } },
    { pattern: { kind: "tuple-variant", path: "rt::GeneratorResume::Return", elements: [{ kind: "binding", name: returned }] },
      expression: planRustReturnExpression({ kind: "path", path: returned }, context) },
    { pattern: { kind: "tuple-variant", path: "rt::GeneratorResume::Throw", elements: [{ kind: "binding", name: error }] },
      expression: context.generator.errorUninhabited ? { kind: "match", expression: { kind: "path", path: error }, arms: [] }
        : { kind: "try", resultErrorType: activeErrorType, operandErrorType: activeErrorType,
        expr: { kind: "call", path: "Err", args: [{ kind: "path", path: error }] } } },
  ] };
}
