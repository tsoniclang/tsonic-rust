import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, Node_Initializer, Node_Operand, Node_Type, ObjectLiteralProperty_Value, sourceCallableValueParameters, sourceReceiverOwner } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { createRustCarrierProbe } from "../program/carrier-probe.js";

import { rustResolutionContext } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { selectRustNumericBinaryPromotion } from "../../policy/operations/numeric/promotion.js";
import { isRustBigIntCarrier, isRustAbsenceCarrier, isRustNumericCarrier, rustOptionElementCarrier, rustOptionTargetType, rustSourceOptionalTargetType, rustCallableProtocol, rustCallableTargetType } from "../../target-model/types/index.js";
import { rustCallableTargetId } from "../../target-model/types/carriers/source-types.js";
import { rustLifetimeKey } from "../../target-model/lifetimes/index.js";
import { rustLifetimeOutlives } from "../../policy/constraints/lifetime-outlives.js";
import { rustEnclosingStorageContract } from "./storage-contracts.js";
import { rustSourceOptionalElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { selectRustConditionalNumericCarrier } from "../../policy/types/conditional-numeric-carrier.js";
import { resolveRustBranchUnion } from "../source-evidence/types/resolution/branch-unions.js";
import { finalizeRustCallableSignature } from "./signature-query.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { RustSourceParameterAbiFact } from "../../target-model/records/callables-and-resources.js";
import type { RustProgramRecordBuilder } from "../program/records/model.js";
import { rustClassCallableMemberOwner, rustClassReceiverCarriers } from "../declarations/classes/receivers.js";
import { rustSourceStorageSubjectContext } from "../source-evidence/types/resolution/source-storage-projection.js";
import { selectRustValueCarrierReconciliation } from "../../policy/conversions/value-carrier-reconciliation.js";

export type RustInferredReturnSelection =
  | { readonly kind: "complete"; readonly carrier: TargetTypeRef }
  | { readonly kind: "pending"; readonly hint?: TargetTypeRef };

interface RustInferredReturnCompletion {
  readonly role: "logical" | "retained";
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
  return selectReturn(walk, declaration, baseline, "logical");
}

export function selectRustRetainedReturn(
  walk: RustFactWalk,
  declaration: Node,
  baseline: TargetTypeRef,
): RustInferredReturnSelection {
  return selectReturn(walk, declaration, baseline, "retained");
}

function selectReturn(
  walk: RustFactWalk,
  declaration: Node,
  baseline: TargetTypeRef | undefined,
  role: "logical" | "retained",
): RustInferredReturnSelection {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const scalar = rustOptionElementCarrier(baseline) ?? baseline;
  const annotated = Node_Type(ast, declaration) !== undefined;
  if (baseline === undefined || scalar === undefined) return { kind: "pending" };
  const callable = rustCallableProtocol(scalar);
  const inferEnvironment = role === "retained" && scalar.kind === "target-named" && scalar.id === rustCallableTargetId &&
    callable?.lifetime?.kind === "placeholder";
  if (!inferEnvironment && (annotated || role === "retained") || ast.body(declaration) === undefined ||
    walk.context.semanticsFor(declaration).operations.generator(declaration) !== undefined) return { kind: "complete", carrier: baseline };
  const numericResult = isRustNumericCarrier(scalar) || isRustBigIntCarrier(scalar);
  const parameterAbis: RustSourceParameterAbiFact[] = [];
  const parameters = sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration));
  if (parameters === undefined) return { kind: "pending", hint: baseline };
  const lexicalOwner = ast.is.IsArrowFunction(declaration) ? sourceReceiverOwner(declaration, ast, "storage") : undefined;
  const classOwner = lexicalOwner === undefined ? undefined : rustClassCallableMemberOwner(walk, lexicalOwner);
  const receivers = classOwner === undefined ? undefined : rustClassReceiverCarriers(walk, classOwner);
  if (classOwner !== undefined && receivers === undefined) return { kind: "pending", hint: baseline };
  const receiver = classOwner === undefined ? walk.currentThisCarrier : receivers?.thisCarrier;
  const superReceiver = classOwner === undefined ? walk.currentSuperCarrier : receivers?.superCarrier;
  for (const parameter of parameters) {
    const selected = walk.context.records.sourceParameterAbi.get(parameter);
    if (selected === undefined) return { kind: "pending", hint: baseline };
    parameterAbis.push(selected);
  }
  const memo = walk.inferredReturns.get(walk.context.records);
  const completed = memo?.get(declaration)?.find(entry => entry.role === role && rustTargetTypeRefEquals(entry.baseline, baseline) &&
    entry.parameterAbis.length === parameterAbis.length && entry.parameterAbis.every((abi, index) => abi === parameterAbis[index]) &&
    entry.callable === walk.currentCallableDeclaration && rustTargetTypeRefEquals(entry.receiver, receiver) &&
    rustTargetTypeRefEquals(entry.superReceiver, superReceiver));
  if (completed !== undefined) return { kind: "complete", carrier: completed.carrier };
  if (walk.resolvingReturns.has(declaration)) return { kind: "pending", hint: baseline };
  walk.resolvingReturns.add(declaration);
  try {
    const probe = createRustCarrierProbe({ ...walk, currentCallableDeclaration: declaration,
      currentThisCarrier: receiver, currentSuperCarrier: superReceiver });
    const records = probe.context.records;
    const expressions = directReturns(walk, declaration);
    const active = new Set<Node>();
    const carriers = expressions.map(expression => expressionCarrier(expression, inferEnvironment ? baseline : undefined));
    if (carriers.some(carrier => carrier === undefined)) {
      // A refusal inside a returned expression is that expression's own exact source diagnostic; the probe's records
      // are discarded, so the refusal is kept on the walk that owns the declaration.
      const failed = expressions.filter((_, index) => carriers[index] === undefined);
      for (const diagnostic of probe.context.diagnostics) {
        const node = diagnostic.sourceNode;
        let owner: Node | undefined = node;
        while (owner !== undefined && !failed.includes(owner)) owner = ast.parent(owner);
        if (owner === undefined || walk.context.diagnostics.some(existing => existing.code === diagnostic.code &&
          existing.sourceNode === node && existing.message === diagnostic.message)) continue;
        walk.context.diagnostics.push(diagnostic);
      }
      return { kind: "pending", hint: baseline };
    }
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
    if (inferEnvironment) result = inferredCallableEnvironment(carriers, baseline);
    if (result === undefined) return { kind: "pending", hint: baseline };
    let local = memo;
    if (local === undefined) walk.inferredReturns.set(walk.context.records, local = new WeakMap());
    local.set(declaration, Object.freeze([...(local.get(declaration) ?? []), Object.freeze({ role, baseline,
      parameterAbis: Object.freeze(parameterAbis), callable: walk.currentCallableDeclaration,
      receiver, superReceiver, carrier: result,
    })]));
    return { kind: "complete", carrier: result };

    function inferredCallableEnvironment(values: readonly (TargetTypeRef | undefined)[], target: TargetTypeRef): TargetTypeRef | undefined {
      const payload = rustOptionElementCarrier(target) ?? target;
      const requested = rustCallableProtocol(payload);
      if (payload.kind !== "target-named" || payload.id !== rustCallableTargetId ||
        requested?.lifetime?.kind !== "placeholder") return undefined;
      const present = values.filter(value => rustOptionElementCarrier(target) === undefined ||
        value === undefined || !isRustAbsenceCarrier(value));
      const protocols = present.map(value => rustCallableProtocol(rustOptionElementCarrier(value) ?? value));
      if (protocols.length === 0 || protocols.some(protocol => protocol?.lifetime === undefined ||
        protocol.lifetime.kind === "placeholder")) return undefined;
      const lifetimes = new Map(protocols.flatMap(protocol => protocol?.lifetime === undefined
        ? [] : [[rustLifetimeKey(protocol.lifetime), protocol.lifetime] as const]));
      const contract = rustEnclosingStorageContract(declaration, ast, walk.context.sourceLifetimes);
      const selected = [...lifetimes.values()].filter(candidate =>
        [...lifetimes.values()].every(source => rustLifetimeOutlives(source, candidate, contract)));
      if (selected.length !== 1) return undefined;
      const refined = rustCallableTargetType(requested.parameters, requested.result, selected[0], requested.error);
      if (present.some(value => value === undefined || selectRustValueCarrierReconciliation(
        rustOptionElementCarrier(value) ?? value, refined, walk.context.projectTypes, walk.context.typeDefinitions,
      ).kind === "incompatible")) return undefined;
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
          if (role === "logical" && reference !== undefined && ast.is.IsFunctionDeclaration(reference)) {
            return resolveRustTargetTypeRef(expression, rustSourceStorageSubjectContext(context, undefined), probe.operationOptions);
          }
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
          if (inferEnvironment && expected !== undefined) {
            const retained = rustTargetTypeRefEquals(left, right) ? left : inferredCallableEnvironment([left, right], expected);
            if (retained === undefined) return undefined;
            return retained;
          }
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
            if (finalizeRustCallableSignature(probe, target).kind !== "complete") return undefined;
            const sourceFile = ast.getSourceFile(expression);
            if (sourceFile === undefined) return undefined;
            return resolveExpressionCarrier(probe, expression, sourceFile, expected, role === "retained" ? "operation" : "value");
          }
        }
        if (kind === "KindPropertyAccessExpression") {
          const source = context.currentSemantics.operations.propertyAccess(expression);
          if (source === undefined) return undefined;
          const receiver = source.receiver.expression;
          const receiverCarrier = expressionCarrier(receiver);
          if (receiverCarrier === undefined) return undefined;
          if (setCarrierFact(probe, receiver, receiverCarrier) === undefined) return undefined;
          const sourceFile = ast.getSourceFile(expression);
          return sourceFile === undefined ? undefined : resolveExpressionCarrier(probe, expression, sourceFile, expected,
            role === "retained" ? "operation" : "value");
        }
        const literalValues = ast.is.IsObjectLiteralExpression(expression)
          ? ast.as.AsObjectLiteralExpression(expression)?.Properties?.Nodes.flatMap(property => {
              if (property === undefined) return [undefined];
              const value = ast.is.IsSpreadAssignment(property) ? Node_Expression(ast, property)
                : ObjectLiteralProperty_Value(ast, property);
              return value === undefined && ast.is.IsMethodDeclaration(property) ? [] : [value];
            })
          : undefined;
        if (ast.is.IsObjectLiteralExpression(expression) && literalValues === undefined) return undefined;
        const operands = literalValues ?? (kind === "KindBinaryExpression"
          ? [BinaryExpression_Left(ast, expression), BinaryExpression_Right(ast, expression)]
          : kind === "KindPrefixUnaryExpression" ? [Node_Operand(ast, expression)]
            : kind === "KindAwaitExpression" ? [Node_Expression(ast, expression)] : []);
        for (const operand of operands) {
          if (operand === undefined) return undefined;
          const carrier = expressionCarrier(operand);
          if (carrier === undefined) return undefined;
          if (setCarrierFact(probe, operand, carrier) === undefined) return undefined;
        }
        if (role === "logical" && ast.is.IsObjectLiteralExpression(expression)) {
          return resolveRustTargetTypeRef(expression, rustSourceStorageSubjectContext(context, undefined), probe.operationOptions);
        }
        const sourceFile = ast.getSourceFile(expression);
        return sourceFile !== undefined
          ? resolveExpressionCarrier(probe, expression, sourceFile, expected, role === "retained" ? "operation" : "value")
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
