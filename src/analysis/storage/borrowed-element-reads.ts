import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Right, Node_Expression, type SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { analyzeRustBorrowedElementLocals } from "./borrowed-element-locals.js";
import { rustBorrowedElementRead, rustBorrowedStringAppend, rustBorrowPureOperation } from "./borrowed-element-purity.js";
import { rustBorrowedStringInputs } from "./provider-borrows.js";
import { analyzeRustBorrowedIterationBindings } from "./borrowed-iteration-bindings.js";
import type { RustBorrowedElementRead, RustBorrowedElementLocal, RustBorrowedIterationBinding } from "../../target-model/records/storage/borrowed-element-reads.js";

export interface RustBorrowedElementReads {
  isAppend(node: Node): boolean;
  forExpression(node: Node): RustBorrowedElementRead | undefined;
  forRead(node: Node): RustBorrowedElementRead | undefined;
  forStatement(node: Node): RustBorrowedElementLocal | undefined;
  endingAt(node: Node): readonly RustBorrowedElementLocal[];
  forIteration(node: Node): RustBorrowedIterationBinding | undefined;
}

export function analyzeRustBorrowedElementReads(
  ast: AstReader,
  nativeNodes: readonly Node[],
  records: RustProgramRecords,
  navigation: SourceProgramNavigation,
): RustBorrowedElementReads {
  const reads = new WeakMap<Node, RustBorrowedElementRead>();
  const indexedReads = new WeakMap<Node, RustBorrowedElementRead>();
  const appends = new Set<Node>();
  const locals = analyzeRustBorrowedElementLocals(ast, nativeNodes, records, navigation);
  const select = (consumer: Node, read: RustBorrowedElementRead): void => {
    reads.set(consumer, read);
    indexedReads.set(read.element, read);
  };
  const visit = (node: Node): void => {
    const local = locals.forStatement(node);
    if (local !== undefined) indexedReads.set(local.element, local);
    const parent = ast.parent(node);
    if (parent !== undefined && ast.is.IsExpressionStatement(parent) &&
      Node_Expression(ast, parent) === node && rustBorrowedStringAppend(node, ast, records)) {
      const right = BinaryExpression_Right(ast, node);
      const read = right === undefined ? undefined : rustBorrowedElementRead(right, ast, records);
      if (read !== undefined) { select(node, read); appends.add(node); }
    }
    const operation = rustBorrowPureOperation(node, records);
    if (operation !== undefined) {
      for (const receiver of rustBorrowedStringInputs(node, operation, ast)) {
        const read = rustBorrowedElementRead(receiver, ast, records);
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
  };
  nativeNodes.forEach(visit);
  const forIteration = analyzeRustBorrowedIterationBindings(ast, nativeNodes, records, navigation);
  return Object.freeze({ isAppend: (node: Node) => appends.has(node), forExpression: (node: Node) => reads.get(node),
    forRead: (node: Node) => indexedReads.get(node), ...locals, forIteration });
}

function isLiteral(node: Node, ast: AstReader): boolean {
  return ["KindNumericLiteral", "KindStringLiteral", "KindNoSubstitutionTemplateLiteral",
    "KindTrueKeyword", "KindFalseKeyword", "KindNullKeyword"].includes(ast.kindName(node));
}
