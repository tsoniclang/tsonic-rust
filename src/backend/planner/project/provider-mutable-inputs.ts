import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression, type SourceExpressionEffects } from "@tsonic/target-api/source";
import { rustFinalizedSourceInputs } from "../../../analysis/operations/finalized-operation/conversions.js";
import type { RustFinalizedSourceInput } from "../../../target-model/records/finalized-operation.js";

import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import { rustTargetOperationIsDirectLocation } from "../../../analysis/operations/target-operation.js";
import { rustNativeStorageRoot } from "../../../analysis/storage/native-paths.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput, isValidRustIdentifier, rustSourceBindingPath, type RustPlanContext } from "../program/plan-context.js";
import { planRustPromotedStorageLocation, type RustExpressionPlanner } from "../expressions/typed-locations.js";
import { rustDirectProjectFieldStoragePath, rustProjectObjectRepresentation } from "../objects/project-storage.js";
import { providerSourceInputNode, providerSourceInputKey } from "../../../analysis/operations/provider-source-inputs.js";

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
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  planExpression: RustExpressionPlanner,
): Map<string, MutableProviderInput> | undefined {
  const mutableInputs = new Map<string, MutableProviderInput>();
  for (const input of rustFinalizedSourceInputs(fact.abi)) {
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
        const projectField = providerMutableProjectField(node, context);
        const direct = projectField === undefined && providerMutableInputIsDirect(node, context);
        const rootDeclaration = projectField?.rootDeclaration ??
          (direct ? rustNativeStorageRoot(node, { ast: context.input.program.source.ast,
            records: context.input.program.records, navigation: context.input.program.sourceNavigation }) : undefined);
        mutableInputs.set(
          key,
          projectField !== undefined
            ? {
                kind: "project-field",
                node,
                inputs: [input],
                receiverNode: projectField.receiverNode,
                storagePath: projectField.storagePath,
                ...(rootDeclaration === undefined ? {} : { rootDeclaration }),
              }
            : direct
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

export function mutableRootsAreDisjoint(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  mutableInputs: ReadonlyMap<string, MutableProviderInput>,
  context: RustPlanContext,
): boolean {
  if (mutableInputs.size === 0) return true;
  const proof = context.input.program.providerMutableInputs.forOperation(node);
  if (proof?.kind === "proved" && proof.operation === fact && proof.inputs.length === mutableInputs.size &&
    proof.inputs.every(value => {
      const selected = mutableInputs.get(value.key);
      return selected?.node === value.node && selected.inputs.length === 1 && selected.inputs[0] === value.input;
    })) return true;
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
    "rust.backend.typed-location-mutable-proof", "Mutable native lowering requires its exact sealed source-storage admission proof."));
  return false;
}

function providerMutableInputIsDirect(
  node: Node,
  context: RustPlanContext,
): boolean {
  const { ast } = context.input.program.source;
  if (ast.is.IsIdentifier(node)) {
    const binding = context.input.program.records.sourceBinding.get(node);
    const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    return path !== undefined && isValidRustIdentifier(path);
  }
  const kind = ast.kindName(node);
  if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
    return true;
  }
  const operation = context.input.program.records.targetOperation.get(node);
  return rustTargetOperationIsDirectLocation(operation) ||
    operation?.kind === "source-field" &&
      operation.storage === "project-object" &&
      operation.valueSemantics.kind === "stored" &&
      operation.dispatch === undefined &&
      rustProjectObjectRepresentation(operation.receiverCarrier, context)?.kind === "value";
}

function providerMutableProjectField(
  node: Node,
  context: RustPlanContext,
): {
  readonly receiverNode: Node;
  readonly storagePath: readonly string[];
  readonly rootDeclaration?: Node;
} | undefined {
  const operation = context.input.program.records.targetOperation.get(node);
  if (operation?.kind !== "source-field" || operation.storage !== "project-object" ||
    operation.valueSemantics.kind !== "stored" || operation.dispatch !== undefined) {
    return undefined;
  }
  const representation = rustProjectObjectRepresentation(operation.receiverCarrier, context);
  const storagePath = rustDirectProjectFieldStoragePath(
    operation.receiverCarrier,
    operation.storageIndex,
    context,
  );
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  if (representation === undefined || representation.kind === "value" ||
    representation.kind === "shared-immutable" || storagePath === undefined ||
    receiverNode === undefined) {
    return undefined;
  }
  const rootDeclaration = rustNativeStorageRoot(receiverNode, { ast: context.input.program.source.ast,
    records: context.input.program.records, navigation: context.input.program.sourceNavigation });
  return {
    receiverNode,
    storagePath,
    ...(rootDeclaration === undefined ? {} : { rootDeclaration }),
  };
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

function providerMutableLocationNode(
  sourceNode: Node,
  context: RustPlanContext,
): Node | undefined {
  const operation = context.input.program.records.targetOperation.get(sourceNode);
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
