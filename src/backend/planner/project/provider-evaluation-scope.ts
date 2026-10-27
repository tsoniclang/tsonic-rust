import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../target-model/records/operations/finalized-operation.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";

import { planExpressionBeforeContextualConversion } from "../expressions/entry.js";
import { planRustDiscardedValue } from "../expressions/discarded-values.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type {
  RustExpressionPlanner,
} from "../expressions/typed-locations.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";
import {
  planRustDirectStorageCore,
  type RustProviderOperationExpressionPlanner,
} from "../expressions/update-direct-storage.js";
import {
  enterRustProjectObjectMutableState,
} from "../objects/project-objects.js";
import { collectMutableInputs } from "./provider-mutable-inputs.js";

export interface RustFinalizedInputPlanOverrides {
  readonly sourceValues: ReadonlyMap<Node, RustExpr>;
  readonly inputs: ReadonlyMap<RustFinalizedSourceInput, RustExpr>;
}

type RustProviderEvaluationStep =
  | { readonly kind: "binding"; readonly name: string; readonly value: RustExpr; readonly mutable?: boolean }
  | { readonly kind: "effect"; readonly value: RustExpr; readonly discard: "unit" | "value" };

export type RustProviderEvaluationScopeSelection =
  | { readonly kind: "none" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "selected";
      readonly steps: readonly RustProviderEvaluationStep[];
      readonly mutableLocations: readonly {
        readonly name: string;
        readonly ownerName: string;
      }[];
      readonly mutableProjectStates: readonly {
        readonly receiver: RustExpr;
        readonly stateName: string;
      }[];
      readonly overrides: RustFinalizedInputPlanOverrides;
    };

export function planRustProviderEvaluationScope(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" | "runtime-set" }>,
  operationNode: Node,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  planExpression: RustExpressionPlanner,
  planProviderOperation: RustProviderOperationExpressionPlanner,
  preplannedInputs?: ReadonlyMap<RustFinalizedSourceInput, RustExpr>,
  planSequenceInput?: (input: RustFinalizedSourceInput) => RustExpr | undefined,
): RustProviderEvaluationScopeSelection {
  const selected = context.input.program.records.providerEvaluation.get(operationNode, fact);
  if (selected === undefined) failRustPlannerInvariant("An admitted provider operation requires its exact source evaluation plan.", operationNode);
  const mutableInputs = collectMutableInputs(
    context,
    fact,
    operationNode,
    planExpression,
  );
  if (mutableInputs === undefined) {
    return { kind: "failed" };
  }
  const sourceSlots = selected.source.slots;
  const prepared = new Set(selected.slots.filter(row => row.inputs.length !== 0 && row.inputs.every(input => preplannedInputs?.has(input) === true)).map(row => row.slot.key));
  const stabilizationKeys = new Set(selected.force);
  if (selected.orderConflicts.some(keys => keys.every(key => !prepared.has(key))))
    for (const key of selected.effects) if (!prepared.has(key)) stabilizationKeys.add(key);
  for (const row of selected.slots) {
    const key = row.slot.key;
    if (prepared.has(key)) continue;
    if (selected.dispatch && selected.effects.has(key) || row.snapshot) stabilizationKeys.add(key);
    if (context.expressionOverrides?.get(row.slot.node)?.valueForm !== "shared-reference")
      for (const later of row.borrowAcross) if (selected.effects.has(later)) stabilizationKeys.add(key);
    for (const later of row.mutableAcross) if (selected.effects.has(later))
      stabilizationKeys.add(mutableInputs.get(key)?.kind === "owned" ? key : later);
  }
  const hasManagedInput = [...mutableInputs.values()].some((input) =>
    input.kind !== "owned");
  if (!hasManagedInput && stabilizationKeys.size === 0 && !sourceSlots.some(slot => slot.evaluationOnly !== undefined)) {
    return { kind: "none" };
  }
  const steps: RustProviderEvaluationStep[] = [];
  const mutableLocations: { readonly name: string; readonly ownerName: string }[] = [];
  const mutableProjectStates: { readonly receiver: RustExpr; readonly stateName: string }[] = [];
  const mutableProjectStateByRoot = new Map<Node, {
    readonly receiver: RustExpr;
    readonly stateName: string;
  }>();
  const sourceValues = new Map<Node, RustExpr>();
  const inputOverrides = new Map<RustFinalizedSourceInput, RustExpr>();
  const nameRoot = receiverNode ?? argumentNodes.find((node): node is Node => node !== undefined) ??
    context.sourceFile;
  const syntheticNames = context.syntheticNames ??
    createRustSyntheticNameState(context.input.program.source.ast, nameRoot, []);
  const sequenceInputs = new Map<string, RustFinalizedSourceInput>();
  for (const row of selected.slots) if (row.sequence !== undefined) sequenceInputs.set(row.slot.key, row.sequence);
  for (const [index, slot] of sourceSlots.entries()) {
    const input = sequenceInputs.get(slot.key);
    if (input !== undefined) {
      if (planSequenceInput === undefined) return { kind: "failed" };
      const value = planSequenceInput(input);
      if (value === undefined) return { kind: "failed" };
      const name = allocateRustSyntheticName(syntheticNames, `operation_sequence_${index}`);
      steps.push({ kind: "binding", name, value });
      inputOverrides.set(input, { kind: "path", path: name });
      continue;
    }
    const mutable = mutableInputs.get(slot.key);
    if (mutable?.kind === "promoted") {
      const name = allocateRustSyntheticName(syntheticNames, `location_${index}`);
      const ownerName = allocateRustSyntheticName(syntheticNames, `location_value_${index}`);
      steps.push({ kind: "binding", name, value: mutable.location });
      mutableLocations.push({ name, ownerName });
      for (const input of mutable.inputs) {
        inputOverrides.set(input, { kind: "path", path: ownerName });
      }
      continue;
    }
    if (mutable?.kind === "project-field") {
      const rootKey = mutable.rootDeclaration ?? mutable.node;
      let projectState = mutableProjectStateByRoot.get(rootKey);
      if (projectState === undefined) {
        const receiver = planExpression(mutable.receiverNode, context);
        if (receiver === undefined) {
          return { kind: "failed" };
        }
        projectState = {
          receiver,
          stateName: allocateRustSyntheticName(syntheticNames, `project_state_${index}`),
        };
        mutableProjectStateByRoot.set(rootKey, projectState);
        mutableProjectStates.push(projectState);
      }
      const storage = mutable.storagePath.reduce<RustExpr>(
        (receiver, name) => ({ kind: "field", receiver, name }),
        { kind: "path", path: projectState.stateName },
      );
      for (const input of mutable.inputs) {
        inputOverrides.set(input, {
          kind: "reference",
          expr: storage,
          mutable: true,
        });
      }
      continue;
    }
    if (mutable?.kind === "direct") {
      const storage = planRustDirectStorageCore(
        mutable.node,
        context,
        preplannedInputs,
        planExpression,
        planProviderOperation,
      );
      if (storage === undefined) {
        failRustPlannerInvariant("Direct mutable provider input has no exact Rust storage expression.", mutable.node);
      }
      sourceValues.set(slot.node, storage);
      continue;
    }
    if (slot.evaluationOnly !== undefined) {
      const discarded = planRustDiscardedValue(slot.node, context);
      if (discarded === undefined) return { kind: "failed" };
      const borrowed = selected.slots[index]!.borrowedEvaluation;
      if (slot.evaluationOnly === "value" && discarded.discard === "value" && !borrowed) {
        const name = allocateRustSyntheticName(syntheticNames, `_operation_evaluation_${index}`);
        steps.push({ kind: "binding", name, value: discarded.expression });
      } else {
        steps.push({ kind: "effect", value: discarded.expression, discard: discarded.discard });
      }
      continue;
    }
    if (!stabilizationKeys.has(slot.key)) {
      continue;
    }
    const row = selected.slots[index]!;
    const carrier = row.ownerCarrier;
    // An operand the enclosing expression already bound to a local (a compound assignment receiver or index) is
    // stable; binding it into a second local would move it before its later read or write.
    const bound = context.expressionOverrides?.get(slot.node);
    if (carrier === undefined && bound !== undefined && bound.expression.kind === "path") {
      if (row.borrowedEvaluation && bound.valueForm === "shared-reference") {
        for (const input of row.inputs) inputOverrides.set(input, bound.expression);
      } else sourceValues.set(slot.node, bound.expression);
      continue;
    }
    let valueContext = context;
    if (carrier !== undefined) {
      const owner = planExpressionBeforeContextualConversion(slot.node, context);
      if (owner === undefined) return { kind: "failed" };
      const ownerName = allocateRustSyntheticName(syntheticNames, `operation_input_${index}_value`);
      steps.push({ kind: "binding", name: ownerName, value: owner });
      const expressionOverrides = new Map(context.expressionOverrides);
      expressionOverrides.set(slot.node, { expression: { kind: "path", path: ownerName }, carrier, valueForm: "value" });
      valueContext = { ...context, expressionOverrides };
    }
    const value = planExpression(slot.node, valueContext, "value", row.borrowedEvaluation ? "shared-reference" : "value");
    if (value === undefined) {
      return { kind: "failed" };
    }
    const name = allocateRustSyntheticName(syntheticNames, `operation_input_${index}`);
    steps.push({
      kind: "binding",
      name,
      value,
      ...(mutable?.kind === "owned" ? { mutable: true } : {}),
    });
    const boundValue: RustExpr = { kind: "path", path: name };
    if (row.borrowedEvaluation) {
      for (const input of row.inputs) inputOverrides.set(input, boundValue);
    } else sourceValues.set(slot.node, boundValue);
  }
  return {
    kind: "selected",
    steps,
    mutableLocations,
    mutableProjectStates,
    overrides: { sourceValues, inputs: inputOverrides },
  };
}

export function applyRustProviderEvaluationScope(
  expression: RustExpr,
  scope: Extract<RustProviderEvaluationScopeSelection, { readonly kind: "selected" }>,
): RustExpr {
  let value = expression;
  for (const location of [...scope.mutableLocations].reverse()) {
    value = {
      kind: "method-call",
      receiver: { kind: "path", path: location.name },
      method: "with_mut",
      args: [{
        kind: "closure",
        params: [{ name: location.ownerName, byRefCopy: false }],
        body: value,
      }],
    };
  }
  for (const projectState of [...scope.mutableProjectStates].reverse()) {
    value = enterRustProjectObjectMutableState(
      projectState.receiver,
      projectState.stateName,
      value,
    );
  }
  let pending: Extract<RustProviderEvaluationStep, { readonly kind: "binding" }>[] = [];
  const flush = (): void => {
    if (pending.length !== 0) value = rustValueBlock(pending.reverse().map(
      ({ name, value, mutable }) => ({ name, value, ...(mutable === undefined ? {} : { mutable }) }),
    ), value);
    pending = [];
  };
  for (const step of [...scope.steps].reverse()) {
    if (step.kind === "binding") {
      pending.push(step);
    } else {
      flush();
      value = { kind: "evaluate-then", effect: step.value, discard: step.discard, value };
    }
  }
  flush();
  return value;
}

