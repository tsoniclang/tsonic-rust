import type { AstReader, Node } from "@tsonic/tsts";

// Kind names compared against ast.kindName(node). Field access is duck-typed
// against the TS-Go AST data shapes; no internal TSTS modules are imported.

export const KindBinaryExpression = "KindBinaryExpression";
export const KindBlock = "KindBlock";
export const KindBooleanKeyword = "KindBooleanKeyword";
export const KindCallExpression = "KindCallExpression";
export const KindElementAccessExpression = "KindElementAccessExpression";
export const KindExpressionStatement = "KindExpressionStatement";
export const KindFalseKeyword = "KindFalseKeyword";
export const KindForStatement = "KindForStatement";
export const KindFunctionDeclaration = "KindFunctionDeclaration";
export const KindIdentifier = "KindIdentifier";
export const KindIfStatement = "KindIfStatement";
export const KindImportDeclaration = "KindImportDeclaration";
export const KindArrayLiteralExpression = "KindArrayLiteralExpression";
export const KindArrayType = "KindArrayType";
export const KindTypeOperator = "KindTypeOperator";
export const KindOmittedExpression = "KindOmittedExpression";
export const KindForOfStatement = "KindForOfStatement";
export const KindInterfaceDeclaration = "KindInterfaceDeclaration";
export const KindNewExpression = "KindNewExpression";
export const KindNumericLiteral = "KindNumericLiteral";
export const KindParameter = "KindParameter";
export const KindParenthesizedExpression = "KindParenthesizedExpression";
export const KindPostfixUnaryExpression = "KindPostfixUnaryExpression";
export const KindPrefixUnaryExpression = "KindPrefixUnaryExpression";
export const KindPropertyAccessExpression = "KindPropertyAccessExpression";
export const KindReturnStatement = "KindReturnStatement";
export const KindStringKeyword = "KindStringKeyword";
export const KindStringLiteral = "KindStringLiteral";
export const KindTrueKeyword = "KindTrueKeyword";
export const KindTypeReference = "KindTypeReference";
export const KindVariableDeclaration = "KindVariableDeclaration";
export const KindVariableStatement = "KindVariableStatement";
export const KindVoidKeyword = "KindVoidKeyword";
export const KindWhileStatement = "KindWhileStatement";

// Operator token kind names.
export const KindPlusToken = "KindPlusToken";
export const KindMinusToken = "KindMinusToken";
export const KindAsteriskToken = "KindAsteriskToken";
export const KindSlashToken = "KindSlashToken";
export const KindPercentToken = "KindPercentToken";
export const KindLessThanToken = "KindLessThanToken";
export const KindLessThanEqualsToken = "KindLessThanEqualsToken";
export const KindGreaterThanToken = "KindGreaterThanToken";
export const KindGreaterThanEqualsToken = "KindGreaterThanEqualsToken";
export const KindEqualsEqualsEqualsToken = "KindEqualsEqualsEqualsToken";
export const KindExclamationEqualsEqualsToken = "KindExclamationEqualsEqualsToken";
export const KindAmpersandAmpersandToken = "KindAmpersandAmpersandToken";
export const KindBarBarToken = "KindBarBarToken";
export const KindEqualsToken = "KindEqualsToken";
export const KindPlusEqualsToken = "KindPlusEqualsToken";
export const KindMinusEqualsToken = "KindMinusEqualsToken";
export const KindAsteriskEqualsToken = "KindAsteriskEqualsToken";
export const KindSlashEqualsToken = "KindSlashEqualsToken";
export const KindPercentEqualsToken = "KindPercentEqualsToken";
export const KindExclamationToken = "KindExclamationToken";
export const KindPlusPlusToken = "KindPlusPlusToken";
export const KindMinusMinusToken = "KindMinusMinusToken";

function nodeField(node: Node | undefined, fieldName: string): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  const value = (node as unknown as Record<string, unknown>)[fieldName];
  return typeof value === "object" && value !== null ? (value as Node) : undefined;
}

export function Node_Text(node: Node | undefined): string {
  const text = (node as { readonly Text?: unknown } | undefined)?.Text;
  return typeof text === "string" ? text : "";
}

export function Node_Name(node: Node | undefined): Node | undefined {
  return nodeField(node, "name");
}

export function Node_Expression(node: Node | undefined): Node | undefined {
  return nodeField(node, "Expression");
}

export function Node_Type(node: Node | undefined): Node | undefined {
  return nodeField(node, "Type");
}

export function Node_Initializer(node: Node | undefined): Node | undefined {
  return nodeField(node, "Initializer");
}

export function BinaryExpression_Left(node: Node | undefined): Node | undefined {
  return nodeField(node, "Left");
}

export function BinaryExpression_Right(node: Node | undefined): Node | undefined {
  return nodeField(node, "Right");
}

export function BinaryExpression_OperatorToken(node: Node | undefined): Node | undefined {
  return nodeField(node, "OperatorToken");
}

export function PrefixUnaryExpression_Operand(node: Node | undefined): Node | undefined {
  return nodeField(node, "Operand");
}

export function IfStatement_ThenStatement(node: Node | undefined): Node | undefined {
  return nodeField(node, "ThenStatement");
}

export function IfStatement_ElseStatement(node: Node | undefined): Node | undefined {
  return nodeField(node, "ElseStatement");
}

export function ForStatement_Initializer(node: Node | undefined): Node | undefined {
  return nodeField(node, "Initializer");
}

export function ForStatement_Condition(node: Node | undefined): Node | undefined {
  return nodeField(node, "Condition");
}

export function ForStatement_Incrementor(node: Node | undefined): Node | undefined {
  return nodeField(node, "Incrementor");
}

export function ElementAccessExpression_ArgumentExpression(node: Node | undefined): Node | undefined {
  return nodeField(node, "ArgumentExpression");
}

export function ArrayTypeNode_ElementType(node: Node | undefined): Node | undefined {
  return nodeField(node, "ElementType");
}

export function ForInOrOfStatement_Initializer(node: Node | undefined): Node | undefined {
  return nodeField(node, "Initializer");
}

export function ForInOrOfStatement_Statement(node: Node | undefined): Node | undefined {
  return nodeField(node, "Statement");
}

export function IterationStatement_Statement(node: Node | undefined): Node | undefined {
  return nodeField(node, "Statement");
}

export function TypeReferenceNode_TypeName(node: Node | undefined): Node | undefined {
  return nodeField(node, "TypeName");
}

export function Node_Operand(node: Node | undefined): Node | undefined {
  return nodeField(node, "Operand");
}

export function Node_Flags(node: Node | undefined): number {
  const value = (node as unknown as { readonly Flags?: unknown } | undefined)?.Flags;
  return typeof value === "number" ? value : 0;
}

export function VariableStatement_DeclarationList(node: Node | undefined): Node | undefined {
  return nodeField(node, "DeclarationList");
}

// Unary expressions expose the operator as a raw numeric Kind, which the
// public AstReader cannot name. Follow the reference approach: read the
// operator text from the source span between node and operand.
export function getPrefixUnaryOperatorText(ast: AstReader, node: Node): string | undefined {
  const operand = PrefixUnaryExpression_Operand(node);
  const sourceText = ast.getSourceText(ast.getSourceFile(node));
  const start = ast.pos(node);
  const end = operand === undefined ? ast.end(node) : ast.pos(operand);
  const prefixText = start < 0 || end < start ? "" : sourceText.slice(start, end).trimStart();
  for (const operator of ["++", "--", "!", "-", "+"]) {
    if (prefixText.startsWith(operator)) {
      return operator;
    }
  }
  return undefined;
}

export function getPostfixUnaryOperatorText(ast: AstReader, node: Node): string | undefined {
  const operand = nodeField(node, "Operand");
  const sourceText = ast.getSourceText(ast.getSourceFile(node));
  const start = operand === undefined ? ast.pos(node) : ast.end(operand);
  const end = ast.end(node);
  const postfixText = start < 0 || end < start ? "" : sourceText.slice(start, end).trimEnd();
  for (const operator of ["++", "--"]) {
    if (postfixText.startsWith(operator)) {
      return operator;
    }
  }
  return undefined;
}
