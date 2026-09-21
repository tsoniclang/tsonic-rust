import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import {
  BinaryExpression_Left, BinaryExpression_Right, BreakOrContinueStatement_Label, Node_Expression, Node_Initializer, Node_Operand,
  VariableDeclarationList_Declarations, VariableStatement_DeclarationList, type SourceProgramNavigation,
} from "@tsonic/target-api/source";
import { rustSourceBindingFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import type { RustBorrowedElementRead } from "./borrowed-element-reads.js";
import { rustBorrowedElementRead, rustBorrowedStringInputs, rustBorrowPureOperation } from "./borrowed-element-purity.js";
import type { RustTargetProgram } from "./model.js";

export interface RustBorrowedElementLocal extends RustBorrowedElementRead {
  readonly declaration: Node;
  readonly references: readonly Node[];
  readonly lastStatement: Node;
}

export function analyzeRustBorrowedElementLocals(
  ast: AstReader,
  files: readonly SourceFile[],
  facts: RustTargetProgram["facts"],
  navigation: SourceProgramNavigation,
) {
  const starts = new WeakMap<Node, RustBorrowedElementLocal>();
  const endings = new WeakMap<Node, readonly RustBorrowedElementLocal[]>();
  const pureStatements = new WeakMap<Node, boolean>();
  const pureExpression = (node: Node | undefined): boolean => {
    if (node === undefined) return false;
    const kind = ast.kindName(node);
    if (["KindNumericLiteral", "KindStringLiteral", "KindNoSubstitutionTemplateLiteral",
      "KindTrueKeyword", "KindFalseKeyword", "KindNullKeyword"].includes(kind)) return true;
    if (ast.is.IsIdentifier(node)) {
      const declaration = facts.getFact(node, rustSourceBindingFactKey)?.sourceDeclaration;
      return declaration !== undefined && isLocal(declaration, ast);
    }
    if (ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
      ast.is.IsTypeAssertion(node) || ast.is.IsSatisfiesExpression(node) || ast.is.IsNonNullExpression(node)) {
      return pureExpression(Node_Expression(ast, node));
    }
    const operation = facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "operator-token") {
      const left = BinaryExpression_Left(ast, node);
      const right = BinaryExpression_Right(ast, node);
      const operand = Node_Operand(ast, node);
      return left !== undefined && right !== undefined
        ? pureExpression(left) && pureExpression(right) &&
          (!isRustAssignmentOperator(operation.operator) ||
            ast.is.IsIdentifier(left) && facts.getRuntimeCarrierFact(left)?.carrier.kind === "source-primitive")
        : operand !== undefined && pureExpression(operand) &&
          (!isRustAssignmentOperator(operation.operator) ||
            ast.is.IsIdentifier(operand) && facts.getRuntimeCarrierFact(operand)?.carrier.kind === "source-primitive");
    }
    const provider = rustBorrowPureOperation(node, facts);
    if (provider === undefined) return false;
    const expression = Node_Expression(ast, node);
    const receiver = ast.is.IsCallExpression(node)
      ? expression === undefined ? undefined : Node_Expression(ast, expression) : expression;
    return (provider.abi.sourceReceiver.kind === "none" || pureExpression(receiver)) &&
      (!ast.is.IsCallExpression(node) || ast.arguments(node).every(pureExpression)) &&
      (!ast.is.IsElementAccessExpression(node) || pureExpression(ast.as.AsElementAccessExpression(node)?.ArgumentExpression));
  };
  const pureStatement = (node: Node | undefined): boolean => {
    if (node === undefined) return false;
    const cached = pureStatements.get(node);
    if (cached !== undefined) return cached;
    let pure = false;
    switch (ast.kindName(node)) {
      case "KindVariableStatement": {
        const list = VariableStatement_DeclarationList(ast, node);
        pure = list !== undefined && VariableDeclarationList_Declarations(ast, list)?.every(declaration =>
          declaration !== undefined && ast.variableDeclarationKind(declaration) !== "using" &&
          ast.variableDeclarationKind(declaration) !== "await using" &&
          ast.name(declaration) !== undefined && ast.is.IsIdentifier(ast.name(declaration)!) &&
          pureExpression(Node_Initializer(ast, declaration))) === true;
        break;
      }
      case "KindExpressionStatement":
      case "KindReturnStatement":
        pure = pureExpression(Node_Expression(ast, node));
        break;
      case "KindBlock":
        pure = ast.statements(node).every(pureStatement);
        break;
      case "KindIfStatement": {
        const conditional = ast.as.AsIfStatement(node);
        pure = pureExpression(conditional?.Expression) && pureStatement(conditional?.ThenStatement) &&
          (conditional?.ElseStatement === undefined || pureStatement(conditional.ElseStatement));
        break;
      }
      case "KindContinueStatement":
        if (BreakOrContinueStatement_Label(ast, node) !== undefined) break;
        for (let parent = ast.parent(node); parent !== undefined; parent = ast.parent(parent)) {
          if (ast.is.IsForStatement(parent)) {
            const increment = ast.as.AsForStatement(parent)?.Incrementor;
            pure = increment === undefined || pureExpression(increment);
            break;
          }
          if (["KindWhileStatement", "KindDoStatement", "KindForOfStatement", "KindForInStatement"].includes(ast.kindName(parent))) {
            pure = true;
            break;
          }
        }
        break;
      case "KindBreakStatement":
      case "KindEmptyStatement":
        pure = true;
    }
    pureStatements.set(node, pure);
    return pure;
  };
  const readonlyUse = (reference: Node): boolean => {
    let current = reference;
    let parent = ast.parent(current);
    while (parent !== undefined && (ast.is.IsParenthesizedExpression(parent) || ast.is.IsAsExpression(parent) ||
      ast.is.IsTypeAssertion(parent) || ast.is.IsSatisfiesExpression(parent))) {
      current = parent;
      parent = ast.parent(current);
    }
    if (parent === undefined) return false;
    if (ast.is.IsPropertyAccessExpression(parent) && ast.parent(parent) !== undefined &&
      ast.is.IsCallExpression(ast.parent(parent)!) && Node_Expression(ast, ast.parent(parent)!) === parent) {
      parent = ast.parent(parent)!;
    }
    const operation = rustBorrowPureOperation(parent, facts);
    if (operation !== undefined) return rustBorrowedStringInputs(parent, operation, ast).includes(current);
    const binary = facts.getFact(parent, rustTargetOperationFactKey);
    return binary?.kind === "operator-token" && ["==", "!=", "<", ">", "<=", ">="].includes(binary.operator);
  };
  const visit = (node: Node): void => {
    if (ast.is.IsBlock(node)) {
      const statements = ast.statements(node);
      const statementIndexes = new Map(statements.map((statement, index) => [statement, index]));
      const impurityPrefix = [0];
      for (const statement of statements) impurityPrefix.push(impurityPrefix[impurityPrefix.length - 1]! + (pureStatement(statement) ? 0 : 1));
      for (let start = 0; start < statements.length; start++) {
        const statement = statements[start];
        if (statement === undefined || !ast.is.IsVariableStatement(statement)) continue;
        const list = VariableStatement_DeclarationList(ast, statement);
        const declarations = list === undefined ? [] : VariableDeclarationList_Declarations(ast, list) ?? [];
        const declaration = declarations.length === 1 ? declarations[0] : undefined;
        if (declaration === undefined || !isRustStringCarrier(facts.getRuntimeCarrierFact(declaration)?.carrier)) continue;
        const initializer = Node_Initializer(ast, declaration);
        const read = initializer === undefined ? undefined : rustBorrowedElementRead(initializer, ast, facts);
        if (read === undefined || !ast.is.IsIdentifier(read.array)) continue;
        const arrayBinding = facts.getFact(read.array, rustSourceBindingFactKey)?.sourceDeclaration;
        if (arrayBinding === undefined || !isLocal(arrayBinding, ast)) continue;
        const summary = navigation.declarationUseSummary(declaration);
        if (summary.bindingWritten || summary.captured || summary.exported) continue;
        const uses = summary.uses.filter(use => use.kind !== "source-linkage" && use.kind !== "type-only");
        if (uses.length === 0 || !uses.every(use => readonlyUse(use.reference))) continue;
        let end = start;
        let valid = true;
        for (const use of uses) {
          let enclosing: Node | undefined = use.reference;
          while (enclosing !== undefined && ast.parent(enclosing) !== node) enclosing = ast.parent(enclosing);
          const index = statementIndexes.get(enclosing);
          if (index === undefined || index <= start) { valid = false; break; }
          end = Math.max(end, index);
        }
        if (!valid || impurityPrefix[end + 1] !== impurityPrefix[start + 1]) continue;
        const lastStatement = statements[end]!;
        const local = Object.freeze({ ...read, declaration, lastStatement,
          references: Object.freeze(uses.map(use => use.reference)) });
        starts.set(statement, local);
        endings.set(lastStatement, Object.freeze([...(endings.get(lastStatement) ?? []), local]));
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  files.forEach(visit);
  return Object.freeze({
    forStatement: (node: Node) => starts.get(node),
    endingAt: (node: Node) => endings.get(node) ?? [],
  });
}

function isLocal(node: Node, ast: AstReader): boolean {
  let current = ast.parent(node);
  while (current !== undefined) {
    if (ast.is.IsFunctionDeclaration(current) || ast.is.IsFunctionExpression(current) || ast.is.IsArrowFunction(current) ||
      ["KindMethodDeclaration", "KindConstructor", "KindGetAccessor", "KindSetAccessor"].includes(ast.kindName(current))) return true;
    current = ast.parent(current);
  }
  return false;
}
