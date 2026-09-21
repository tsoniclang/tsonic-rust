import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Expression, type SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustTargetProgram } from "./model.js";
import { analyzeRustBorrowedElementLocals, type RustBorrowedElementLocal } from "./borrowed-element-locals.js";
import { rustBorrowedElementRead, rustBorrowedStringInputs, rustBorrowPureOperation } from "./borrowed-element-purity.js";

export interface RustBorrowedElementRead {
  readonly receiver: Node;
  readonly array: Node;
  readonly index: Node;
  readonly method: string;
}

export interface RustBorrowedElementReads {
  forExpression(node: Node): RustBorrowedElementRead | undefined;
  forStatement(node: Node): RustBorrowedElementLocal | undefined;
  endingAt(node: Node): readonly RustBorrowedElementLocal[];
}

export function analyzeRustBorrowedElementReads(
  ast: AstReader,
  files: readonly SourceFile[],
  facts: RustTargetProgram["facts"],
  navigation: SourceProgramNavigation,
): RustBorrowedElementReads {
  const reads = new WeakMap<Node, RustBorrowedElementRead>();
  const visit = (node: Node): void => {
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
          reads.set(node, read);
          break;
        }
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  files.forEach(visit);
  const locals = analyzeRustBorrowedElementLocals(ast, files, facts, navigation);
  return Object.freeze({ forExpression: (node: Node) => reads.get(node), ...locals });
}

function isLiteral(node: Node, ast: AstReader): boolean {
  return ["KindNumericLiteral", "KindStringLiteral", "KindNoSubstitutionTemplateLiteral",
    "KindTrueKeyword", "KindFalseKeyword", "KindNullKeyword"].includes(ast.kindName(node));
}
