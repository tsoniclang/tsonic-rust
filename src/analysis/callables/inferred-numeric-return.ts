import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Initializer, Node_Operand, Node_Type } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { createRustPlanBuilder } from "../facts/plan-store.js";
import { rustSourceCallableReturnFactKey } from "../facts/keys.js";
import { rustOperationContext, rustResolutionContext, selectExpressionOperation } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { selectRustNumericBinaryPromotion } from "../../policy/operations/numeric/promotion.js";
import { isRustBigIntCarrier, isRustAbsenceCarrier, isRustNumericCarrier, rustOptionElementCarrier, rustOptionTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { checkedPropertySelectionInput, selectRustCheckedPropertyAccess } from "../operations/provider/properties.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";

export function selectRustInferredNumericReturn(
  walk: RustFactWalk,
  declaration: Node,
  baseline: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const scalar = rustOptionElementCarrier(baseline) ?? baseline;
  if (baseline === undefined || scalar === undefined ||
    Node_Type(ast, declaration) !== undefined || ast.body(declaration) === undefined ||
    ast.hasModifierKind(declaration, "async") ||
    walk.context.semanticsFor(declaration).operations.generator(declaration) !== undefined) return baseline;
  if (!isRustNumericCarrier(scalar) && !isRustBigIntCarrier(scalar)) {
    return authoredForwardedReturn(walk, declaration) ?? baseline;
  }
  if (walk.inferredNumericReturns.has(declaration)) return walk.inferredNumericReturns.get(declaration);
  if (walk.resolvingNumericReturns.has(declaration)) return baseline;
  walk.resolvingNumericReturns.add(declaration);
  try {
    const facts = createRustPlanBuilder(walk.context.source.sourceFacts, walk.context.typeDefinitions, walk.context.facts);
    const probe: RustFactWalk = {
      ...walk,
      context: { ...walk.context, facts, diagnostics: [] },
      operationAttempts: new WeakSet(),
      postCheckOperations: new WeakMap(),
      rejectedExpressions: new WeakSet(),
      resolving: new Set(),
    };
    const expressions = directReturns(walk, declaration);
    const active = new Set<Node>();
    const carriers = expressions.map(expression => expressionCarrier(expression));
    let selected: TargetTypeRef | undefined;
    for (const carrier of carriers) {
      if (carrier !== undefined && isRustAbsenceCarrier(carrier) && rustOptionElementCarrier(baseline) !== undefined) continue;
      if (carrier === undefined || (!isRustNumericCarrier(carrier) && !isRustBigIntCarrier(carrier))) {
        selected = undefined;
        break;
      }
      selected = selected === undefined ? carrier : rustTargetTypeRefEquals(selected, carrier)
        ? selected : selectRustNumericBinaryPromotion(selected, carrier)?.carrier;
      if (selected === undefined) break;
    }
    const result = expressions.length === 0 ? baseline : selected === undefined ? undefined
      : rustOptionElementCarrier(baseline) === undefined ? selected : rustOptionTargetType(selected);
    walk.inferredNumericReturns.set(declaration, result);
    return result;

    function expressionCarrier(expression: Node): TargetTypeRef | undefined {
      if (active.has(expression)) return undefined;
      active.add(expression);
      try {
        const context = rustResolutionContext(probe, expression);
        const kind = ast.kindName(expression);
        if (kind === "KindParenthesizedExpression" || kind === "KindSatisfiesExpression") {
          const inner = Node_Expression(ast, expression);
          return inner === undefined ? undefined : expressionCarrier(inner);
        }
        if (kind === "KindIdentifier") {
          const selection = walk.context.source.navigation.sourceReferenceFor(expression);
          const reference = selection?.declaration;
          const initializer = reference === undefined ? undefined : Node_Initializer(ast, reference);
          const referenceFile = reference === undefined ? undefined : ast.getSourceFile(reference);
          const unwritten = referenceFile !== undefined && selection?.symbol !== undefined &&
            walk.context.source.navigation.bindingWritesWithin(selection.symbol, referenceFile).length === 0;
          if (reference !== undefined && Node_Type(ast, reference) === undefined &&
            (ast.variableDeclarationKind(reference) === "const" || unwritten) && initializer !== undefined) {
            return expressionCarrier(initializer);
          }
        }
        if (kind === "KindCallExpression") {
          const semantics = walk.context.semanticsFor(expression);
          const call = semantics.operations.call(expression);
          const target = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
          if (target !== undefined && ast.body(target) !== undefined) {
            const sourceResult = call === undefined ? undefined : semantics.operations.callResult(call);
            const carrier = facts.get(target, rustSourceCallableReturnFactKey)?.returnCarrier ??
              resolveRustTargetTypeRef(Node_Type(ast, target) ?? sourceResult?.selectedReturnType, context, walk.operationOptions);
            const selected = selectRustInferredNumericReturn(walk, target, carrier);
            if (selected === undefined) return undefined;
            if (facts.get(target, rustSourceCallableReturnFactKey) === undefined) {
              const completion = walk.context.semanticsFor(target).operations.callableCompletion(target);
              facts.set(target, rustSourceCallableReturnFactKey, {
                returnCarrier: selected,
                ...(completion === undefined ? {} : { canFallThrough: completion.canFallThrough }),
              });
            }
            const sourceFile = ast.getSourceFile(expression);
            if (sourceFile === undefined) return undefined;
            return resolveExpressionCarrier(probe, expression, sourceFile, undefined);
          }
        }
        if (kind === "KindPropertyAccessExpression") {
          const source = context.currentSemantics.operations.propertyAccess(expression);
          if (source === undefined) return undefined;
          const receiver = source.receiver.expression;
          const receiverCarrier = expressionCarrier(receiver);
          if (receiverCarrier === undefined) return undefined;
          facts.set(receiver, rustRuntimeCarrierKey, { carrier: receiverCarrier });
          const selection = selectRustCheckedPropertyAccess(
            checkedPropertySelectionInput(rustOperationContext(probe, expression), expression, source),
            rustOperationContext(probe, expression), walk.operationOptions,
          );
          return selection.kind === "accept" ? selection.value.resultType : undefined;
        }
        const operands = kind === "KindBinaryExpression"
          ? [BinaryExpression_Left(ast, expression), BinaryExpression_Right(ast, expression)]
          : kind === "KindPrefixUnaryExpression" ? [Node_Operand(ast, expression)] : [];
        for (const operand of operands) {
          if (operand === undefined) return undefined;
          const carrier = expressionCarrier(operand);
          if (carrier === undefined) return undefined;
          facts.set(operand, rustRuntimeCarrierKey, { carrier });
        }
        const sourceFile = ast.getSourceFile(expression);
        if (sourceFile !== undefined && kind !== "KindIdentifier") selectExpressionOperation(probe, expression, sourceFile);
        return resolveRustTargetTypeRef(expression, context, walk.operationOptions);
      } finally {
        active.delete(expression);
      }
    }
  } finally {
    walk.resolvingNumericReturns.delete(declaration);
  }
}

function authoredForwardedReturn(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const expressions = directReturns(walk, declaration);
  let selected: TargetTypeRef | undefined;
  for (let expression of expressions) {
    while (ast.is.IsParenthesizedExpression(expression)) {
      const inner = Node_Expression(ast, expression);
      if (inner === undefined) return undefined;
      expression = inner;
    }
    if (!ast.is.IsIdentifier(expression)) return undefined;
    const reference = walk.context.source.navigation.sourceReferenceFor(expression)?.declaration;
    const type = reference === undefined ? undefined : Node_Type(ast, reference);
    if (type === undefined) return undefined;
    const carrier = resolveRustTargetTypeRef(type, rustResolutionContext(walk, expression), walk.operationOptions);
    if (carrier === undefined || selected !== undefined && !rustTargetTypeRefEquals(selected, carrier)) return undefined;
    selected = carrier;
  }
  return selected;
}

function directReturns(walk: RustFactWalk, declaration: Node): readonly Node[] {
  const { ast } = walk.context;
  const body = ast.body(declaration);
  if (body === undefined) return [];
  if (!ast.is.IsBlock(body)) return [body];
  const result: Node[] = [];
  const pending = [body];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node !== body && (ast.is.IsFunctionDeclaration(node) || ast.is.IsFunctionExpression(node) ||
      ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node) ||
      ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node) ||
      ast.is.IsClassDeclaration(node) || ast.is.IsClassExpression(node))) continue;
    if (ast.is.IsReturnStatement(node)) {
      const expression = Node_Expression(ast, node);
      if (expression !== undefined) result.push(expression);
    } else ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return result;
}
