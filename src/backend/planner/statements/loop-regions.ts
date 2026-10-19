import type { Node } from "@tsonic/tsts";
import type { RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustControlTarget, RustLoopTarget, RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function createRustLoopTarget(
  context: RustPlanContext,
  source: Node,
  continuePrelude: readonly RustStmt[],
): RustLoopTarget {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    failRustPlannerInvariant("Loop lowering requires finalized hygienic names and control-flow state.", context.sourceFile);
  }
  const sourceTargets = context.input.program.records.statementControlTargets.get(source);
  if (sourceTargets === undefined) failRustPlannerInvariant("Loop lowering requires its exact admitted source targets.", source);
  const target: RustLoopTarget = {
    kind: "loop",
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, "loop"),
    sourceTargets,
    ...(context.completionBoundary === undefined ? {} : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
    breakUsed: { value: false },
    continuePrelude,
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

export function createRustBreakTarget(
  context: RustPlanContext,
  source: Node,
  kind: "switch" | "label",
): RustControlTarget {
  if (context.syntheticNames === undefined || context.controlFlow === undefined) {
    failRustPlannerInvariant("Labeled control flow requires finalized hygienic names and control-flow state.", context.sourceFile);
  }
  const sourceTargets = context.input.program.records.statementControlTargets.get(source);
  if (sourceTargets === undefined) failRustPlannerInvariant("Labeled control flow requires its exact admitted source targets.", source);
  const target: RustControlTarget = {
    kind,
    id: context.controlFlow.nextLoopId,
    label: allocateRustSyntheticName(context.syntheticNames, kind),
    sourceTargets,
    ...(context.completionBoundary === undefined ? {} : { resourceBoundary: context.completionBoundary }),
    used: { value: false },
  };
  context.controlFlow.nextLoopId += 1;
  return target;
}

export function withRustControlTarget(context: RustPlanContext, target: RustControlTarget): RustPlanContext {
  return { ...context, controlTargets: [...(context.controlTargets ?? []), target] };
}
