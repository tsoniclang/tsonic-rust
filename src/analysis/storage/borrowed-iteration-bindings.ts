import type { AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ForInOrOfStatement_Initializer, ForInOrOfStatement_Statement, Node_Expression, Node_Name, Node_Operand, VariableDeclarationList_Declarations, type SourceProgramNavigation } from "@tsonic/target-api/source";

import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { isRustStringCarrier } from "../../target-model/types/index.js";
import { isRustAssignmentOperator } from "../../target-model/syntax/tokens.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustBorrowedIterationBinding } from "../../target-model/records/storage/borrowed-element-reads.js";
import { rustBorrowedStringAppend, rustBorrowPureOperation } from "./borrowed-element-purity.js";
import { rustBorrowedStringInputs } from "./provider-borrows.js";

export function selectRustBorrowedIterationBinding(
  node: Node, ast: AstReader, records: RustProgramRecords, navigation: SourceProgramNavigation,
): RustBorrowedIterationBinding | undefined {
  const iteration = records.targetOperation.get(node);
  const iterable = Node_Expression(ast, node);
  const carrier = iterable === undefined ? undefined : rustEffectiveValueCarrier(records, iterable);
  const initializer = ForInOrOfStatement_Initializer(ast, node);
  const declarations = initializer === undefined ? undefined : VariableDeclarationList_Declarations(ast, initializer);
  const declaration = declarations?.length === 1 ? declarations[0] : undefined;
  const name = declaration === undefined ? undefined : Node_Name(ast, declaration);
  const body = ForInOrOfStatement_Statement(ast, node);
  if (iteration?.kind !== "iteration" || iteration.iterationKind !== "for-of" ||
    iteration.lowering.kind !== "borrowed" || iteration.lowering.style !== "cloned" ||
    !isRustStringCarrier(iteration.elementCarrier) ||
    carrier?.kind !== "reference" || carrier.mutable || carrier.referent.kind !== "slice" ||
    !isRustStringCarrier(carrier.referent.element) || declaration === undefined || name === undefined ||
    !ast.is.IsIdentifier(name) || body === undefined ||
    ast.variableDeclarationKind(declaration) === "using" || ast.variableDeclarationKind(declaration) === "await using") return undefined;
  const summary = navigation.declarationUseSummary(declaration);
  if (summary.captured || summary.exported || summary.bindingWritten || summary.memberWritten) return undefined;
  const uses = summary.uses.filter(use => use.kind !== "source-linkage" && use.kind !== "type-only");
  if (uses.length === 0 || !uses.every(use => isWithin(use.reference, body, ast) && readonlyUse(use.reference)) ||
    !safeStatement(body)) return undefined;
  return Object.freeze({ declaration, references: Object.freeze(uses.map(use => use.reference)) });

  function readonlyUse(reference: Node): boolean {
    let current = reference;
    let parent = ast.parent(current);
    while (parent !== undefined && transparent(parent)) {
      current = parent;
      parent = ast.parent(current);
    }
    if (parent === undefined) return false;
    if (rustBorrowedStringAppend(parent, ast, records)) return BinaryExpression_Right(ast, parent) === current;
    const call = ast.parent(parent);
    if (ast.is.IsPropertyAccessExpression(parent) && call !== undefined && ast.is.IsCallExpression(call) &&
      Node_Expression(ast, call) === parent) parent = call;
    const operation = rustBorrowPureOperation(parent, records);
    return operation !== undefined && rustBorrowedStringInputs(parent, operation, ast).includes(current);
  }

  function transparent(expression: Node): boolean {
    return ast.is.IsParenthesizedExpression(expression) || ast.is.IsAsExpression(expression) ||
      ast.is.IsTypeAssertion(expression) || ast.is.IsSatisfiesExpression(expression);
  }

  function pureExpression(expression: Node | undefined): boolean {
    if (expression === undefined) return false;
    if (["KindNumericLiteral", "KindStringLiteral", "KindNoSubstitutionTemplateLiteral", "KindTrueKeyword",
      "KindFalseKeyword", "KindNullKeyword"].includes(ast.kindName(expression))) return true;
    if (ast.is.IsIdentifier(expression)) {
      const binding = navigation.sourceReferenceFor(expression)?.declaration;
      return binding !== undefined && enclosingCallable(binding, ast) === enclosingCallable(node, ast);
    }
    if (transparent(expression)) return pureExpression(Node_Expression(ast, expression));
    const operation = records.targetOperation.get(expression);
    if (operation?.kind === "operator-token" && !isRustAssignmentOperator(operation.operator)) {
      const left = BinaryExpression_Left(ast, expression);
      const right = BinaryExpression_Right(ast, expression);
      return left !== undefined && right !== undefined ? pureExpression(left) && pureExpression(right)
        : pureExpression(Node_Operand(ast, expression));
    }
    const provider = rustBorrowPureOperation(expression, records);
    if (provider === undefined) return false;
    const callee = Node_Expression(ast, expression);
    const receiver = ast.is.IsCallExpression(expression) ? callee === undefined ? undefined : Node_Expression(ast, callee) : callee;
    return (provider.abi.sourceReceiver.kind === "none" || pureExpression(receiver)) &&
      (!ast.is.IsCallExpression(expression) || ast.arguments(expression).every(pureExpression));
  }

  function safeStatement(statement: Node): boolean {
    switch (ast.kindName(statement)) {
      case "KindBlock": return ast.statements(statement).every(child => child !== undefined && safeStatement(child));
      case "KindExpressionStatement": {
        const expression = Node_Expression(ast, statement);
        return expression !== undefined && (rustBorrowedStringAppend(expression, ast, records)
          ? pureExpression(BinaryExpression_Right(ast, expression)) : pureExpression(expression));
      }
      case "KindIfStatement": {
        const conditional = ast.as.AsIfStatement(statement);
        return conditional?.ThenStatement !== undefined && pureExpression(conditional.Expression) &&
          safeStatement(conditional.ThenStatement) &&
          (conditional.ElseStatement === undefined || safeStatement(conditional.ElseStatement));
      }
      case "KindEmptyStatement": return true;
      default: return false;
    }
  }
}

export function analyzeRustBorrowedIterationBindings(
  ast: AstReader, nativeNodes: readonly Node[], records: RustProgramRecords, navigation: SourceProgramNavigation,
): (node: Node) => RustBorrowedIterationBinding | undefined {
  const bindings = new WeakMap<Node, RustBorrowedIterationBinding>();
  const visit = (node: Node): void => {
    if (ast.is.IsForOfStatement(node)) {
      const selected = selectRustBorrowedIterationBinding(node, ast, records, navigation);
      if (selected !== undefined) bindings.set(node, selected);
    }
  };
  nativeNodes.forEach(visit);
  return node => bindings.get(node);
}

function isWithin(node: Node, ancestor: Node, ast: AstReader): boolean {
  for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

function enclosingCallable(node: Node, ast: AstReader): Node | undefined {
  for (let current = ast.parent(node); current !== undefined; current = ast.parent(current)) {
    if (["KindFunctionDeclaration", "KindFunctionExpression", "KindArrowFunction", "KindMethodDeclaration",
      "KindConstructor", "KindGetAccessor", "KindSetAccessor"].includes(ast.kindName(current))) return current;
  }
  return undefined;
}
