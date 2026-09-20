import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import type { RustTargetProgram } from "./model.js";

export interface RustBorrowedElementRead {
  readonly receiver: Node;
  readonly array: Node;
  readonly index: Node;
  readonly method: string;
}

export interface RustBorrowedElementReads {
  forExpression(node: Node): RustBorrowedElementRead | undefined;
}

export function analyzeRustBorrowedElementReads(
  ast: AstReader,
  files: readonly SourceFile[],
  facts: RustTargetProgram["facts"],
): RustBorrowedElementReads {
  const reads = new WeakMap<Node, RustBorrowedElementRead>();
  const visit = (node: Node): void => {
    if (ast.is.IsPropertyAccessExpression(node)) {
      const operation = facts.getFact(node, rustTargetOperationFactKey);
      const receiver = Node_Expression(ast, node);
      if (operation?.kind === "provider-operation" && operation.abi.effects.evaluation === "pure" &&
        operation.abi.operationKind === "property" && operation.abi.result.kind === "sync" &&
        operation.abi.effects.invocation === "infallible" && operation.abi.effects.safety === "safe" &&
        operation.abi.sourceArguments.length === 0 &&
        operation.abi.sourceReceiver.kind === "receiver" &&
        isRustStringCarrier(operation.abi.sourceReceiver.carrier) &&
        receiver !== undefined && ast.is.IsNonNullExpression(receiver)) {
        const element = Node_Expression(ast, receiver);
        const indexed = element === undefined ? undefined : facts.getFact(element, rustTargetOperationFactKey);
        const array = element === undefined ? undefined : Node_Expression(ast, element);
        const index = element === undefined ? undefined : ElementAccessExpression_ArgumentExpression(ast, element);
        if (element !== undefined && ast.is.IsElementAccessExpression(element) &&
          indexed?.kind === "provider-operation" && indexed.borrowedIndexMethod !== undefined &&
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(indexed.borrowedIndexMethod) &&
          indexed.abi.operationKind === "indexer" && indexed.abi.sourceArguments.length === 1 &&
          indexed.abi.effects.evaluation === "pure" && indexed.abi.result.kind === "sync" &&
          indexed.abi.effects.invocation === "infallible" && indexed.abi.effects.safety === "safe" &&
          isRustStringCarrier(indexed.sourceResultCarrier) &&
          array !== undefined && index !== undefined) {
          reads.set(node, Object.freeze({ receiver, array, index, method: indexed.borrowedIndexMethod }));
        }
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  files.forEach(visit);
  return Object.freeze({ forExpression: (node: Node) => reads.get(node) });
}
