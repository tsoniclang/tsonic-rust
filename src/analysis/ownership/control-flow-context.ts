import type { Node } from "@tsonic/tsts";
import { FlowShapeError } from "./control-flow-errors.js";

export interface RustSourceFlowContext {
  readonly regionId: string;
  readonly lexicalRegionId: string;
  readonly rootCallable?: Node;
  readonly breakTarget?: number;
  readonly continueTarget?: number;
  readonly returnTarget: number;
  readonly throwTarget: number;
  readonly labeledTargets: ReadonlyMap<string, RustSourceFlowLabelTarget>;
  readonly pendingLoopLabels: readonly string[];
}

export interface RustSourceFlowLabelTarget {
  readonly breakTarget: number;
  readonly continueTarget?: number;
}

export function rustSourceFlowWithoutPendingLoopLabels(
  context: RustSourceFlowContext,
): RustSourceFlowContext {
  return context.pendingLoopLabels.length === 0
    ? context
    : Object.freeze({ ...context, pendingLoopLabels: Object.freeze([]) });
}

export function rustSourceFlowLoopBodyContext(
  context: RustSourceFlowContext,
  breakTarget: number,
  continueTarget: number,
): RustSourceFlowContext {
  const labeledTargets = new Map(context.labeledTargets);
  for (const label of context.pendingLoopLabels) {
    const target = labeledTargets.get(label);
    if (target === undefined) {
      throw new FlowShapeError(`Loop label '${label}' has no exact active target.`);
    }
    labeledTargets.set(label, Object.freeze({
      breakTarget: target.breakTarget,
      continueTarget,
    }));
  }
  return Object.freeze({
    ...context,
    breakTarget,
    continueTarget,
    labeledTargets,
    pendingLoopLabels: Object.freeze([]),
  });
}

export function rustSourceFlowContextThroughCompletion(
  context: RustSourceFlowContext,
  throughFinally: (target: number) => number,
  throwTarget: number,
): RustSourceFlowContext {
  const labeledTargets = new Map<string, RustSourceFlowLabelTarget>();
  for (const [label, target] of context.labeledTargets) {
    labeledTargets.set(label, Object.freeze({
      breakTarget: throughFinally(target.breakTarget),
      ...(target.continueTarget === undefined
        ? {}
        : { continueTarget: throughFinally(target.continueTarget) }),
    }));
  }
  return Object.freeze({
    ...context,
    returnTarget: throughFinally(context.returnTarget),
    ...(context.breakTarget === undefined
      ? {}
      : { breakTarget: throughFinally(context.breakTarget) }),
    ...(context.continueTarget === undefined
      ? {}
      : { continueTarget: throughFinally(context.continueTarget) }),
    throwTarget,
    labeledTargets,
  });
}
