import { rustProviderInputBorrowMode } from "../../policy/operations/members/input-borrows.js";
import type { AstReader, Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import { isRustStringViewCarrier } from "../../target-model/types/carriers/native.js";

import { rustFinalizedSourceInputs } from "../../target-model/operations/finalized-inputs.js";

type ProviderOperation = Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>;

export function rustBorrowedStringInputs(node: Node, operation: ProviderOperation, ast: AstReader): readonly Node[] {
  const inputs = rustFinalizedSourceInputs(operation.abi);
  const output: Node[] = [];
  const argumentsList = rustBorrowedOperationArguments(node, ast);
  if (argumentsList === undefined) return output;
  for (const input of inputs) {
    if (!isRustStringViewCarrier(input.sourceCarrier)) continue;
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
