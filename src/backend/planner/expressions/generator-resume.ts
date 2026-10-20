import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustActiveErrorType } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustReturnExpression } from "../statements/completion-exits.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planGeneratorResumeExpression(resume: RustExpr, context: RustPlanContext): RustExpr {
  const activeErrorType = rustActiveErrorType(context);
  if (context.syntheticNames === undefined || activeErrorType === undefined)
    failRustPlannerInvariant("An admitted generator resume requires its native name scope and error boundary.", context.callableDeclaration ?? context.sourceFile);
  const next = allocateRustSyntheticName(context.syntheticNames, "generator_next");
  const returned = allocateRustSyntheticName(context.syntheticNames, "generator_return");
  const error = allocateRustSyntheticName(context.syntheticNames, "generator_error");
  context.usedAliases?.add("rt");
  return { kind: "match", expression: resume, arms: [
    { pattern: { kind: "tuple-variant", path: "rt::GeneratorResume::Next", elements: [{ kind: "binding", name: next }] }, expression: { kind: "path", path: next } },
    { pattern: { kind: "tuple-variant", path: "rt::GeneratorResume::Return", elements: [{ kind: "binding", name: returned }] },
      expression: planRustReturnExpression({ kind: "path", path: returned }, context) },
    { pattern: { kind: "tuple-variant", path: "rt::GeneratorResume::Throw", elements: [{ kind: "binding", name: error }] },
      expression: { kind: "try", resultErrorType: activeErrorType, operandErrorType: activeErrorType,
        expr: { kind: "call", path: "Err", args: [{ kind: "path", path: error }] } } },
  ] };
}
