import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression, type SourceExpressionEffects } from "@tsonic/target-api/source";
import { rustFinalizedSourceInputs, type RustFinalizedSourceInput } from "../../../analysis/facts/finalized-operation-abi.js";
import { rustTargetOperationFactKey, rustSourceBindingFactKey, type RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { rustTargetOperationIsDirectLocation } from "../../../analysis/facts/target-operation.js";
import { rustNativeStoragePathsDisjoint, rustNativeStorageProjections, rustNativeStorageRoot,
  type RustNativeStorageProjection } from "../../../analysis/facts/native-storage-paths.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { diagnosticInput, isValidRustIdentifier, rustSourceBindingPath, type RustPlanContext } from "../program/plan-context.js";
import { planRustPromotedStorageLocation, type RustExpressionPlanner } from "../expressions/typed-locations.js";
import { rustDirectProjectFieldStoragePath, rustProjectObjectRepresentation } from "../objects/project-storage.js";
import { providerSourceInputNode, providerSourceInputKey } from "./provider-source-inputs.js";

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
            facts: context.input.program.facts, navigation: context.input.program.sourceNavigation }) : undefined);
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
  const selected: { readonly root: Node; readonly projections: readonly RustNativeStorageProjection[] }[] = [];
  for (const mutable of mutableInputs.values()) {
    const root = mutable.kind === "promoted"
      ? mutable.rootDeclaration
      : mutable.kind === "direct" || mutable.kind === "project-field"
        ? mutable.rootDeclaration
        : undefined;
    if ((mutable.kind === "direct" || mutable.kind === "project-field") &&
      root === undefined && mutableInputs.size > 1) {
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
    const projections = rustNativeStorageProjections(mutable.node, root, { ast: context.input.program.source.ast,
      facts: context.input.program.facts, navigation: context.input.program.sourceNavigation });
    if (projections === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, mutable.node),
        "rust.backend.typed-location-mutable-alias",
        "Mutable provider input has no exact projection path from its source storage root.",
      ));
      return false;
    }
    for (const previous of selected) {
      if (previous.root === root && !rustNativeStoragePathsDisjoint(
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
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
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
    facts: context.input.program.facts, navigation: context.input.program.sourceNavigation });
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
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
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

