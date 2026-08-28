import {
  ElementAccessExpression_ArgumentExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPropertyAccessExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import {
  rustSourceBindingFactKey,
  rustTargetOperationFactKey,
} from "../../../../analysis/facts/keys.js";
import {
  rustTargetOperationIsDirectLocation,
} from "../../../../analysis/facts/target-operation.js";
import {
  rustDirectProjectFieldStoragePath,
  rustProjectObjectRepresentation,
} from "../../objects/project-storage.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustSourceBindingPath,
} from "../../program/plan-context.js";
import {
  missingFactDiagnostic,
  unsupportedConstructDiagnostic,
} from "../../diagnostics.js";
import type {
  RustFinalizedSourceInput,
} from "../../../../analysis/facts/finalized-operation-abi.js";
import type {
  RustTargetOperationFact,
} from "../../../../analysis/facts/keys.js";
import type { Node, Symbol } from "@tsonic/tsts";
import type {
  SourceDeclarationReference,
} from "@tsonic/target-api/source";
import type { RustExpr } from "../../../target-ast/nodes.js";
import type {
  RustFinalizedInputPlanOverrides,
} from "../../project/provider-evaluation-scope.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { RustExpressionPlanner } from "../typed-locations.js";

export type RustProviderOperationExpressionPlanner = (
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  options: {
    readonly resultUse: "value" | "storage";
    readonly overrides?: RustFinalizedInputPlanOverrides;
  },
) => RustExpr | undefined;

export function planRustDirectStorageCore(
  operand: Node,
  context: RustPlanContext,
  inputOverrides: ReadonlyMap<RustFinalizedSourceInput, RustExpr> | undefined,
  planExpression: RustExpressionPlanner,
  planProviderOperation: RustProviderOperationExpressionPlanner,
): RustExpr | undefined {
  const { ast } = context.input.program.source;
  const storageOverride = context.expressionOverrides?.get(operand);
  if (storageOverride?.valueForm === "storage") {
    return storageOverride.expression;
  }
  if (ast.kindName(operand) === KindIdentifier) {
    const binding = context.input.program.facts.getFact(operand, rustSourceBindingFactKey);
    const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    return path !== undefined && isValidRustIdentifier(path)
      ? { kind: "path", path }
      : undefined;
  }
  const operandKind = ast.kindName(operand);
  if (operandKind === "KindThisExpression" || operandKind === "KindThisKeyword") {
    return { kind: "path", path: "self" };
  }
  if (operandKind === KindParenthesizedExpression) {
    const inner = Node_Expression(ast, operand);
    return inner === undefined
      ? undefined
      : planRustDirectStorageCore(
          inner,
          context,
          inputOverrides,
          planExpression,
          planProviderOperation,
        );
  }
  const fact = context.input.program.facts.getFact(operand, rustTargetOperationFactKey);
  if (fact?.kind === "source-field" && fact.valueSemantics.kind === "stored" &&
    fact.storage === "project-object" && fact.dispatch === undefined) {
    const representation = rustProjectObjectRepresentation(fact.receiverCarrier, context);
    const storagePath = rustDirectProjectFieldStoragePath(
      fact.receiverCarrier,
      fact.storageIndex,
      context,
    );
    const receiverNode = Node_Expression(ast, operand);
    const receiver = receiverNode === undefined
      ? undefined
      : planRustDirectStorageCore(
          receiverNode,
          context,
          inputOverrides,
          planExpression,
          planProviderOperation,
        );
    return representation?.kind === "value" && storagePath !== undefined && receiver !== undefined
      ? storagePath.reduce<RustExpr>(
          (selected, name) => ({ kind: "field", receiver: selected, name }),
          receiver,
        )
      : undefined;
  }
  if (!rustTargetOperationIsDirectLocation(fact)) {
    return undefined;
  }
  if (fact?.kind === "provider-operation") {
    if (fact.abi.result.kind !== "sync" || fact.abi.result.conversion.kind !== "identity" ||
      fact.abi.effects.invocation !== "infallible" ||
      (fact.abi.target.form !== "field" && fact.abi.target.form !== "index")) {
      return undefined;
    }
    const receiver = Node_Expression(ast, operand);
    const argument = ast.kindName(operand) === KindElementAccessExpression
      ? ElementAccessExpression_ArgumentExpression(ast, operand)
      : undefined;
    const finalizedInputOverrides = new Map(inputOverrides ?? []);
    const receiverInput = fact.abi.targetReceiver.kind === "input"
      ? fact.abi.targetReceiver.input
      : undefined;
    const receiverStorage = receiver === undefined
      ? undefined
      : context.expressionOverrides?.get(receiver);
    if (receiverInput?.source.kind === "receiver") {
      if (receiverInput.conversion.kind !== "identity" || receiver === undefined) {
        return undefined;
      }
      const explicitStorage = receiverStorage?.valueForm === "storage"
        ? receiverStorage.expression
        : undefined;
      const directStorage = explicitStorage ?? planRustDirectStorageCore(
        receiver,
        context,
        inputOverrides,
        planExpression,
        planProviderOperation,
      );
      if (directStorage === undefined || !directStorageRemainsSelected(
        receiver,
        argument === undefined ? [] : [argument],
        explicitStorage !== undefined,
        context,
      )) {
        return undefined;
      }
      finalizedInputOverrides.set(receiverInput, directStorage);
    }
    return planProviderOperation(
      context,
      fact,
      receiver,
      argument === undefined ? [] : [argument],
      operand,
      {
        resultUse: "storage",
        ...(finalizedInputOverrides.size === 0
          ? {}
          : {
              overrides: {
                sourceValues: new Map(),
                inputs: finalizedInputOverrides,
              },
            }),
      },
    );
  }
  if (fact?.kind !== "tuple-index" && fact?.kind !== "fixed-index") {
    return undefined;
  }
  const receiverNode = Node_Expression(ast, operand);
  const indexNode = ElementAccessExpression_ArgumentExpression(ast, operand);
  const explicitReceiverStorage = receiverNode === undefined
    ? undefined
    : context.expressionOverrides?.get(receiverNode);
  const receiver = receiverNode === undefined
    ? undefined
    : explicitReceiverStorage?.valueForm === "storage"
      ? explicitReceiverStorage.expression
      : planRustDirectStorageCore(
          receiverNode,
          context,
          inputOverrides,
          planExpression,
          planProviderOperation,
        );
  if (receiverNode === undefined || receiver === undefined || indexNode === undefined) {
    return undefined;
  }
  const target: RustExpr = fact.kind === "tuple-index"
    ? { kind: "field", receiver, name: String(fact.index) }
    : {
        kind: "index",
        receiver,
        index: { kind: "int-literal", text: String(fact.index) },
      };
  if (ast.kindName(indexNode) === KindNumericLiteral) {
    return target;
  }
  if (!directStorageRemainsSelected(
    receiverNode,
    [indexNode],
    explicitReceiverStorage?.valueForm === "storage",
    context,
  )) {
    return undefined;
  }
  const effect = planExpression(indexNode, context);
  return effect === undefined
    ? undefined
    : { kind: "evaluate-then", effect, discard: "value", value: target };
}

function directStorageRemainsSelected(
  receiver: Node,
  laterExpressions: readonly Node[],
  receiverAlreadySelected: boolean,
  context: RustPlanContext,
): boolean {
  if (receiverAlreadySelected || laterExpressions.length === 0) {
    return true;
  }
  const effectful = laterExpressions.filter((expression) => {
    const effects = context.input.program.sourceNavigation.expressionEffects(expression);
    return effects.invokes || effects.mutates || effects.suspends || effects.mayThrow;
  });
  if (effectful.length === 0) {
    return true;
  }
  const reference = directStorageReference(receiver, context);
  if (reference === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, receiver),
      "rust.backend.direct-storage-identity",
      "Effectful writable projection requires one exact source storage identity.",
    ));
    return false;
  }
  if (effectful.some((expression) =>
    context.input.program.sourceNavigation.bindingWritesWithin(
      reference.symbol,
      expression,
    ).length !== 0)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, receiver),
      "rust.backend.direct-storage-rebinding",
      "Writable projection cannot preserve source evaluation order when a later expression rebinds its selected storage.",
    ));
    return false;
  }
  return true;
}

function directStorageReference(
  node: Node,
  context: RustPlanContext,
): (SourceDeclarationReference & { readonly symbol: Symbol }) | undefined {
  let current: Node | undefined = node;
  while (current !== undefined) {
    const reference = context.input.program.sourceNavigation.sourceReferenceFor(current);
    if (reference !== undefined) {
      return sourceReferenceHasSymbol(reference) ? reference : undefined;
    }
    const kind = context.input.program.source.ast.kindName(current);
    if (kind !== KindPropertyAccessExpression && kind !== KindElementAccessExpression &&
      kind !== KindParenthesizedExpression) {
      return undefined;
    }
    const receiver = Node_Expression(context.input.program.source.ast, current);
    if (receiver === current) {
      return undefined;
    }
    current = receiver;
  }
  return undefined;
}

function sourceReferenceHasSymbol(
  reference: SourceDeclarationReference,
): reference is SourceDeclarationReference & { readonly symbol: Symbol } {
  return reference.symbol !== undefined;
}
