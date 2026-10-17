import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression, type SourceExpressionEffects } from "@tsonic/target-api/source";
import { rustFinalizedSourceInputs } from "../../../analysis/operations/finalized-operation/conversions.js";
import type { RustFinalizedSourceInput } from "../../../target-model/records/finalized-operation.js";

import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import { rustTargetOperationIsDirectLocation } from "../../../analysis/operations/target-operation.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustLocationStorage, type RustExpressionPlanner } from "../expressions/typed-locations.js";

export type MutableProviderInput =
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
      readonly kind: "project-field";
      readonly node: Node;
      readonly inputs: RustFinalizedSourceInput[];
      readonly receiverNode: Node;
      readonly storagePath: readonly string[];
      readonly rootDeclaration?: Node;
    }
  | {
      readonly kind: "owned";
      readonly node: Node;
      readonly inputs: RustFinalizedSourceInput[];
    };

export function collectMutableInputs(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" | "runtime-set" }>,
  operationNode: Node,
  planExpression: RustExpressionPlanner,
): Map<string, MutableProviderInput> | undefined {
  const mutableInputs = new Map<string, MutableProviderInput>();
  if (!rustFinalizedSourceInputs(fact.abi).some(input => input.mode === "mut-ref")) return mutableInputs;
  const emission = context.emissionContext;
  if (emission === undefined) return failRustPlannerInvariant(
    "A mutable native source operation requires its original sealed emission context.", operationNode);
  const proof = context.input.program.providerMutableInputs.forOperation(operationNode, fact, emission.use);
  if (proof?.kind !== "proved" || proof.operation !== fact || proof.context !== emission || proof.contextUse !== emission.use)
    return failRustPlannerInvariant("Mutable native rendering requires its exact admitted source-storage proof.", operationNode);
  for (const selected of proof.inputs) {
    const { key, node, input, place } = selected;
    const storage = place.storage;
    if (storage.kind === "promoted") {
      const location = planRustLocationStorage(node, storage.expression, true, context, planExpression);
      if (location === undefined) return undefined;
      mutableInputs.set(key, { kind: "promoted", node, inputs: [input], location, rootDeclaration: storage.declaration });
    } else if (storage.kind === "project-field") {
      mutableInputs.set(key, { kind: "project-field", node, inputs: [input], receiverNode: storage.receiverNode,
        storagePath: storage.storagePath,
        ...(storage.rootDeclaration === undefined ? {} : { rootDeclaration: storage.rootDeclaration }) });
    } else if (storage.kind === "direct") {
      const rootDeclaration = place.sourcePath?.declaration;
      mutableInputs.set(key, { kind: "direct", node, inputs: [input],
        ...(rootDeclaration === undefined ? {} : { rootDeclaration }) });
    } else {
      mutableInputs.set(key, { kind: "owned", node, inputs: [input] });
    }
  }
  return mutableInputs;
}

export function providerMutableStorageEffects(
  node: Node,
  context: RustPlanContext,
): SourceExpressionEffects {
  const { ast } = context.input.program.source;
  const kind = ast.kindName(node);
  if (kind === "KindParenthesizedExpression") {
    const inner = Node_Expression(ast, node);
    return inner === undefined
      ? context.input.program.sourceNavigation.expressionEffects(node)
      : providerMutableStorageEffects(inner, context);
  }
  if (kind === "KindIdentifier" || kind === "KindThisExpression" ||
    kind === "KindThisKeyword") {
    return noSourceExpressionEffects;
  }
  const operation = context.input.program.records.targetOperation.get(node);
  const receiver = Node_Expression(ast, node);
  if (receiver === undefined) {
    return context.input.program.sourceNavigation.expressionEffects(node);
  }
  if (kind === "KindPropertyAccessExpression" &&
    (rustTargetOperationIsDirectLocation(operation) ||
      operation?.kind === "source-field" && operation.valueSemantics.kind === "stored" &&
        operation.dispatch === undefined)) {
    return providerMutableStorageEffects(receiver, context);
  }
  if (kind === "KindElementAccessExpression" && rustTargetOperationIsDirectLocation(operation)) {
    const index = ElementAccessExpression_ArgumentExpression(ast, node);
    return mergeSourceExpressionEffects(
      providerMutableStorageEffects(receiver, context),
      index === undefined
        ? context.input.program.sourceNavigation.expressionEffects(node)
        : context.input.program.sourceNavigation.expressionEffects(index),
    );
  }
  return context.input.program.sourceNavigation.expressionEffects(node);
}

export const noSourceExpressionEffects: SourceExpressionEffects = Object.freeze({
  invokes: false,
  mutates: false,
  suspends: false,
  mayThrow: false,
});

function mergeSourceExpressionEffects(
  left: SourceExpressionEffects,
  right: SourceExpressionEffects,
): SourceExpressionEffects {
  return {
    invokes: left.invokes || right.invokes,
    mutates: left.mutates || right.mutates,
    suspends: left.suspends || right.suspends,
    mayThrow: left.mayThrow || right.mayThrow,
  };
}
