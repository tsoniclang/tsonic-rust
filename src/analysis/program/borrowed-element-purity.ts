import type { AstReader, Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey, type RustTargetOperationFact } from "../facts/keys.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import type { RustTargetProgram } from "./model.js";
import type { RustBorrowedElementRead } from "./borrowed-element-reads.js";
import { rustEffectiveValueCarrier } from "../facts/value-carrier-queries.js";

type ProviderOperation = Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>;

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
    indexed?.kind === "provider-operation" && indexed.borrowedIndexMethod !== undefined &&
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(indexed.borrowedIndexMethod) &&
    indexed.abi.operationKind === "indexer" && indexed.abi.sourceArguments.length === 1 &&
    indexed.abi.effects.evaluation === "pure" && indexed.abi.result.kind === "sync" &&
    indexed.abi.effects.invocation === "infallible" && indexed.abi.effects.safety === "safe" &&
    isRustStringCarrier(indexed.sourceResultCarrier) && array !== undefined && index !== undefined
    ? Object.freeze({ receiver, array, index, method: indexed.borrowedIndexMethod }) : undefined;
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
  for (const input of inputs) {
    if (!("mode" in input) || input.mode !== "ref" || !("sourceCarrier" in input) ||
      !isRustStringCarrier(input.sourceCarrier) || input.conversion.kind !== "identity") continue;
    const callee = Node_Expression(ast, node);
    const source = input.source.kind === "argument" ? ast.arguments(node)[input.source.sourceIndex]
      : input.source.kind === "receiver" ? ast.is.IsCallExpression(node)
        ? callee === undefined ? undefined : Node_Expression(ast, callee) : callee : undefined;
    if (source !== undefined) output.push(source);
  }
  return output;
}
