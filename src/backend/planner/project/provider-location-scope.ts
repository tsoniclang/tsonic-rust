import type { Node } from "@tsonic/tsts";
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
} from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../rust-ast/nodes.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../diagnostics.js";
import {
  diagnosticInput,
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

export type RustProviderLocationScopeSelection =
  | { readonly kind: "none" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "selected";
      readonly bindings: readonly {
        readonly name: string;
        readonly value: RustExpr;
      }[];
      readonly mutableLocations: readonly {
        readonly name: string;
        readonly ownerName: string;
      }[];
      readonly overrides: RustFinalizedInputPlanOverrides;
    };

export function planRustProviderLocationScope(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  planExpression: RustExpressionPlanner,
): RustProviderLocationScopeSelection {
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
  if (mutableInputs.size === 0) {
    return { kind: "none" };
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
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const mutableLocations: { readonly name: string; readonly ownerName: string }[] = [];
  const sourceValues = new Map<Node, RustExpr>();
  const inputOverrides = new Map<RustFinalizedSourceInput, RustExpr>();
  const nameRoot = receiverNode ?? argumentNodes.find((node): node is Node => node !== undefined) ??
    context.sourceFile;
  const syntheticNames = context.syntheticNames ??
    createRustSyntheticNameState(context.input.ast, nameRoot, []);
  for (const [index, slot] of sourceSlots.entries()) {
    const mutable = mutableInputs.get(slot.key);
    if (mutable !== undefined) {
      const name = allocateRustSyntheticName(syntheticNames, `location_${index}`);
      const ownerName = allocateRustSyntheticName(syntheticNames, `location_value_${index}`);
      bindings.push({ name, value: mutable.location });
      mutableLocations.push({ name, ownerName });
      for (const input of mutable.inputs) {
        inputOverrides.set(input, { kind: "path", path: ownerName });
      }
      continue;
    }
    const value = planExpression(slot.node, context);
    if (value === undefined) {
      return { kind: "failed" };
    }
    const name = allocateRustSyntheticName(syntheticNames, `location_input_${index}`);
    bindings.push({ name, value });
    sourceValues.set(slot.node, { kind: "path", path: name });
  }
  return {
    kind: "selected",
    bindings,
    mutableLocations,
    overrides: { sourceValues, inputs: inputOverrides },
  };
}

export function applyRustProviderLocationScope(
  expression: RustExpr,
  scope: Extract<RustProviderLocationScopeSelection, { readonly kind: "selected" }>,
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

interface MutableProviderInput {
  readonly node: Node;
  readonly inputs: RustFinalizedSourceInput[];
  readonly location: RustExpr;
  readonly rootDeclaration: Node;
}

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
    const location = planRustPromotedStorageLocation(
      node,
      context,
      planExpression,
      true,
    );
    if (location.kind === "not-promoted") {
      continue;
    }
    if (location.expression === undefined || input.conversion.kind !== "identity") {
      if (location.expression !== undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, node),
          "rust.backend.typed-location-mutable-input",
          "Promoted mutable provider input requires one exact identity conversion.",
        ));
      }
      return undefined;
    }
    const key = providerSourceInputKey(input);
    const existing = mutableInputs.get(key);
    if (existing === undefined) {
      mutableInputs.set(key, {
        node,
        inputs: [input],
        location: location.expression,
        rootDeclaration: location.rootDeclaration,
      });
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
  const roots = new Set<Node>();
  for (const mutable of mutableInputs.values()) {
    if (roots.has(mutable.rootDeclaration)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, mutable.node),
        "rust.backend.typed-location-mutable-alias",
        "One provider operation cannot hold multiple mutable Rust locations projected from the same promoted storage root.",
      ));
      return false;
    }
    roots.add(mutable.rootDeclaration);
  }
  return true;
}

function sourceRuntimeSlots(
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
): readonly { readonly key: string; readonly node: Node }[] | undefined {
  const slots: { readonly key: string; readonly node: Node }[] = [];
  if (fact.abi.sourceReceiver.kind === "receiver") {
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
  const operation = context.input.facts.getFact(
    sourceNode,
    rustTargetOperationFactKey,
  );
  if (operation?.kind !== "flow-marker") {
    return sourceNode;
  }
  const arguments_ = [...context.input.ast.arguments(sourceNode)];
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
