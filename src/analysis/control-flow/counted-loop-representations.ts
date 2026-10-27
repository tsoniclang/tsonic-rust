import type { AstReader, Node } from "@tsonic/tsts";
import {
  ForStatement_Condition,
  isSourceCallableBodyBoundary,
  KindForStatement,
  Node_Expression,
  sourceNodesEqual,
  type SourceDeclarationUse,
  type SourceProgramNavigation,
  type SourceLiteralIndex,
} from "@tsonic/target-api/source";

import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import {
  isRustBoolCarrier,
  isRustIntegerCarrier,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { selectedSourceLiteralIsRepresentable } from "../../policy/conversions/literals.js";
import { rustIntegerKindIsExactlyRepresentableAsFloat64 } from "../../policy/conversions/numeric-promotion.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustBorrowedElementReads } from "../storage/borrowed-element-reads.js";
import type { RustCountedLoopRepresentation } from "../../target-model/records/operations/counted-loops.js";

interface RustCountedLoopAnalysisContext {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly records: RustProgramRecords & SourceLiteralIndex;
  readonly borrowedElementReads: RustBorrowedElementReads;
  readonly expressionStability: WeakMap<Node, boolean>;
  readonly bodyStability: WeakMap<Node, boolean>;
}

export function analyzeRustCountedLoopRepresentations(input: {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly navigation: SourceProgramNavigation;
  readonly records: RustProgramRecords & SourceLiteralIndex;
  readonly borrowedElementReads: RustBorrowedElementReads;
}): ReadonlyMap<Node, RustCountedLoopRepresentation> {
  const byStatement = new Map<Node, RustCountedLoopRepresentation>();
  const context: RustCountedLoopAnalysisContext = {
    ast: input.ast,
    navigation: input.navigation,
    records: input.records,
    borrowedElementReads: input.borrowedElementReads,
    expressionStability: new WeakMap(),
    bodyStability: new WeakMap(),
  };
  const visit = (node: Node): void => {
    if (input.ast.kindName(node) === KindForStatement) {
      const representation = classifyCountedLoop(node, context);
      if (representation !== undefined) {
        byStatement.set(node, Object.freeze(representation));
      }
    }
  };
  for (const node of input.nativeNodes) visit(node);
  return byStatement;
}

function classifyCountedLoop(
  statement: Node,
  input: RustCountedLoopAnalysisContext,
): RustCountedLoopRepresentation | undefined {
  const counted = input.navigation.countedLoop(statement);
  if (counted === undefined) {
    return undefined;
  }
  const counterSummary = input.navigation.declarationUseSummary(
    counted.counterDeclaration,
  );
  if (counterSummary.captured || counterSummary.memberWritten ||
    !countedLoopBoundIsStable(counted.bound, counted.body, input)) {
    return undefined;
  }
  const startCarrier = rustEffectiveValueCarrier(input.records, counted.start);
  const boundCarrier = rustEffectiveValueCarrier(input.records, counted.bound);
  const counterCarrier = input.records.runtimeCarrier.get(counted.counterDeclaration)?.carrier;
  const condition = ForStatement_Condition(input.ast, statement);
  const comparison = condition === undefined
    ? undefined
    : input.records.targetOperation.get(condition);
  if (comparison?.kind !== "operator-token" || comparison.operator !== "<" ||
    !isRustBoolCarrier(comparison.resultCarrier)) {
    return undefined;
  }
  if (startCarrier !== undefined && boundCarrier !== undefined &&
    counterCarrier !== undefined && isRustIntegerCarrier(startCarrier) &&
    rustTargetTypeRefEquals(startCarrier, boundCarrier) &&
    rustTargetTypeRefEquals(startCarrier, counterCarrier) &&
    comparison.leftConversion === undefined &&
    comparison.rightConversion === undefined) {
    return {
      kind: "native-counter",
      counterDeclaration: counted.counterDeclaration,
      start: counted.start,
      bound: counted.bound,
      body: counted.body,
      rangeCarrier: startCarrier,
    };
  }
  if (counterCarrier?.kind !== "source-primitive" ||
    counterCarrier.name !== "float64" ||
    startCarrier === undefined || boundCarrier === undefined ||
    !rustTargetTypeRefEquals(startCarrier, counterCarrier) ||
    comparison.leftConversion !== undefined ||
    !input.ast.is.IsNumericLiteral(counted.start)) {
    return undefined;
  }
  const rangeCarrier = rustValueCarrierBeforeContextualConversion(
    input.records,
    counted.bound,
  );
  const conversion = comparison.rightConversion;
  const conversionContract = conversion === undefined
    ? undefined
    : rustValueConversionContract(conversion);
  if (rangeCarrier === undefined || !isRustIntegerCarrier(rangeCarrier) ||
    !rustIntegerKindIsExactlyRepresentableAsFloat64(rangeCarrier.name) ||
    !rustTargetTypeRefEquals(boundCarrier, rangeCarrier) ||
    conversion === undefined ||
    conversionContract === undefined || conversionContract.fallible ||
    (conversionContract.category !== "exact" &&
      conversionContract.category !== "numeric-promotion") ||
    !rustTargetTypeRefEquals(conversionContract.source, rangeCarrier) ||
    !rustTargetTypeRefEquals(conversionContract.target, counterCarrier) ||
    input.records.flowReadProjection.get(counted.bound) !== undefined ||
    input.records.projectUpcast.get(counted.bound) !== undefined ||
    input.records.projectDowncast.get(counted.bound) !== undefined ||
    input.records.optionProjection.get(counted.bound) !== undefined ||
    !selectedSourceLiteralIsRepresentable(
      input.records.literalValue.get(counted.start),
      rangeCarrier.name,
    )) {
    return undefined;
  }
  return {
    kind: "integer-range-number-counter",
    counterDeclaration: counted.counterDeclaration,
    start: counted.start,
    bound: counted.bound,
    body: counted.body,
    rangeCarrier,
    counterCarrier,
  };
}

function countedLoopBoundIsStable(
  bound: Node,
  body: Node,
  input: RustCountedLoopAnalysisContext,
): boolean {
  if (!expressionEvaluationIsStable(bound, input, input.expressionStability)) {
    return false;
  }
  let stable = true;
  const boundDeclarations = new Set<Node>();
  const visit = (node: Node | undefined): void => {
    if (node === undefined || !stable) {
      return;
    }
    const declaration = referencedRuntimeBindingDeclaration(node, input);
    if (declaration !== undefined && !boundDeclarations.has(declaration)) {
      boundDeclarations.add(declaration);
      const summary = input.navigation.declarationUseSummary(declaration);
      if (summary.bindingWritten || summary.memberWritten ||
        summary.captured || summary.exported ||
        declarationIdentityMayBeAliased(summary.uses) ||
        summary.uses.some((use) => nodeIsWithin(use.reference, body, input.ast) &&
          bodyUseMayChangeState(use, input))) {
        stable = false;
        return;
      }
    }
    input.ast.forEachChild(node, visit);
  };
  visit(bound);
  const boundMayChangeThroughExternalAlias = [...boundDeclarations].some(
    (declaration) => !carrierHasIndependentScalarValue(
      input.records.runtimeCarrier.get(declaration)?.carrier,
    ),
  );
  return stable && (!boundMayChangeThroughExternalAlias ||
    bodyPreservesStableBound(body, input));
}

function carrierHasIndependentScalarValue(
  carrier: TargetTypeRef | undefined,
): boolean {
  return carrier?.kind === "source-primitive";
}

function bodyPreservesStableBound(
  body: Node,
  input: RustCountedLoopAnalysisContext,
): boolean {
  const cached = input.bodyStability.get(body);
  if (cached !== undefined) {
    return cached;
  }
  if (directMutationMayChangeBound(body, input) ||
    directEvaluationMayChangeBound(body, input)) {
    input.bodyStability.set(body, false);
    return false;
  }
  let stable = true;
  input.ast.forEachChild(body, (child) => {
    if (child !== undefined && stable && !isSourceCallableBodyBoundary(input.ast, child) &&
      !bodyPreservesStableBound(child, input)) {
      stable = false;
    }
  });
  input.bodyStability.set(body, stable);
  return stable;
}

function directMutationMayChangeBound(
  node: Node,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
  },
): boolean {
  if (input.ast.is.IsDeleteExpression(node)) {
    return true;
  }
  const operator = input.ast.operatorKindName(node);
  if (input.ast.is.IsBinaryExpression(node) &&
    assignmentOperatorKinds.has(operator ?? "")) {
    return !isIndependentBindingWrite(
      input.ast.as.AsBinaryExpression(node)?.Left,
      input,
    );
  }
  if ((input.ast.is.IsPrefixUnaryExpression(node) ||
      input.ast.is.IsPostfixUnaryExpression(node)) &&
    (operator === "KindPlusPlusToken" || operator === "KindMinusMinusToken")) {
    const operand = input.ast.is.IsPrefixUnaryExpression(node)
      ? input.ast.as.AsPrefixUnaryExpression(node)?.Operand
      : input.ast.as.AsPostfixUnaryExpression(node)?.Operand;
    return !isIndependentBindingWrite(operand, input);
  }
  return false;
}

function isIndependentBindingWrite(
  target: Node | undefined,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
  },
): boolean {
  if (target === undefined || !input.ast.is.IsIdentifier(target)) {
    return false;
  }
  const declaration = input.navigation.sourceReferenceFor(target)?.declaration;
  return declaration !== undefined;
}

function directEvaluationMayChangeBound(
  node: Node,
  input: RustCountedLoopAnalysisContext,
): boolean {
  const kind = input.ast.kindName(node);
  if (input.ast.is.IsAwaitExpression(node) || input.ast.is.IsYieldExpression(node) ||
    kind === "KindTaggedTemplateExpression" || kind === "KindSpreadElement" ||
    kind === "KindSpreadAssignment" || kind === "KindComputedPropertyName" ||
    kind === "KindTemplateExpression") {
    return true;
  }
  if (input.ast.is.IsCallExpression(node) || input.ast.is.IsNewExpression(node) ||
    input.ast.is.IsPropertyAccessExpression(node) ||
    input.ast.is.IsElementAccessExpression(node)) {
    return !operationEvaluationIsPure(node, input);
  }
  const effects = input.navigation.expressionEffects(node);
  if (!effects.invokes) {
    return false;
  }
  if (input.ast.is.IsBinaryExpression(node) ||
    input.ast.is.IsPrefixUnaryExpression(node) ||
    input.ast.is.IsPostfixUnaryExpression(node)) {
    const fact = input.records.targetOperation.get(node);
    return fact?.kind !== "operator-token" && fact?.kind !== "string-concat" &&
      !operationEvaluationIsPure(node, input);
  }
  return false;
}

function referencedRuntimeBindingDeclaration(
  node: Node,
  input: {
    readonly ast: AstReader;
    readonly navigation: SourceProgramNavigation;
  },
): Node | undefined {
  if (!input.ast.is.IsIdentifier(node)) {
    return undefined;
  }
  const parent = input.ast.parent(node);
  if (parent !== undefined && input.ast.is.IsPropertyAccessExpression(parent) &&
    !sourceNodesEqual(input.ast, Node_Expression(input.ast, parent), node)) {
    return undefined;
  }
  return input.navigation.sourceReferenceFor(node)?.declaration;
}

function expressionEvaluationIsStable(
  expression: Node,
  input: RustCountedLoopAnalysisContext,
  cache: WeakMap<Node, boolean>,
): boolean {
  const cached = cache.get(expression);
  if (cached !== undefined) {
    return cached;
  }
  const effects = input.navigation.expressionEffects(expression);
  if (effects.mutates || effects.suspends) {
    cache.set(expression, false);
    return false;
  }
  if (!effects.invokes && !effects.mayThrow) {
    cache.set(expression, true);
    return true;
  }
  if (!operationEvaluationIsPure(expression, input)) {
    cache.set(expression, false);
    return false;
  }
  let stable = true;
  input.ast.forEachChild(expression, (child) => {
    if (child !== undefined && stable &&
      !expressionEvaluationIsStable(child, input, cache)) {
      stable = false;
    }
  });
  cache.set(expression, stable);
  return stable;
}

function bodyUseMayChangeState(
  use: SourceDeclarationUse,
  input: RustCountedLoopAnalysisContext,
): boolean {
  if (use.captured) {
    return true;
  }
  if (use.throughMember) {
    const operation = receiverOperationForReference(use.reference, input.ast);
    return operation === undefined ||
      !operationEvaluationIsPure(operation, input);
  }
  switch (use.role) {
    case "argument":
    case "call-target":
    case "storage":
    case "value":
    case "write":
    case "yield":
      return true;
    case "comparison":
    case "condition":
    case "receiver":
    case "return":
    case "source-linkage":
    case "type-only":
      return false;
  }
}

function declarationIdentityMayBeAliased(
  uses: readonly SourceDeclarationUse[],
): boolean {
  return uses.some((use) => !use.throughMember &&
    (use.role === "argument" || use.role === "storage" ||
      use.role === "yield"));
}

function operationEvaluationIsPure(
  operation: Node,
  input: RustCountedLoopAnalysisContext,
): boolean {
  if (input.borrowedElementReads.forRead(operation) !== undefined) return true;
  const fact = input.records.targetOperation.get(operation);
  return fact?.kind === "provider-operation" &&
    fact.abi.effects.evaluation === "pure";
}

function receiverOperationForReference(
  reference: Node,
  ast: AstReader,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (isTransparentExpression(parent, current, ast)) {
      current = parent;
      continue;
    }
    const selectedReceiver = ast.is.IsPropertyAccessExpression(parent)
      ? ast.as.AsPropertyAccessExpression(parent)?.Expression
      : ast.is.IsElementAccessExpression(parent)
        ? ast.as.AsElementAccessExpression(parent)?.Expression
        : undefined;
    if (selectedReceiver !== undefined && sourceNodesEqual(
      ast,
      selectedReceiver,
      current,
    )) {
      current = parent;
      const call = ast.parent(current);
      return call !== undefined && ast.is.IsCallExpression(call) &&
          sourceNodesEqual(ast, Node_Expression(ast, call), current)
        ? call
        : current;
    }
    return undefined;
  }
}

function isTransparentExpression(
  wrapper: Node,
  expression: Node,
  ast: AstReader,
): boolean {
  const selected = ast.is.IsParenthesizedExpression(wrapper)
    ? ast.as.AsParenthesizedExpression(wrapper)?.Expression
    : ast.is.IsAsExpression(wrapper)
      ? ast.as.AsAsExpression(wrapper)?.Expression
      : ast.is.IsSatisfiesExpression(wrapper)
        ? ast.as.AsSatisfiesExpression(wrapper)?.Expression
        : ast.is.IsNonNullExpression(wrapper)
          ? ast.as.AsNonNullExpression(wrapper)?.Expression
          : ast.is.IsTypeAssertion(wrapper)
            ? ast.as.AsTypeAssertion(wrapper)?.Expression
            : undefined;
  return selected !== undefined && sourceNodesEqual(ast, selected, expression);
}

function nodeIsWithin(
  node: Node,
  root: Node,
  ast: AstReader,
): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (sourceNodesEqual(ast, current, root)) {
      return true;
    }
    current = ast.parent(current);
  }
  return false;
}

const assignmentOperatorKinds: ReadonlySet<string> = new Set([
  "KindEqualsToken",
  "KindPlusEqualsToken",
  "KindMinusEqualsToken",
  "KindAsteriskEqualsToken",
  "KindAsteriskAsteriskEqualsToken",
  "KindSlashEqualsToken",
  "KindPercentEqualsToken",
  "KindLessThanLessThanEqualsToken",
  "KindGreaterThanGreaterThanEqualsToken",
  "KindGreaterThanGreaterThanGreaterThanEqualsToken",
  "KindAmpersandEqualsToken",
  "KindBarEqualsToken",
  "KindCaretEqualsToken",
  "KindBarBarEqualsToken",
  "KindAmpersandAmpersandEqualsToken",
  "KindQuestionQuestionEqualsToken",
]);
