import type { Node } from "@tsonic/tsts";
import {
  Node_Expression,
  type SourceExpressionEffects,
} from "@tsonic/target-api/source";
import type {
  RustFinalizedSourceInput,
} from "../../../analysis/facts/finalized-operation-abi.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedConstantInput,
  isRustFinalizedSliceInput,
  isRustFinalizedTaggedArrayInput,
} from "../../../analysis/facts/finalized-operation-abi.js";
import type {
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import {
  rustTargetOperationFactKey,
  rustSourceBindingFactKey,
  rustSourceParameterAbiFactKey,
} from "../../../analysis/facts/keys.js";
import {
  rustTargetOperationIsDirectLocation,
} from "../../../analysis/facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../diagnostics.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustSourceBindingPath,
} from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  planRustPromotedStorageLocation,
} from "../expressions/typed-locations.js";
import type {
  RustExpressionPlanner,
} from "../expressions/typed-locations.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";

export interface RustFinalizedInputPlanOverrides {
  readonly sourceValues: ReadonlyMap<Node, RustExpr>;
  readonly inputs: ReadonlyMap<RustFinalizedSourceInput, RustExpr>;
}

export type RustProviderEvaluationScopeSelection =
  | { readonly kind: "none" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "selected";
      readonly bindings: readonly {
        readonly name: string;
        readonly value: RustExpr;
        readonly mutable?: boolean;
      }[];
      readonly mutableLocations: readonly {
        readonly name: string;
        readonly ownerName: string;
      }[];
      readonly overrides: RustFinalizedInputPlanOverrides;
    };

export function planRustProviderEvaluationScope(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  planExpression: RustExpressionPlanner,
  preplannedInputs?: ReadonlyMap<RustFinalizedSourceInput, RustExpr>,
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
    sourceSlots,
    mutableInputs,
    preplannedInputs,
  );
  const hasPromotedInput = [...mutableInputs.values()].some((input) =>
    input.kind === "promoted");
  if (!hasPromotedInput && stabilizationKeys.size === 0) {
    return { kind: "none" };
  }
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
    readonly mutable?: boolean;
  }[] = [];
  const mutableLocations: { readonly name: string; readonly ownerName: string }[] = [];
  const sourceValues = new Map<Node, RustExpr>();
  const inputOverrides = new Map<RustFinalizedSourceInput, RustExpr>();
  const nameRoot = receiverNode ?? argumentNodes.find((node): node is Node => node !== undefined) ??
    context.sourceFile;
  const syntheticNames = context.syntheticNames ??
    createRustSyntheticNameState(context.input.program.source.ast, nameRoot, []);
  for (const [index, slot] of sourceSlots.entries()) {
    const mutable = mutableInputs.get(slot.key);
    if (mutable?.kind === "promoted") {
      const name = allocateRustSyntheticName(syntheticNames, `location_${index}`);
      const ownerName = allocateRustSyntheticName(syntheticNames, `location_value_${index}`);
      bindings.push({ name, value: mutable.location });
      mutableLocations.push({ name, ownerName });
      for (const input of mutable.inputs) {
        inputOverrides.set(input, { kind: "path", path: ownerName });
      }
      continue;
    }
    if (!stabilizationKeys.has(slot.key)) {
      continue;
    }
    if (mutable?.kind === "direct") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, mutable.node),
        "rust.backend.provider-direct-mutable-stabilization",
        "Direct mutable provider input cannot be materialized without changing its exact storage identity.",
      ));
      return { kind: "failed" };
    }
    const value = planExpression(slot.node, context);
    if (value === undefined) {
      return { kind: "failed" };
    }
    const name = allocateRustSyntheticName(syntheticNames, `operation_input_${index}`);
    bindings.push({
      name,
      value,
      ...(mutable?.kind === "owned" ? { mutable: true } : {}),
    });
    sourceValues.set(slot.node, { kind: "path", path: name });
  }
  return {
    kind: "selected",
    bindings,
    mutableLocations,
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
  return {
    kind: "block",
    bindings: scope.bindings,
    value,
  };
}

function providerInputStabilizationKeys(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  sourceSlots: readonly { readonly key: string; readonly node: Node }[],
  mutableInputs: ReadonlyMap<string, MutableProviderInput>,
  preplannedInputs: ReadonlyMap<RustFinalizedSourceInput, RustExpr> | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  const inputsBySlot = new Map<string, RustFinalizedSourceInput[]>();
  for (const input of providerSourceInputs(fact)) {
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
  const effects = new Map(sourceSlots.map((slot) => [
    slot.key,
    context.input.program.sourceNavigation.expressionEffects(slot.node),
  ]));
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
  for (let index = 0; index < sourceSlots.length - 1; index += 1) {
    const slot = sourceSlots[index]!;
    if (preplannedKeys.has(slot.key)) {
      continue;
    }
    const inputs = inputsBySlot.get(slot.key) ?? [];
    if (!inputs.some((input) => input.mode !== "value")) {
      continue;
    }
    for (let laterIndex = index + 1; laterIndex < sourceSlots.length; laterIndex += 1) {
      const later = sourceSlots[laterIndex]!;
      if (!expressionHasEffects(effects.get(later.key))) {
        continue;
      }
      if (inputs.some((input) =>
        input.mode === "ref" &&
        !providerInputUsesExistingBorrow(input, slot.node, context))) {
        keys.add(slot.key);
      }
      if (inputs.some((input) => input.mode === "mut-ref")) {
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

function providerTargetRuntimeSlotKeys(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
): readonly string[] {
  const keys: string[] = [];
  const collect = (input: import("../../../analysis/facts/finalized-operation-abi.js").RustFinalizedTargetInput): void => {
    if (isRustFinalizedConstantInput(input)) {
      return;
    }
    if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
      for (const element of input.elements) {
        keys.push(providerSourceInputKey(element));
      }
      return;
    }
    if (isRustFinalizedTaggedArrayInput(input)) {
      for (const element of input.elements) {
        keys.push(providerSourceInputKey(element.input));
      }
      return;
    }
    keys.push(providerSourceInputKey(input));
  };
  if (fact.abi.targetReceiver.kind === "input") {
    collect(fact.abi.targetReceiver.input);
  }
  for (const input of fact.abi.targetArguments) {
    collect(input);
  }
  return keys;
}

type MutableProviderInput =
  | {
      readonly kind: "promoted";
      readonly node: Node;
      readonly inputs: RustFinalizedSourceInput[];
      readonly location: RustExpr;
      readonly rootDeclaration: Node;
    }
  | {
      readonly kind: "direct";
      readonly node: Node;
      readonly inputs: RustFinalizedSourceInput[];
      readonly rootDeclaration?: Node;
    }
  | {
      readonly kind: "owned";
      readonly node: Node;
      readonly inputs: RustFinalizedSourceInput[];
    };

function collectMutableInputs(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  planExpression: RustExpressionPlanner,
): Map<string, MutableProviderInput> | undefined {
  const mutableInputs = new Map<string, MutableProviderInput>();
  for (const input of providerSourceInputs(fact)) {
    if (input.mode !== "mut-ref") {
      continue;
    }
    const sourceNode = providerSourceInputNode(input, receiverNode, argumentNodes);
    if (sourceNode === undefined) {
      return undefined;
    }
    const node = providerMutableLocationNode(sourceNode, context);
    if (node === undefined) {
      return undefined;
    }
    if (input.conversion.kind !== "identity") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.typed-location-mutable-input",
        "Mutable provider input requires one exact identity conversion.",
      ));
      return undefined;
    }
    const location = planRustPromotedStorageLocation(
      node,
      context,
      planExpression,
      true,
    );
    if (location.kind === "promoted" && location.expression === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.typed-location-mutable-input",
        "Promoted mutable provider input has no exact Rust location expression.",
      ));
      return undefined;
    }
    const key = providerSourceInputKey(input);
    const existing = mutableInputs.get(key);
    if (existing === undefined) {
      if (location.kind === "promoted") {
        const expression = location.expression;
        if (expression === undefined) {
          return undefined;
        }
        mutableInputs.set(key, {
          kind: "promoted",
          node,
          inputs: [input],
          location: expression,
          rootDeclaration: location.rootDeclaration,
        });
      } else {
        const direct = providerMutableInputIsDirect(node, context);
        const rootDeclaration = direct
          ? providerDirectMutableRoot(node, context)
          : undefined;
        mutableInputs.set(
          key,
          direct
            ? {
                kind: "direct",
                node,
                inputs: [input],
                ...(rootDeclaration === undefined
                  ? {}
                  : { rootDeclaration }),
              }
            : {
                kind: "owned",
                node,
                inputs: [input],
              },
        );
      }
    } else {
      existing.inputs.push(input);
    }
  }
  return mutableInputs;
}

function mutableRootsAreDisjoint(
  mutableInputs: ReadonlyMap<string, MutableProviderInput>,
  context: RustPlanContext,
): boolean {
  for (const mutable of mutableInputs.values()) {
    if (mutable.inputs.length !== 1) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, mutable.node),
        "rust.backend.typed-location-mutable-alias",
        "One source value cannot supply multiple mutable inputs to one Rust provider operation.",
      ));
      return false;
    }
  }
  if (mutableInputs.size <= 1) {
    return true;
  }
  const selected: { readonly root: Node; readonly projections: readonly string[] }[] = [];
  for (const mutable of mutableInputs.values()) {
    const root = mutable.kind === "promoted"
      ? mutable.rootDeclaration
      : mutable.kind === "direct"
        ? mutable.rootDeclaration
        : undefined;
    if (mutable.kind === "direct" && root === undefined && mutableInputs.size > 1) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, mutable.node),
        "rust.backend.typed-location-mutable-alias",
        "Multiple direct mutable provider inputs require exact disjoint source storage roots.",
      ));
      return false;
    }
    if (root === undefined) {
      continue;
    }
    const projections = providerMutableStorageProjections(mutable.node, root, context);
    if (projections === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, mutable.node),
        "rust.backend.typed-location-mutable-alias",
        "Mutable provider input has no exact projection path from its source storage root.",
      ));
      return false;
    }
    for (const previous of selected) {
      if (previous.root === root && !providerProjectionPathsAreDisjoint(
        previous.projections,
        projections,
      )) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, mutable.node),
          "rust.backend.typed-location-mutable-alias",
          "One provider operation cannot hold overlapping mutable Rust locations from the same exact source storage root.",
        ));
        return false;
      }
    }
    selected.push({ root, projections });
  }
  return true;
}

function providerMutableStorageProjections(
  node: Node,
  rootDeclaration: Node,
  context: RustPlanContext,
): readonly string[] | undefined {
  const { ast } = context.input.program.source;
  const projections: string[] = [];
  let selected = node;
  while (true) {
    const kind = ast.kindName(selected);
    if (kind === "KindParenthesizedExpression") {
      const inner = Node_Expression(ast, selected);
      if (inner === undefined) return undefined;
      selected = inner;
      continue;
    }
    if (kind === "KindIdentifier") {
      const declaration = context.input.program.sourceNavigation.sourceReferenceFor(selected)?.declaration;
      return declaration === rootDeclaration ? Object.freeze(projections) : undefined;
    }
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      return ast.getSourceFile(selected) === rootDeclaration
        ? Object.freeze(projections)
        : undefined;
    }
    if (kind !== "KindPropertyAccessExpression") return undefined;
    const operation = context.input.program.facts.getFact(selected, rustTargetOperationFactKey);
    if (operation?.kind !== "source-field" || operation.valueSemantics.kind !== "stored" ||
      operation.dispatch !== undefined) {
      return undefined;
    }
    projections.unshift(`${operation.operationId}\0${operation.storageIndex}`);
    const receiver = Node_Expression(ast, selected);
    if (receiver === undefined) return undefined;
    selected = receiver;
  }
}

function providerProjectionPathsAreDisjoint(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (left[index] !== right[index]) return true;
  }
  return false;
}

function providerMutableInputIsDirect(
  node: Node,
  context: RustPlanContext,
): boolean {
  const { ast } = context.input.program.source;
  if (ast.is.IsIdentifier(node)) {
    const binding = context.input.program.facts.getFact(node, rustSourceBindingFactKey);
    const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    return path !== undefined && isValidRustIdentifier(path);
  }
  const kind = ast.kindName(node);
  if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
    return true;
  }
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  return rustTargetOperationIsDirectLocation(operation) ||
    operation?.kind === "source-field" &&
      operation.storage === "project-object" &&
      operation.valueSemantics.kind === "stored" &&
      operation.dispatch === undefined;
}

function providerDirectMutableRoot(
  node: Node,
  context: RustPlanContext,
): Node | undefined {
  const { ast } = context.input.program.source;
  if (ast.is.IsIdentifier(node)) {
    return context.input.program.sourceNavigation.sourceReferenceFor(node)?.declaration;
  }
  const kind = ast.kindName(node);
  if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
    return ast.getSourceFile(node);
  }
  const receiver = Node_Expression(ast, node);
  return receiver === undefined || receiver === node
    ? undefined
    : providerDirectMutableRoot(receiver, context);
}

function sourceRuntimeSlots(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
): readonly { readonly key: string; readonly node: Node }[] | undefined {
  const slots: { readonly key: string; readonly node: Node }[] = [];
  if (fact.abi.sourceReceiver.kind === "receiver" &&
    fact.abi.sourceReceiver.disposition === "runtime") {
    if (receiverNode === undefined) {
      return undefined;
    }
    slots.push({ key: "receiver", node: receiverNode });
  }
  for (const argument of fact.abi.sourceArguments) {
    if (argument.disposition !== "runtime") {
      continue;
    }
    const node = argumentNodes[argument.sourceIndex];
    if (node === undefined) {
      return undefined;
    }
    slots.push({ key: `argument:${argument.sourceIndex}`, node });
  }
  return slots;
}

function providerMutableLocationNode(
  sourceNode: Node,
  context: RustPlanContext,
): Node | undefined {
  const operation = context.input.program.facts.getFact(
    sourceNode,
    rustTargetOperationFactKey,
  );
  if (operation?.kind !== "flow-marker") {
    return sourceNode;
  }
  const arguments_ = [...context.input.program.source.ast.arguments(sourceNode)];
  if (operation.state === "borrowed-mut" &&
    arguments_.length === 1 && arguments_[0] !== undefined) {
    return arguments_[0];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, sourceNode),
    "rust.backend.typed-location-mutable-flow",
    "Promoted mutable provider input requires one exact finalized mutable-borrow operand.",
  ));
  return undefined;
}

function providerSourceInputs(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
): readonly RustFinalizedSourceInput[] {
  return [
    ...(fact.abi.targetReceiver.kind === "input"
      ? [fact.abi.targetReceiver.input]
      : []),
    ...fact.abi.targetArguments.flatMap((input) =>
      isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input) ? input.elements :
        isRustFinalizedTaggedArrayInput(input) ? input.elements.map((element) => element.input) :
        isRustFinalizedConstantInput(input) ? [] : [input]),
  ];
}

function providerSourceInputNode(
  input: RustFinalizedSourceInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
): Node | undefined {
  return input.source.kind === "receiver"
    ? receiverNode
    : argumentNodes[input.source.sourceIndex];
}

function providerSourceInputKey(input: RustFinalizedSourceInput): string {
  return input.source.kind === "receiver"
    ? "receiver"
    : `argument:${input.source.sourceIndex}`;
}
