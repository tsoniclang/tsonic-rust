import type { AstReader, Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { RustTargetOperationFact } from "./keys.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import type { RustFinalizedSourceInput } from "./finalized-operation-abi.js";

type ProviderOperation = Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>;

export function rustProviderInputBorrowMode(input: RustFinalizedSourceInput): "ref" | "mut-ref" | undefined {
  if (input.conversion.kind === "identity") return input.mode === "value" ? undefined : input.mode;
  if (input.conversion.kind !== "semantic" || input.mode !== "value") return undefined;
  const contract = rustValueConversionContract(input.conversion.conversion);
  return contract?.category === "ownership" && contract.sourceMode === "ref" &&
    !contract.fallible && !input.conversion.fallible &&
    rustTargetTypeRefEquals(contract.source, input.sourceCarrier) &&
    rustTargetTypeRefEquals(contract.source, input.conversion.sourceCarrier) &&
    rustTargetTypeRefEquals(contract.target, input.conversion.targetCarrier) &&
    rustTargetTypeRefEquals(contract.target, input.parameterCarrier) ? contract.sourceMode : undefined;
}

export function rustBorrowedStringInputs(node: Node, operation: ProviderOperation, ast: AstReader): readonly Node[] {
  const inputs = operation.abi.targetReceiver.kind === "input"
    ? [operation.abi.targetReceiver.input, ...operation.abi.targetArguments] : operation.abi.targetArguments;
  const output: Node[] = [];
  const argumentsList = rustBorrowedOperationArguments(node, ast);
  if (argumentsList === undefined) return output;
  for (const input of inputs) {
    if (!("sourceCarrier" in input) || !isRustStringCarrier(input.sourceCarrier)) continue;
    if (rustProviderInputBorrowMode(input) !== "ref") continue;
    const callee = Node_Expression(ast, node);
    const source = input.source.kind === "argument" ? argumentsList[input.source.sourceIndex]
      : input.source.kind === "receiver" ? ast.is.IsCallExpression(node)
        ? callee === undefined ? undefined : Node_Expression(ast, callee) : callee : undefined;
    if (source !== undefined) output.push(source);
  }
  return output;
}

export function rustBorrowedOperationArguments(node: Node, ast: AstReader): readonly (Node | undefined)[] | undefined {
  if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) return ast.arguments(node);
  if (ast.is.IsPropertyAccessExpression(node)) return [];
  if (ast.is.IsElementAccessExpression(node)) {
    const argument = ElementAccessExpression_ArgumentExpression(ast, node);
    return argument === undefined ? undefined : [argument];
  }
  return undefined;
}
