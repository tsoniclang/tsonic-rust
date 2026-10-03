import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { BinaryExpression_Right, Node_Expression, type SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustTargetProgram } from "./model.js";
import { analyzeRustBorrowedElementLocals, type RustBorrowedElementLocal } from "./borrowed-element-locals.js";
import { rustBorrowedElementRead, rustBorrowedStringAppend, rustBorrowedStringInputs, rustBorrowPureOperation } from "./borrowed-element-purity.js";
import { analyzeRustBorrowedIterationBindings, type RustBorrowedIterationBinding } from "./borrowed-iteration-bindings.js";

export interface RustBorrowedElementRead {
  readonly receiver: Node;
  readonly element: Node;
  readonly array: Node;
  readonly index: Node;
  readonly method: string;
}

export interface RustBorrowedElementReads {
  forExpression(node: Node): RustBorrowedElementRead | undefined;
  forRead(node: Node): RustBorrowedElementRead | undefined;
  forStatement(node: Node): RustBorrowedElementLocal | undefined;
  endingAt(node: Node): readonly RustBorrowedElementLocal[];
  forIteration(node: Node): RustBorrowedIterationBinding | undefined;
}

export function analyzeRustBorrowedElementReads(
  ast: AstReader,
  files: readonly SourceFile[],
  facts: RustTargetProgram["facts"],
  navigation: SourceProgramNavigation,
): RustBorrowedElementReads {
  const reads = new WeakMap<Node, RustBorrowedElementRead>();
  const indexedReads = new WeakMap<Node, RustBorrowedElementRead>();
  const locals = analyzeRustBorrowedElementLocals(ast, files, facts, navigation);
  const select = (consumer: Node, read: RustBorrowedElementRead): void => {
    reads.set(consumer, read);
    indexedReads.set(read.element, read);
  };
  const visit = (node: Node): void => {
    const local = locals.forStatement(node);
    if (local !== undefined) indexedReads.set(local.element, local);
    const parent = ast.parent(node);
    if (parent !== undefined && ast.is.IsExpressionStatement(parent) &&
      Node_Expression(ast, parent) === node && rustBorrowedStringAppend(node, ast, facts)) {
      const right = BinaryExpression_Right(ast, node);
      const read = right === undefined ? undefined : rustBorrowedElementRead(right, ast, facts);
      if (read !== undefined) select(node, read);
    }
    const operation = rustBorrowPureOperation(node, facts);
    if (operation !== undefined) {
      for (const receiver of rustBorrowedStringInputs(node, operation, ast)) {
        const read = rustBorrowedElementRead(receiver, ast, facts);
        const argumentsList = ast.is.IsCallExpression(node) ? ast.arguments(node) : [];
        const callee = Node_Expression(ast, node);
        const sourceReceiver = ast.is.IsCallExpression(node)
          ? callee === undefined ? undefined : Node_Expression(ast, callee) : callee;
        if (read !== undefined && argumentsList.every(argument => argument !== undefined &&
          (argument === receiver || isLiteral(argument, ast))) &&
          (operation.abi.sourceReceiver.kind === "none" || sourceReceiver === receiver)) {
          select(node, read);
          break;
        }
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  files.forEach(visit);
  const forIteration = analyzeRustBorrowedIterationBindings(ast, files, facts, navigation);
  return Object.freeze({ forExpression: (node: Node) => reads.get(node),
    forRead: (node: Node) => indexedReads.get(node), ...locals, forIteration });
}

function isLiteral(node: Node, ast: AstReader): boolean {
  return ["KindNumericLiteral", "KindStringLiteral", "KindNoSubstitutionTemplateLiteral",
    "KindTrueKeyword", "KindFalseKeyword", "KindNullKeyword"].includes(ast.kindName(node));
}
