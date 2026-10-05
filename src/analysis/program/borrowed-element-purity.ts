import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import {
  rustBindingStorageFactKey, rustCallScopedLifetimeReconciliationFactKey, rustContextualValueConversionFactKey,
  rustFlowReadProjectionFactKey, rustOptionProjectionFactKey, rustProjectDowncastFactKey, rustProjectUpcastFactKey,
  rustSourceBindingFactKey, rustTargetOperationFactKey, type RustTargetOperationFact,
} from "../facts/keys.js";
import { isRustCopyCarrier, isRustStringCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustBinaryOperator } from "../../target-model/syntax/tokens.js";
import type { RustTargetProgram } from "./model.js";
import type { RustBorrowedElementRead } from "./borrowed-element-reads.js";
import { rustEffectiveValueCarrier } from "../facts/value-carrier-queries.js";
import { hasExactObjectKeys } from "../../target-model/metadata/closed-data.js";
import { rustObjectReferenceViewKey } from "../facts/object-reference-views.js";

type ProviderOperation = Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>;

export function rustBorrowValueIsUnprojected(node: Node, facts: RustTargetProgram["facts"]): boolean {
  const carrier = facts.getRuntimeCarrierFact(node)?.carrier;
  return carrier !== undefined && rustTargetTypeRefEquals(carrier, rustEffectiveValueCarrier(facts, node)) &&
    facts.getTargetConversionFact(node) === undefined &&
    facts.getFact(node, rustFlowReadProjectionFactKey) === undefined &&
    facts.getFact(node, rustProjectUpcastFactKey) === undefined &&
    facts.getFact(node, rustProjectDowncastFactKey) === undefined &&
    facts.getFact(node, rustObjectReferenceViewKey) === undefined &&
    facts.getFact(node, rustCallScopedLifetimeReconciliationFactKey) === undefined &&
    facts.getFact(node, rustContextualValueConversionFactKey) === undefined &&
    facts.getFact(node, rustOptionProjectionFactKey) === undefined;
}

export function rustBorrowPrimitiveCopyValue(node: Node, facts: RustTargetProgram["facts"]): boolean {
  const carrier = facts.getRuntimeCarrierFact(node)?.carrier;
  return carrier?.kind === "source-primitive" && isRustCopyCarrier(carrier) && rustBorrowValueIsUnprojected(node, facts);
}

export function rustBorrowPureCopyValue(
  node: Node, ast: AstReader, facts: RustTargetProgram["facts"], isPure: (node: Node) => boolean,
): boolean {
  if (!rustBorrowPrimitiveCopyValue(node, facts)) return false;
  if (["KindNumericLiteral", "KindTrueKeyword", "KindFalseKeyword"].includes(ast.kindName(node))) return true;
  if (ast.is.IsIdentifier(node)) {
    const binding = facts.getFact(node, rustSourceBindingFactKey);
    return binding?.scope === "lexical" &&
      facts.getFact(binding.sourceDeclaration, rustBindingStorageFactKey)?.storage !== "location";
  }
  const operand = Node_Expression(ast, node);
  if (ast.is.IsParenthesizedExpression(node)) return operand !== undefined && isPure(operand);
  const operation = facts.getFact(node, rustTargetOperationFactKey);
  if (operation?.kind === "operator-token" && ast.is.IsBinaryExpression(node) &&
    operation.leftConversion === undefined && operation.rightConversion === undefined && isRustBinaryOperator(operation.operator)) {
    const left = BinaryExpression_Left(ast, node);
    const right = BinaryExpression_Right(ast, node);
    return left !== undefined && right !== undefined && isPure(left) && isPure(right);
  }
  const provider = rustBorrowPureOperation(node, facts);
  if (provider === undefined || provider.abi.result.kind !== "sync" ||
    provider.abi.effects.invocation !== "infallible" || provider.abi.result.conversion.kind !== "identity" ||
    !rustTargetTypeRefEquals(provider.abi.result.carrier, facts.getRuntimeCarrierFact(node)?.carrier)) return false;
  const argumentsList = borrowedOperationArguments(node, ast);
  if (argumentsList === undefined || argumentsList.length !== provider.abi.sourceArguments.length ||
    !provider.abi.sourceArguments.every((argument, index) => argument.form === "value" && argument.sourceIndex === index &&
      argumentsList[index] !== undefined && isPure(argumentsList[index]!))) return false;
  const receiver = ast.is.IsCallExpression(node)
    ? operand === undefined ? undefined : Node_Expression(ast, operand) : operand;
  if (provider.abi.sourceReceiver.kind === "receiver" && provider.abi.sourceReceiver.disposition === "runtime" &&
    (receiver === undefined || !isPure(receiver))) return false;
  const inputs = provider.abi.targetReceiver.kind === "input"
    ? [provider.abi.targetReceiver.input, ...provider.abi.targetArguments] : provider.abi.targetArguments;
  return inputs.every(selected => selected.source.kind === "constant" ||
    "conversion" in selected && selected.conversion.kind === "identity" &&
    selected.sourceCarrier.kind === "source-primitive" && isRustCopyCarrier(selected.sourceCarrier) &&
    selected.mode !== "mut-ref");
}

export function rustBorrowedElementRead(
  receiver: Node,
  ast: AstReader,
  facts: RustTargetProgram["facts"],
): RustBorrowedElementRead | undefined {
  if (!isRustStringCarrier(rustEffectiveValueCarrier(facts, receiver))) return undefined;
  const element = ast.is.IsNonNullExpression(receiver) ? Node_Expression(ast, receiver) : receiver;
  const indexed = element === undefined ? undefined : facts.getFact(element, rustTargetOperationFactKey);
  const array = element === undefined ? undefined : Node_Expression(ast, element);
  const index = element === undefined ? undefined : ElementAccessExpression_ArgumentExpression(ast, element);
  return element !== undefined && ast.is.IsElementAccessExpression(element) &&
    indexed?.kind === "provider-operation" && indexed.borrowedIndexOperation?.evaluation === "pure" &&
    hasExactObjectKeys(indexed.borrowedIndexOperation, ["method", "evaluation"]) &&
    typeof indexed.borrowedIndexOperation.method === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(indexed.borrowedIndexOperation.method) &&
    indexed.abi.operationKind === "indexer" && indexed.abi.sourceArguments.length === 1 &&
    indexed.abi.result.kind === "sync" &&
    indexed.abi.effects.invocation === "infallible" && indexed.abi.effects.safety === "safe" &&
    isRustStringCarrier(indexed.sourceResultCarrier) && array !== undefined && index !== undefined
    ? Object.freeze({ receiver, element, array, index, method: indexed.borrowedIndexOperation.method }) : undefined;
}

export function rustBorrowedStringAppend(
  expression: Node,
  ast: AstReader,
  facts: RustTargetProgram["facts"],
): boolean {
  const operation = facts.getFact(expression, rustTargetOperationFactKey);
  const left = BinaryExpression_Left(ast, expression);
  return operation?.kind === "operator-token" && operation.operator === "+=" &&
    isRustStringCarrier(operation.resultCarrier) &&
    (operation.writeStrategy === "in-place-string-append-parts" || operation.writeStrategy === "in-place-string-append-value") &&
    left !== undefined && ast.is.IsIdentifier(left) &&
    isRustStringCarrier(rustEffectiveValueCarrier(facts, left));
}

export function rustBorrowPureOperation(node: Node, facts: RustTargetProgram["facts"]): ProviderOperation | undefined {
  const operation = facts.getFact(node, rustTargetOperationFactKey);
  return operation?.kind === "provider-operation" && operation.abi.effects.evaluation === "pure" &&
    operation.abi.result.kind === "sync" && operation.abi.effects.safety === "safe"
    ? operation : undefined;
}

export function rustBorrowedStringInputs(node: Node, operation: ProviderOperation, ast: AstReader): readonly Node[] {
  const inputs = operation.abi.targetReceiver.kind === "input"
    ? [operation.abi.targetReceiver.input, ...operation.abi.targetArguments] : operation.abi.targetArguments;
  const output: Node[] = [];
  const argumentsList = borrowedOperationArguments(node, ast);
  if (argumentsList === undefined) return output;
  for (const input of inputs) {
    if (!("mode" in input) || input.mode !== "ref" || !("sourceCarrier" in input) ||
      !isRustStringCarrier(input.sourceCarrier) || input.conversion.kind !== "identity") continue;
    const callee = Node_Expression(ast, node);
    const source = input.source.kind === "argument" ? argumentsList[input.source.sourceIndex]
      : input.source.kind === "receiver" ? ast.is.IsCallExpression(node)
        ? callee === undefined ? undefined : Node_Expression(ast, callee) : callee : undefined;
    if (source !== undefined) output.push(source);
  }
  return output;
}

function borrowedOperationArguments(node: Node, ast: AstReader): readonly (Node | undefined)[] | undefined {
  if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) return ast.arguments(node);
  if (ast.is.IsPropertyAccessExpression(node)) return [];
  if (ast.is.IsElementAccessExpression(node)) {
    const argument = ElementAccessExpression_ArgumentExpression(ast, node);
    return argument === undefined ? undefined : [argument];
  }
  return undefined;
}
