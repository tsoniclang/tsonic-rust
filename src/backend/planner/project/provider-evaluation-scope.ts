import { rustValueBlock } from "../../target-ast/value-block.js";
import type { Node } from "@tsonic/tsts";
import {
  type SourceExpressionEffects,
} from "@tsonic/target-api/source";
import type {
  RustFinalizedSourceInput,
} from "../../../analysis/facts/finalized-operation-abi.js";
import { rustFinalizedSourceInputs } from "../../../analysis/facts/finalized-operation-abi.js";
import type {
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import {
  rustSourceParameterAbiFactKey,
  rustContextualValueConversionFactKey,
} from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { sourceRuntimeSlots, providerTargetRuntimeSlotKeys, providerSourceInputKey } from "./provider-source-inputs.js";
import { planExpressionBeforeContextualConversion } from "../expressions/entry.js";
import { rustContextualRuntimeConversionContract } from "../../../target-model/conversions/contextual.js";
import { rustValueCarrierBeforeContextualConversion } from "../../../analysis/facts/value-carrier-queries.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../diagnostics.js";
import {
  diagnosticInput,
} from "../program/plan-context.js";
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
} from "../expressions/updates/direct-storage.js";
import {
  enterRustProjectObjectMutableState,
} from "../objects/project-objects.js";
import { rustErrorFieldBorrowNeedsSnapshot, rustErrorFieldHasGuardedBorrow } from "../expressions/error-field-borrows.js";
import { rustProviderInputBorrowMode } from "../../../analysis/facts/provider-borrows.js";
import { collectMutableInputs, mutableRootsAreDisjoint, noSourceExpressionEffects,
  providerMutableStorageEffects, type MutableProviderInput } from "./provider-mutable-inputs.js";

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
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  operationNode: Node,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  planExpression: RustExpressionPlanner,
  planProviderOperation: RustProviderOperationExpressionPlanner,
  preplannedInputs?: ReadonlyMap<RustFinalizedSourceInput, RustExpr>,
  planSequenceInput?: (input: RustFinalizedSourceInput) => RustExpr | undefined,
): RustProviderEvaluationScopeSelection {
  const mutableInputs = collectMutableInputs(
    context,
    fact,
    receiverNode,
    argumentNodes,
    planExpression,
  );
  if (mutableInputs === undefined) {
    return { kind: "failed" };
  }
  if (!mutableRootsAreDisjoint(mutableInputs, context)) {
    return { kind: "failed" };
  }
  const sourceSlots = sourceRuntimeSlots(fact, receiverNode, argumentNodes);
  if (sourceSlots === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, receiverNode ?? context.sourceFile),
      "rust.backend.provider-operation-source-slots",
      "Finalized Rust provider operation has no exact source node for every runtime input slot.",
    ));
    return { kind: "failed" };
  }
  const stabilizationKeys = providerInputStabilizationKeys(
    context,
    fact,
    operationNode,
    sourceSlots,
    mutableInputs,
    preplannedInputs,
  );
  const hasManagedInput = [...mutableInputs.values()].some((input) =>
    input.kind !== "owned");
  if (!hasManagedInput && stabilizationKeys.size === 0) {
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
  for (const input of rustFinalizedSourceInputs(fact.abi)) {
    if (input.conversion.kind !== "semantic" ||
      input.conversion.conversion.kind !== "rest-sequence") continue;
    const key = providerSourceInputKey(input);
    if (sequenceInputs.has(key)) return { kind: "failed" };
    sequenceInputs.set(key, input);
  }
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
      if (stabilizationKeys.has(slot.key)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, mutable.node),
          "rust.backend.provider-project-field-order",
          "Mutable project-field provider input cannot move across another effectful source input.",
        ));
        return { kind: "failed" };
      }
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
      if (stabilizationKeys.has(slot.key)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, mutable.node),
          "rust.backend.provider-direct-mutable-stabilization",
          "Direct mutable provider input cannot move across another effectful source input without changing its exact storage identity.",
        ));
        return { kind: "failed" };
      }
      const storage = planRustDirectStorageCore(
        mutable.node,
        context,
        preplannedInputs,
        planExpression,
        planProviderOperation,
      );
      if (storage === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, mutable.node),
          "rust.backend.provider-direct-mutable-storage",
          "Direct mutable provider input has no exact Rust storage expression.",
        ));
        return { kind: "failed" };
      }
      sourceValues.set(slot.node, storage);
      continue;
    }
    if (!stabilizationKeys.has(slot.key)) {
      continue;
    }
    const contextual = context.input.program.facts.getFact(slot.node, rustContextualValueConversionFactKey);
    const contract = contextual === undefined ? undefined : rustContextualRuntimeConversionContract(
      contextual.conversion, context.input.program.typeDefinitions);
    let valueContext = context;
    if (slot.evaluationOnly === undefined && contract?.category === "ownership" &&
      contract.sourceMode === "ref" && !contract.fallible &&
      contract.target.kind === "reference" && !contract.target.mutable) {
      const carrier = rustValueCarrierBeforeContextualConversion(context.input.program.facts, slot.node);
      if (!rustTargetTypeRefEquals(carrier, contract.source) ||
        !rustTargetTypeRefEquals(contextual?.sourceCarrier, contract.source) ||
        !rustTargetTypeRefEquals(contextual?.targetCarrier, contract.target)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, slot.node),
          "rust.backend.provider-input-owner-carrier",
          "Borrowed provider input has no exact source owner and contextual target carrier relationship.",
        ));
        return { kind: "failed" };
      }
      const owner = planExpressionBeforeContextualConversion(slot.node, context);
      if (owner === undefined || carrier === undefined) return { kind: "failed" };
      const ownerName = allocateRustSyntheticName(syntheticNames, `operation_input_${index}_value`);
      steps.push({ kind: "binding", name: ownerName, value: owner });
      const expressionOverrides = new Map(context.expressionOverrides);
      expressionOverrides.set(slot.node, { expression: { kind: "path", path: ownerName }, carrier, valueForm: "value" });
      valueContext = { ...context, expressionOverrides };
    }
    const value = planExpression(slot.node, valueContext);
    if (value === undefined) {
      return { kind: "failed" };
    }
    if (slot.evaluationOnly !== undefined) {
      steps.push({ kind: "effect", value, discard: slot.evaluationOnly });
      continue;
    }
    const name = allocateRustSyntheticName(syntheticNames, `operation_input_${index}`);
    steps.push({
      kind: "binding",
      name,
      value,
      ...(mutable?.kind === "owned" ? { mutable: true } : {}),
    });
    sourceValues.set(slot.node, { kind: "path", path: name });
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

function providerInputStabilizationKeys(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  operationNode: Node,
  sourceSlots: readonly { readonly key: string; readonly node: Node }[],
  mutableInputs: ReadonlyMap<string, MutableProviderInput>,
  preplannedInputs: ReadonlyMap<RustFinalizedSourceInput, RustExpr> | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (fact.abi.sourceArguments.some(argument => argument.form === "spread-sequence")) {
    for (const slot of sourceSlots) keys.add(slot.key);
  }
  const inputsBySlot = new Map<string, RustFinalizedSourceInput[]>();
  for (const input of rustFinalizedSourceInputs(fact.abi)) {
    const key = providerSourceInputKey(input);
    const inputs = inputsBySlot.get(key) ?? [];
    inputs.push(input);
    inputsBySlot.set(key, inputs);
  }
  const preplannedKeys = new Set([...inputsBySlot]
    .filter(([, inputs]) => inputs.length > 0 && inputs.every((input) =>
      preplannedInputs?.has(input) === true))
    .map(([key]) => key));
  const targetOrder = providerTargetRuntimeSlotKeys(fact)
    .filter((key) => !preplannedKeys.has(key));
  const targetCounts = new Map<string, number>();
  for (const key of targetOrder) {
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  const effects = new Map(sourceSlots.map((slot) => {
    const mutable = mutableInputs.get(slot.key);
    return [
      slot.key,
      context.expressionOverrides?.get(slot.node)?.expression.kind === "path"
        ? noSourceExpressionEffects
        : mutable?.kind === "direct" || mutable?.kind === "project-field"
        ? providerMutableStorageEffects(mutable.node, context)
        : context.input.program.sourceNavigation.expressionEffects(slot.node),
    ] as const;
  }));
  if (fact.abi.dispatchInputs.length > 0) {
    for (const slot of sourceSlots) {
      if (!preplannedKeys.has(slot.key) && expressionHasEffects(effects.get(slot.key))) keys.add(slot.key);
    }
  }
  const sourceEffectOrder = sourceSlots
    .filter((slot) => !preplannedKeys.has(slot.key) &&
      expressionHasEffects(effects.get(slot.key)))
    .map((slot) => slot.key);
  const targetEffectOrder = targetOrder.filter((key) =>
    expressionHasEffects(effects.get(key)));
  if (!stringSequencesEqual(sourceEffectOrder, targetEffectOrder)) {
    for (const key of sourceEffectOrder) {
      keys.add(key);
    }
  }
  for (const slot of sourceSlots) {
    if ((targetCounts.get(slot.key) ?? 0) > 1) {
      keys.add(slot.key);
    }
  }
  for (let index = 0; index < sourceSlots.length; index += 1) {
    const slot = sourceSlots[index]!;
    if (preplannedKeys.has(slot.key)) {
      continue;
    }
    const inputs = inputsBySlot.get(slot.key) ?? [];
    if (inputs.length !== 0 && rustErrorFieldBorrowNeedsSnapshot(
      slot.node,
      [...sourceSlots.slice(index + 1).map(later => later.node), operationNode],
      context,
    )) {
      keys.add(slot.key);
    }
    if (!inputs.some((input) => rustProviderInputBorrowMode(input) !== undefined)) {
      continue;
    }
    for (let laterIndex = index + 1; laterIndex < sourceSlots.length; laterIndex += 1) {
      const later = sourceSlots[laterIndex]!;
      if (!expressionHasEffects(effects.get(later.key))) {
        continue;
      }
      if (inputs.some((input) =>
        rustProviderInputBorrowMode(input) === "ref" &&
        !rustErrorFieldHasGuardedBorrow(slot.node, context) &&
        !providerInputUsesExistingBorrow(input, slot.node, context) &&
        !context.input.program.borrowStability.canBorrowAcross(slot.node, later.node))) {
        keys.add(slot.key);
      }
      if (inputs.some((input) => rustProviderInputBorrowMode(input) === "mut-ref")) {
        const mutable = mutableInputs.get(slot.key);
        if (mutable?.kind === "owned") {
          keys.add(slot.key);
        } else {
          keys.add(later.key);
        }
      }
    }
  }
  return keys;
}

function providerInputUsesExistingBorrow(
  input: RustFinalizedSourceInput,
  node: Node,
  context: RustPlanContext,
): boolean {
  if (context.expressionOverrides?.get(node)?.valueForm === "shared-reference") {
    return true;
  }
  if (input.mode === "value" && input.conversion.kind === "identity" &&
    input.sourceCarrier.kind === "reference" && !input.sourceCarrier.mutable &&
    rustTargetTypeRefEquals(context.input.program.facts.getRuntimeCarrierFact(node)?.carrier, input.sourceCarrier)) {
    return true;
  }
  if (rustProviderInputBorrowMode(input) === "ref" && context.input.program.valueLifetimes.canBorrowStableValue(node)) {
    return true;
  }
  const sourceParameter = context.input.program.facts.getFact(node, rustSourceParameterAbiFactKey);
  return sourceParameter?.mode === input.mode &&
    rustTargetTypeRefEquals(sourceParameter.parameterCarrier, input.parameterCarrier);
}

function expressionHasEffects(
  effects: SourceExpressionEffects | undefined,
): boolean {
  return effects !== undefined &&
    (effects.invokes || effects.mutates || effects.suspends || effects.mayThrow);
}

function stringSequencesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
