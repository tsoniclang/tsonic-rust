import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Initializer, Node_Operand, Node_Type } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { createRustCarrierProbe } from "../program/carrier-probe.js";

import { rustOperationContext, rustResolutionContext } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";
import { selectRustNumericBinaryPromotion } from "../../policy/operations/numeric/promotion.js";
import { isRustBigIntCarrier, isRustAbsenceCarrier, isRustNumericCarrier, rustOptionElementCarrier, rustOptionTargetType,
  rustSourceOptionalTargetType, rustCallableProtocol, rustCallableTargetType } from "../../target-model/types/index.js";
import { rustCallableTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustLifetimeKey, rustLifetimeOutlives } from "../../target-model/lifetimes/index.js";
import { rustEnclosingStorageContract } from "../../policy/ownership/suspended-storage.js";
import { rustSourceOptionalElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { checkedPropertySelectionInput } from "../operations/provider/properties.js";
import { selectRustCheckedPropertyAccess } from "../operations/selected-members.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { selectRustConditionalNumericCarrier } from "../../policy/types/conditional-numeric-carrier.js";
import { resolveRustBranchUnion } from "../../policy/types/resolution/branch-unions.js";
import { finalizeRustCallableSignature } from "./signature-query.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { RustSourceParameterAbiFact } from "../../target-model/records/callables-and-resources.js";
import type { RustProgramRecordBuilder } from "../program/records/model.js";

export type RustInferredReturnSelection =
  | { readonly kind: "complete"; readonly carrier: TargetTypeRef }
  | { readonly kind: "pending"; readonly hint?: TargetTypeRef };

interface RustInferredReturnCompletion {
  readonly baseline: TargetTypeRef;
  readonly parameterAbis: readonly RustSourceParameterAbiFact[];
  readonly callable?: Node;
  readonly receiver?: TargetTypeRef;
  readonly superReceiver?: TargetTypeRef;
  readonly carrier: TargetTypeRef;
}

export type RustInferredReturnMemo = WeakMap<RustProgramRecordBuilder,
  WeakMap<Node, readonly RustInferredReturnCompletion[]>>;

export function selectRustInferredReturn(
  walk: RustFactWalk,
  declaration: Node,
  baseline: TargetTypeRef | undefined,
): RustInferredReturnSelection {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const scalar = rustOptionElementCarrier(baseline) ?? baseline;
  const annotated = Node_Type(ast, declaration) !== undefined;
  if (baseline === undefined || scalar === undefined) return { kind: "pending" };
  const callable = rustCallableProtocol(scalar);
  const inferEnvironment = annotated && scalar.kind === "target-named" && scalar.id === rustCallableTargetId &&
    callable?.lifetime?.kind === "placeholder";
  if (annotated && !inferEnvironment || ast.body(declaration) === undefined ||
    walk.context.semanticsFor(declaration).operations.generator(declaration) !== undefined) return { kind: "complete", carrier: baseline };
  const numericResult = isRustNumericCarrier(scalar) || isRustBigIntCarrier(scalar);
  const parameterAbis: RustSourceParameterAbiFact[] = [];
  for (const parameter of ast.parameters(declaration)) {
    const selected = walk.context.records.sourceParameterAbi.get(parameter);
    if (selected === undefined) return { kind: "pending", hint: baseline };
    parameterAbis.push(selected);
  }
  const memo = walk.inferredReturns.get(walk.context.records);
  const completed = memo?.get(declaration)?.find(entry => rustTargetTypeRefEquals(entry.baseline, baseline) &&
    entry.parameterAbis.length === parameterAbis.length && entry.parameterAbis.every((abi, index) => abi === parameterAbis[index]) &&
    entry.callable === walk.currentCallableDeclaration && rustTargetTypeRefEquals(entry.receiver, walk.currentThisCarrier) &&
    rustTargetTypeRefEquals(entry.superReceiver, walk.currentSuperCarrier));
  if (completed !== undefined) return { kind: "complete", carrier: completed.carrier };
  if (walk.resolvingReturns.has(declaration)) return { kind: "pending", hint: baseline };
  walk.resolvingReturns.add(declaration);
  try {
    const probe = createRustCarrierProbe({ ...walk, currentCallableDeclaration: declaration });
    const records = probe.context.records;
    const expressions = directReturns(walk, declaration);
    const active = new Set<Node>();
    const carriers = expressions.map(expression => expressionCarrier(expression, inferEnvironment ? baseline : undefined));
    if (carriers.some(carrier => carrier === undefined)) return { kind: "pending", hint: baseline };
    let selected: TargetTypeRef | undefined;
    for (const carrier of carriers) {
      if (carrier !== undefined && isRustAbsenceCarrier(carrier) && rustOptionElementCarrier(baseline) !== undefined) continue;
      const value = rustOptionElementCarrier(baseline) === undefined ? carrier : rustOptionElementCarrier(carrier) ?? carrier;
      if (value === undefined || numericResult && !isRustNumericCarrier(value) && !isRustBigIntCarrier(value)) {
        selected = undefined;
        break;
      }
      selected = selected === undefined ? value : rustTargetTypeRefEquals(selected, value)
        ? selected : numericResult ? selectRustNumericBinaryPromotion(selected, value)?.carrier : undefined;
      if (selected === undefined) break;
    }
    let result = expressions.length === 0 ? baseline : selected === undefined ? numericResult ? undefined : baseline
      : rustOptionElementCarrier(baseline) === undefined ? selected
        : rustSourceOptionalElementCarrier(baseline) === undefined ? rustOptionTargetType(selected)
          : rustSourceOptionalTargetType(selected);
    if (inferEnvironment) result = inferredCallableEnvironment(carriers, baseline) ?? baseline;
    if (result === undefined) return { kind: "pending", hint: baseline };
    let local = memo;
    if (local === undefined) walk.inferredReturns.set(walk.context.records, local = new WeakMap());
    local.set(declaration, Object.freeze([...(local.get(declaration) ?? []), Object.freeze({ baseline,
      parameterAbis: Object.freeze(parameterAbis), callable: walk.currentCallableDeclaration,
      receiver: walk.currentThisCarrier, superReceiver: walk.currentSuperCarrier, carrier: result,
    })]));
    return { kind: "complete", carrier: result };

    function inferredCallableEnvironment(values: readonly (TargetTypeRef | undefined)[], target: TargetTypeRef): TargetTypeRef | undefined {
      const payload = rustOptionElementCarrier(target) ?? target;
      const requested = rustCallableProtocol(payload);
      if (payload.kind !== "target-named" || payload.id !== rustCallableTargetId ||
        requested?.lifetime?.kind !== "placeholder") return undefined;
      const protocols = values.filter(value => rustOptionElementCarrier(target) === undefined ||
        value === undefined || !isRustAbsenceCarrier(value))
        .map(value => rustCallableProtocol(rustOptionElementCarrier(value) ?? value));
      if (protocols.length === 0 || protocols.some(protocol => protocol?.lifetime === undefined ||
        protocol.lifetime.kind === "placeholder" || protocol.parameters.length !== requested.parameters.length ||
        protocol.parameters.some((parameter, index) => !rustTargetTypeRefEquals(parameter, requested.parameters[index])) ||
        !rustTargetTypeRefEquals(protocol.result, requested.result) || !rustTargetTypeRefEquals(protocol.error, requested.error))) return undefined;
      const lifetimes = new Map(protocols.flatMap(protocol => protocol?.lifetime === undefined
        ? [] : [[rustLifetimeKey(protocol.lifetime), protocol.lifetime] as const]));
      const contract = rustEnclosingStorageContract(declaration, ast, walk.context.sourceLifetimes);
      const selected = [...lifetimes.values()].filter(candidate =>
        [...lifetimes.values()].every(source => rustLifetimeOutlives(source, candidate, contract)));
      if (selected.length !== 1) return undefined;
      const refined = rustCallableTargetType(requested.parameters, requested.result, selected[0], requested.error);
      return rustOptionElementCarrier(target) === undefined ? refined
        : rustSourceOptionalElementCarrier(target) === undefined ? rustOptionTargetType(refined)
          : rustSourceOptionalTargetType(refined);
    }

    function expressionCarrier(expression: Node, expected?: TargetTypeRef): TargetTypeRef | undefined {
      if (active.has(expression)) return undefined;
      active.add(expression);
      try {
        const context = rustResolutionContext(probe, expression);
        const kind = ast.kindName(expression);
        if (kind === "KindParenthesizedExpression" || kind === "KindSatisfiesExpression") {
          const inner = Node_Expression(ast, expression);
          return inner === undefined ? undefined : expressionCarrier(inner, expected);
        }
        if (kind === "KindIdentifier") {
          const selection = walk.context.source.navigation.sourceReferenceFor(expression);
          const reference = selection?.declaration;
          const parameter = reference === undefined ? undefined : records.sourceParameterAbi.get(reference);
          if (parameter !== undefined) return parameter.valueCarrier;
          if (reference !== undefined && ast.kindName(reference) === "KindParameter") return undefined;
          const initializer = reference === undefined ? undefined : Node_Initializer(ast, reference);
          const referenceFile = reference === undefined ? undefined : ast.getSourceFile(reference);
          const unwritten = referenceFile !== undefined && selection?.symbol !== undefined &&
            walk.context.source.navigation.bindingWritesWithin(selection.symbol, referenceFile).length === 0;
          const annotation = reference === undefined ? undefined : Node_Type(ast, reference);
          if (reference !== undefined && (annotation === undefined || expected !== undefined) &&
            (ast.variableDeclarationKind(reference) === "const" || unwritten) && initializer !== undefined) {
            const contextual = annotation === undefined ? expected
              : resolveRustTargetTypeRef(annotation, rustResolutionContext(probe, reference), probe.operationOptions);
            if (annotation !== undefined && contextual === undefined) return undefined;
            return expressionCarrier(initializer, contextual);
          }
        }
        if (ast.is.IsConditionalExpression(expression)) {
          const conditional = ast.as.AsConditionalExpression(expression);
          if (conditional?.WhenTrue === undefined || conditional.WhenFalse === undefined) return undefined;
          const left = expressionCarrier(conditional.WhenTrue, expected);
          const right = expressionCarrier(conditional.WhenFalse, expected);
          if (left === undefined || right === undefined) return undefined;
          const retained = expected === undefined ? undefined : inferredCallableEnvironment([left, right], expected);
          if (retained !== undefined) return retained;
          return selectRustConditionalNumericCarrier(conditional.WhenTrue, conditional.WhenFalse, left, right, walk.context.literalValues) ??
            (left === undefined || right === undefined ? undefined : resolveRustBranchUnion(expression, [
              { expression: conditional.WhenTrue, carrier: left },
              { expression: conditional.WhenFalse, carrier: right },
            ], context, probe.operationOptions)) ??
            resolveRustTargetTypeRef(expression, context, probe.operationOptions);
        }
        if (kind === "KindCallExpression") {
          const semantics = walk.context.semanticsFor(expression);
          const call = semantics.operations.call(expression);
          const target = call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
          if (target !== undefined && walk.context.source.navigation.isProjectDeclaration(target) && !ast.hasModifierKind(target, "async") &&
            walk.context.semanticsFor(target).operations.generator(target) === undefined) {
            if (finalizeRustCallableSignature(probe, target) === undefined) return undefined;
            const sourceFile = ast.getSourceFile(expression);
            if (sourceFile === undefined) return undefined;
            return resolveExpressionCarrier(probe, expression, sourceFile, expected);
          }
        }
        if (kind === "KindPropertyAccessExpression") {
          const source = context.currentSemantics.operations.propertyAccess(expression);
          if (source === undefined) return undefined;
          const receiver = source.receiver.expression;
          const receiverCarrier = expressionCarrier(receiver);
          if (receiverCarrier === undefined) return undefined;
          if (setCarrierFact(probe, receiver, receiverCarrier) === undefined) return undefined;
          const selection = selectRustCheckedPropertyAccess(
            checkedPropertySelectionInput(rustOperationContext(probe, expression), expression, source),
            rustOperationContext(probe, expression), probe.operationOptions,
          );
          return selection.kind === "accept" ? selection.value.resultType : undefined;
        }
        const operands = kind === "KindBinaryExpression"
          ? [BinaryExpression_Left(ast, expression), BinaryExpression_Right(ast, expression)]
          : kind === "KindPrefixUnaryExpression" ? [Node_Operand(ast, expression)]
            : kind === "KindAwaitExpression" ? [Node_Expression(ast, expression)] : [];
        for (const operand of operands) {
          if (operand === undefined) return undefined;
          const carrier = expressionCarrier(operand);
          if (carrier === undefined) return undefined;
          if (setCarrierFact(probe, operand, carrier) === undefined) return undefined;
        }
        const sourceFile = ast.getSourceFile(expression);
        return sourceFile !== undefined && kind !== "KindIdentifier"
          ? resolveExpressionCarrier(probe, expression, sourceFile, expected)
          : resolveRustTargetTypeRef(expression, context, probe.operationOptions);
      } finally {
        active.delete(expression);
      }
    }
  } finally {
    walk.resolvingReturns.delete(declaration);
  }
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
