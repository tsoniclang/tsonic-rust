import {
  ElementAccessExpression_ArgumentExpression,
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  Node_Operand,
  KindBinaryExpression,
  KindCallExpression,
  KindConditionalExpression,
  KindDeleteExpression,
  KindElementAccessExpression,
  KindEqualsToken,
  KindIdentifier,
  KindNewExpression,
  KindNonNullExpression,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindSatisfiesExpression,
  KindSpreadElement,
  KindVoidExpression,
  Node_Expression,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  isRustDefinitelyNullishCarrier,
  isRustOptionCarrier,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustNullishSourceTargetType,
  rustSourcePrimitiveTargetType,
} from "../../target-model/types/index.js";
import {
  selectRustFlowReadProjection,
  selectRustValueCarrierReconciliation,
} from "../../policy/types/value-carrier-reconciliation.js";
import {
  recordRustFlowReadProjection,
  recordRustValueCarrierReconciliation,
} from "../facts/value-carrier-queries.js";
import {
  rustFlowReadProjectionFactKey,
  rustOptionalChainFactKey,
  rustOptionProjectionFactKey,
  rustPostCheckOperationKind,
  rustTargetOperationFactKey,
  rustTargetOperationResultCarrier,
} from "../facts/keys.js";
import { appendRustDiagnostic, boolCarrier, rustResolutionContext, selectExpressionOperation } from "../program/walk.js";
import { isRustAssignmentOperator } from "../../policy/operations/operator-rules.js";
import { recordAssignmentWrite, recordBindingWrite } from "../declarations/types-and-bindings.js";
import { recordSelectedOperationInputs } from "../operations/inputs.js";
import { resolveBinaryOperandCarriers } from "../operations/operators.js";
import { resolveExpressionCarrierUncached } from "./value-resolution.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustConversionKey, rustRuntimeCarrierKey, rustSelectedOperationKey } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type {
  AstReader,
  Node,
  SourceFile,
  Type,
} from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { readRustSourceRawAddress } from "../../policy/operations/raw-address-source.js";
import { selectRustMemoryLayoutObservation } from "../../policy/operations/memory-layout.js";

export function resolveExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const facts = walk.context.facts;
  const contextualExpected = rustExpressionResolutionExpectation(
    walk.context.ast,
    expression,
    expected,
  );
  const finalize = (carrier: TargetTypeRef | undefined): TargetTypeRef | undefined => {
    const selectedOperation = facts.get(expression, rustSelectedOperationKey) ??
      facts.resolve(expression, rustSelectedOperationKey);
    const targetOperation = facts.get(expression, rustTargetOperationFactKey) ??
      facts.resolve(expression, rustTargetOperationFactKey);
    const optionalChain = facts.get(expression, rustOptionalChainFactKey) ??
      facts.resolve(expression, rustOptionalChainFactKey);
    const selectedOperationOwnsResult = selectedOperation !== undefined || targetOperation !== undefined;
    const flowCarrier = selectedOperationOwnsResult &&
        (optionalChain !== undefined || rustOptionElementCarrier(carrier) === undefined)
      ? carrier
      : applyFlowReadLane(walk, expression, carrier);
    return applyOptionLane(walk, expression, flowCarrier, expected);
  };
  const existing = facts.get(expression, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
  if (walk.resolving.has(expression)) {
    return existing === undefined
      ? undefined
      : finalize(existing.carrier);
  }
  walk.resolving.add(expression);
  try {
    if (existing !== undefined) {
      let operation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      const expressionKind = walk.context.ast.kindName(expression);
      if ((expressionKind === "KindArrowFunction" || expressionKind === "KindFunctionExpression") &&
        operation?.kind !== "closure") {
        const callableCarrier = resolveExpressionCarrierUncached(
          walk,
          expression,
          sourceFile,
          contextualExpected ?? existing.carrier,
        );
        if (callableCarrier === undefined ||
          !rustTargetTypeRefEquals(callableCarrier, existing.carrier)) {
          return undefined;
        }
        operation = facts.get(expression, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      }
      recordSelectedOperationInputs(walk, expression, sourceFile, operation);
      return finalize(existing.carrier);
    }
    const expressionKind = walk.context.ast.kindName(expression);
    if (expressionIsPlainAssignment(walk.context.ast, expression)) {
      const target = BinaryExpression_Left(walk.context.ast, expression);
      if (target !== undefined) {
        resolveExpressionCarrier(walk, target, sourceFile, undefined);
      }
      selectExpressionOperation(walk, expression, sourceFile);
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
    } else if (expressionKind === KindCallExpression || expressionKind === KindNewExpression) {
      resolveCallSelectionPrerequisites(walk, expression, sourceFile);
      selectExpressionOperation(walk, expression, sourceFile);
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
    } else {
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
      selectExpressionOperation(walk, expression, sourceFile);
    }
    const selectedCarrier = facts.get(expression, rustRuntimeCarrierKey) ??
      walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
    if (selectedCarrier !== undefined) {
      const operation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      recordSelectedOperationInputs(
        walk,
        expression,
        sourceFile,
        operation,
      );
      return finalize(selectedCarrier.carrier);
    }
    const selectedOperation = facts.get(expression, rustSelectedOperationKey) ??
      walk.context.facts.resolve(expression, rustSelectedOperationKey);
    if (selectedOperation !== undefined) {
      const rustOperation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      const optionalChain = facts.get(expression, rustOptionalChainFactKey) ??
        walk.context.facts.resolve(expression, rustOptionalChainFactKey);
      if (optionalChain !== undefined && selectedOperation.resultType !== undefined &&
        !rustTargetTypeRefEquals(optionalChain.resultCarrier, selectedOperation.resultType)) {
        appendRustDiagnostic(
          walk,
          "RUST_OPTIONAL_CHAIN_RESULT_CONFLICT",
          "The finalized optional-chain result conflicts with the selected Rust operation result.",
          expression,
          ["target.capability=rust.optional-chain.exact-result"],
        );
        return undefined;
      }
      const finalizedResult = optionalChain?.resultCarrier ?? (rustOperation === undefined
        ? selectedOperation.resultType
        : rustTargetOperationResultCarrier(rustOperation) ?? selectedOperation.resultType);
      const expressionKind = walk.context.ast.kindName(expression);
      const sourceCallNeedsLifecycle = finalizedResult === undefined && rustOperation === undefined &&
        (expressionKind === KindCallExpression || expressionKind === KindNewExpression);
      if (!sourceCallNeedsLifecycle &&
        (finalizedResult !== undefined || rustPostCheckOperationKind(selectedOperation.operationId) === undefined)) {
        recordSelectedOperationInputs(
          walk,
          expression,
          sourceFile,
          rustOperation,
        );
        return finalizedResult === undefined
          ? undefined
          : finalize(setCarrierFact(walk, expression, finalizedResult));
      }
    }
    const resolved = resolveExpressionCarrierUncached(
      walk,
      expression,
      sourceFile,
      contextualExpected,
    );
    return finalize(resolved);
  } finally {
    recordExpressionBindingEffects(walk, expression);
    walk.resolving.delete(expression);
  }
}

export function resolveExpressionCarrierBeforeFlowReadProjection(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const resolved = resolveExpressionCarrier(walk, expression, sourceFile, expected);
  return walk.context.facts.getRuntimeCarrierFact(expression)?.carrier ?? resolved;
}

function rustExpressionResolutionExpectation(
  ast: AstReader,
  expression: Node,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (!isRustOptionCarrier(expected)) {
    return expected;
  }
  const kind = ast.kindName(expression);
  if (kind === KindConditionalExpression || kind === KindParenthesizedExpression ||
    kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    return expected;
  }
  return rustOptionElementCarrier(expected);
}

function expressionIsPlainAssignment(ast: AstReader, expression: Node): boolean {
  if (ast.kindName(expression) !== KindBinaryExpression) {
    return false;
  }
  const operator = BinaryExpression_OperatorToken(ast, expression);
  return operator !== undefined && ast.kindName(operator) === KindEqualsToken;
}

function applyFlowReadLane(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (sourceCarrier === undefined) {
    return undefined;
  }
  const existing = walk.context.facts.get(expression, rustFlowReadProjectionFactKey) ??
    walk.context.facts.resolve(expression, rustFlowReadProjectionFactKey);
  if (existing !== undefined) {
    if (!rustTargetTypeRefEquals(existing.sourceCarrier, sourceCarrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_FLOW_READ_SOURCE_CONFLICT",
        "The finalized Rust flow-read projection conflicts with the expression's raw runtime carrier.",
        expression,
        ["target.capability=rust.flow-read.exact-source"],
      );
      return undefined;
    }
    return existing.selectedCarrier;
  }
  const selectedSource = selectedFlowReadSource(walk, expression);
  if (selectedSource === undefined) {
    return sourceCarrier;
  }
  const selectedCarrier = resolveSelectedFlowReadCarrier(
    walk,
    expression,
    selectedSource.declaration,
    selectedSource.type,
    sourceCarrier,
  );
  if (selectedCarrier === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_READ_SELECTED_CARRIER_MISSING",
      "The exact checker-selected source value has no closed Rust flow-read carrier.",
      expression,
      ["target.capability=rust.flow-read.exact-result"],
    );
    return undefined;
  }
  const selection = selectRustFlowReadProjection(
    sourceCarrier,
    selectedCarrier,
    walk.context.projectTypes,
  );
  if (selection.kind === "identity") {
    return sourceCarrier;
  }
  if (selection.kind === "incompatible") {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_READ_PROJECTION_UNSUPPORTED",
      "The raw Rust value cannot be projected to the exact checker-selected flow carrier.",
      expression,
      [
        "target.capability=rust.flow-read.closed-projection",
        `source=${JSON.stringify(sourceCarrier)}`,
        `selected=${JSON.stringify(selectedCarrier)}`,
      ],
    );
    return undefined;
  }
  recordRustFlowReadProjection(
    walk.context.facts,
    expression,
    selection.fact,
  );
  return selection.fact.selectedCarrier;
}

function selectedFlowReadSource(
  walk: RustFactWalk,
  expression: Node,
): { readonly declaration?: Node; readonly type: Type } | undefined {
  const sourceFile = walk.context.ast.getSourceFile(expression);
  if (sourceFile === undefined || !walk.context.source.semantics.includes(sourceFile)) {
    return undefined;
  }
  const semantics = walk.context.source.semantics.forNode(expression);
  const kind = walk.context.ast.kindName(expression);
  if (kind === KindPropertyAccessExpression) {
    const selected = semantics.operations.propertyAccess(expression);
    return selected?.callCallee === true || selected?.sourceReadType === undefined
      ? undefined
      : {
          ...(selected.selectedDeclaration === undefined
            ? {}
            : { declaration: selected.selectedDeclaration }),
          type: selected.sourceReadType,
        };
  }
  if (kind === KindElementAccessExpression) {
    const selected = semantics.operations.elementAccess(expression);
    return selected?.callCallee === true || selected?.sourceReadType === undefined
      ? undefined
      : {
          ...(selected.selectedDeclaration === undefined
            ? {}
            : { declaration: selected.selectedDeclaration }),
          type: selected.sourceReadType,
        };
  }
  const refinement = walk.context.source.semantics.selectValueTypeRefinement(expression);
  return refinement.kind === "resolved" && refinement.refinement.kind === "members"
    ? { declaration: refinement.reference.declaration, type: refinement.selectedType }
    : undefined;
}

function resolveSelectedFlowReadCarrier(
  walk: RustFactWalk,
  expression: Node,
  declaration: Node | undefined,
  selectedType: Type,
  sourceCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  if (rustOptionElementCarrier(sourceCarrier) !== undefined &&
    walk.context.semanticsFor(expression).types.isNullish(selectedType)) {
    return sourceCarrier;
  }
  const operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(expression, rustTargetOperationFactKey);
  if (operation?.kind === "provider-operation" &&
    operation.sourceResultCarrier !== undefined) {
    return operation.sourceResultCarrier;
  }
  const typeNode = Node_Type(walk.context.ast, declaration);
  const typeSourceFile = typeNode === undefined
    ? undefined
    : walk.context.ast.getSourceFile(typeNode);
  if (typeNode !== undefined && typeSourceFile !== undefined &&
    walk.context.source.semantics.includes(typeSourceFile)) {
    const semantics = walk.context.source.semantics.forNode(typeNode);
    const authored = semantics.types.authoredSelection(typeNode, selectedType);
    if (authored.kind === "ambiguous") {
      return undefined;
    }
    if (authored.kind === "authored-members") {
      if (authored.nodes.length === 1 && authored.nodes[0] === typeNode &&
        authored.selectedNullishTypes.length === 0) {
        return sourceCarrier;
      }
      const selectedMembers = authored.nodes.map((node) =>
        resolveRustTargetTypeRef(
          node,
          rustResolutionContext(walk, node),
          walk.operationOptions,
        ));
      const optionalElement = rustOptionElementCarrier(sourceCarrier);
      if (selectedMembers.length === 1 &&
        selectedMembers[0]?.kind === "type-parameter" &&
        optionalElement !== undefined &&
        authored.selectedNullishTypes.length === 0) {
        return optionalElement;
      }
      if (selectedMembers.some((member) => member === undefined)) {
        return undefined;
      }
      return combineSelectedFlowReadCarriers(
        selectedMembers as readonly TargetTypeRef[],
        authored.selectedNullishTypes.length > 0,
        walk,
      );
    }
    return sourceCarrier;
  }
  const semanticCarrier = resolveRustTargetTypeRef(
    selectedType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  if (optionalElement === undefined) {
    return semanticCarrier !== undefined &&
        walk.context.projectTypes.definitionForCarrier(sourceCarrier) !== undefined &&
        walk.context.projectTypes.definitionForCarrier(semanticCarrier) !== undefined
      ? semanticCarrier
      : sourceCarrier;
  }
  const selectedMembers = walk.context.semanticsFor(expression).types.isUnion(selectedType)
    ? walk.context.semanticsFor(expression).types.unionOrIntersectionTypes(selectedType)
    : [selectedType];
  if (selectedMembers.some((member) => member === undefined)) {
    return undefined;
  }
  const includesNullish = selectedMembers.some((member) =>
    member !== undefined && walk.context.semanticsFor(expression).types.isNullish(member));
  if (includesNullish) {
    return sourceCarrier;
  }
  return semanticCarrier !== undefined &&
      walk.context.projectTypes.definitionForCarrier(semanticCarrier) !== undefined
    ? semanticCarrier
    : optionalElement;
}

function combineSelectedFlowReadCarriers(
  members: readonly TargetTypeRef[],
  includesNullish: boolean,
  walk: RustFactWalk,
): TargetTypeRef | undefined {
  const distinct = members.filter((member, index) =>
    members.findIndex((candidate) => rustTargetTypeRefEquals(candidate, member)) === index);
  const valueCarrier = distinct.length === 1
    ? distinct[0]
    : walk.context.projectTypes.commonSupertype(distinct);
  if (valueCarrier === undefined) {
    return includesNullish && distinct.length === 0
      ? rustNullishSourceTargetType()
      : undefined;
  }
  return includesNullish ? rustOptionTargetType(valueCarrier) : valueCarrier;
}

function recordExpressionBindingEffects(walk: RustFactWalk, expression: Node): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(ast, expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    if (isRustAssignmentOperator(operatorKind)) {
      recordAssignmentWrite(walk, expression, BinaryExpression_Left(ast, expression));
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const fact = walk.context.facts.get(expression, rustTargetOperationFactKey);
    if (fact?.kind === "operator-token" && (fact.operator === "+=" || fact.operator === "-=")) {
      recordBindingWrite(walk, Node_Operand(ast, expression));
    }
  }
}

function resolveExpressionOperationDependencies(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    resolveBinaryOperandCarriers(walk, expression, sourceFile, expected, true);
    return;
  }
  if (kind === KindConditionalExpression) {
    const condition = ConditionalExpression_Condition(ast, expression);
    const whenTrue = ConditionalExpression_WhenTrue(ast, expression);
    const whenFalse = ConditionalExpression_WhenFalse(ast, expression);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    if (whenTrue !== undefined) {
      resolveExpressionCarrier(walk, whenTrue, sourceFile, expected);
    }
    if (whenFalse !== undefined) {
      resolveExpressionCarrier(walk, whenFalse, sourceFile, expected);
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, expected);
    }
    return;
  }
  if (kind === KindVoidExpression) {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindDeleteExpression) {
    const operand = Node_Expression(ast, expression);
    const receiver = operand === undefined ? undefined : Node_Expression(ast, operand);
    const index = operand === undefined
      ? undefined
      : ElementAccessExpression_ArgumentExpression(ast, operand);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (index !== undefined) {
      resolveExpressionCarrier(
        walk,
        index,
        sourceFile,
        rustSourcePrimitiveTargetType("int32"),
      );
    }
    return;
  }
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const receiver = Node_Expression(ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (kind === KindElementAccessExpression) {
      const argument = ElementAccessExpression_ArgumentExpression(ast, expression);
      if (argument !== undefined) {
        resolveCallArgumentOperationPrerequisite(walk, argument, sourceFile);
      }
    }
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    return;
  }
}

function resolveCallArgumentOperationPrerequisite(
  walk: RustFactWalk,
  argument: Node,
  sourceFile: SourceFile,
): void {
  const kind = walk.context.ast.kindName(argument);
  const refinement = walk.context.source.semantics.selectValueTypeRefinement(argument);
  if (refinement.kind === "resolved") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindIdentifier || kind === KindCallExpression || kind === KindNewExpression ||
    kind === "KindRegularExpressionLiteral" ||
    kind === KindPropertyAccessExpression || kind === KindElementAccessExpression ||
    kind === KindBinaryExpression || kind === KindPrefixUnaryExpression ||
    kind === KindPostfixUnaryExpression) {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindNonNullExpression) {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindParenthesizedExpression || kind === KindSatisfiesExpression) {
    const inner = Node_Expression(walk.context.ast, argument);
    if (inner !== undefined) {
      resolveCallArgumentOperationPrerequisite(walk, inner, sourceFile);
    }
  }
}

function resolveCallSelectionPrerequisites(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): void {
  if (readRustSourceRawAddress(walk.context.source.sourceFacts, expression) !== undefined ||
    selectRustMemoryLayoutObservation(walk.context.source.sourceFacts, expression) !== undefined) return;
  const source = walk.context.semantics(sourceFile).operations.call(expression);
  const receiver = source?.sourceReceiver?.expression;
  if (receiver !== undefined) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  for (const argument of source?.sourceArguments ?? []) {
    resolveIndependentCallArgumentOperation(
      walk,
      argument.expression,
      sourceFile,
    );
  }
}

function resolveIndependentCallArgumentOperation(
  walk: RustFactWalk,
  argument: Node,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(argument);
  if (kind === KindIdentifier || kind === KindCallExpression || kind === KindNewExpression ||
    kind === "KindRegularExpressionLiteral" ||
    kind === KindPropertyAccessExpression || kind === KindElementAccessExpression ||
    kind === KindNonNullExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindParenthesizedExpression || kind === KindSatisfiesExpression ||
    kind === KindSpreadElement) {
    const inner = Node_Expression(ast, argument);
    if (inner !== undefined) {
      resolveIndependentCallArgumentOperation(walk, inner, sourceFile);
    }
  }
}

// Nullish lane: values flow into Option<T> positions through explicit
// Some-wrapping facts; null literals become None.
function applyOptionLane(
  walk: RustFactWalk,
  expression: Node,
  resolved: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const expectedOptionElement = rustOptionElementCarrier(expected);
  const target = expectedOptionElement !== undefined && isRustOptionCarrier(resolved)
    ? expected
    : expectedOptionElement ?? expected;
  let projected = resolved;
  if (resolved !== undefined && target !== undefined &&
    !rustTargetTypeRefEquals(resolved, target)) {
    const reconciliation = selectRustValueCarrierReconciliation(
      resolved,
      target,
      walk.context.projectTypes,
    );
    if (reconciliation.kind === "incompatible" && reconciliation.reason === "ambiguous") {
      appendRustDiagnostic(
        walk,
        "RUST_PROJECT_UPCAST_AMBIGUOUS",
        "The selected project value has more than one exact target heritage instantiation.",
        expression,
        ["target.capability=rust.project-types.upcast"],
      );
      return undefined;
    }
    if (reconciliation.kind === "call-scoped-lifetime" ||
      reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
      recordRustValueCarrierReconciliation(walk.context.facts, expression, reconciliation);
      projected = target;
      if (reconciliation.kind === "project-upcast" && !isRustOptionCarrier(expected)) {
        walk.context.facts.set(expression, rustConversionKey, { convertedType: target }, [
          { message: "rust project-type upcast conversion" },
        ]);
      }
    }
  }
  if (expected === undefined || !isRustOptionCarrier(expected)) {
    return projected;
  }
  const inner = rustOptionElementCarrier(expected);
  if (inner === undefined) {
    return resolved;
  }
  if (projected !== undefined && isRustOptionCarrier(projected)) {
    return projected;
  }
  if (isRustDefinitelyNullishCarrier(projected)) {
    const existing = walk.context.facts.get(expression, rustTargetOperationFactKey);
    if (existing === undefined) {
      setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    if (projected !== undefined) {
      walk.context.facts.set(expression, rustOptionProjectionFactKey, {
        kind: "none",
        sourceCarrier: projected,
        resultCarrier: expected,
      }, [{ message: "rust exact option-none projection" }]);
    }
    return expected;
  }
  if (projected !== undefined && rustTargetTypeRefEquals(projected, inner)) {
    walk.context.facts.set(expression, rustOptionProjectionFactKey, {
      kind: "some",
      sourceCarrier: projected,
      elementCarrier: inner,
      resultCarrier: expected,
    }, [{ message: "rust exact option-some projection" }]);
    return expected;
  }
  return resolved;
}

export function reconcileRequiredCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
): boolean {
  const reconciliation = selectRustValueCarrierReconciliation(
    sourceCarrier,
    targetCarrier,
    walk.context.projectTypes,
  );
  if (reconciliation.kind === "incompatible") {
    return false;
  }
  if (reconciliation.kind === "call-scoped-lifetime" ||
    reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
    recordRustValueCarrierReconciliation(
      walk.context.facts,
      expression,
      reconciliation,
    );
  }
  return true;
}
