import { createAstReader } from "@tsonic/tsts";
import type { AstReader, ExtensionFactSubject, Node } from "@tsonic/tsts";

// Kind names compared against ast.kindName(node). Node fields are accessed
// only through the public AstReader cast contract.

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

const sourceAst = createAstReader();

export function asSourceNode(
  subject: ExtensionFactSubject | undefined,
  ast: Pick<AstReader, "kind">,
): Node | undefined {
  if (subject === undefined) {
    return undefined;
  }
  return ast.kind(subject as Node) === undefined ? undefined : subject as Node;
}

export function Node_Name(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.name(node);
}

export function Node_Expression(node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (sourceAst.kindName(node)) {
    case KindExpressionStatement:
      return sourceAst.as.AsExpressionStatement(node)?.Expression;
    case KindReturnStatement:
      return sourceAst.as.AsReturnStatement(node)?.Expression;
    case "KindThrowStatement":
      return sourceAst.as.AsThrowStatement(node)?.Expression;
    case KindIfStatement:
      return sourceAst.as.AsIfStatement(node)?.Expression;
    case KindWhileStatement:
      return sourceAst.as.AsWhileStatement(node)?.Expression;
    case "KindDoStatement":
      return sourceAst.as.AsDoStatement(node)?.Expression;
    case KindForOfStatement:
    case "KindForInStatement":
      return sourceAst.as.AsForInOrOfStatement(node)?.Expression;
    case KindPropertyAccessExpression:
      return sourceAst.as.AsPropertyAccessExpression(node)?.Expression;
    case KindElementAccessExpression:
      return sourceAst.as.AsElementAccessExpression(node)?.Expression;
    case KindCallExpression:
      return sourceAst.as.AsCallExpression(node)?.Expression;
    case KindNewExpression:
      return sourceAst.as.AsNewExpression(node)?.Expression;
    case KindParenthesizedExpression:
      return sourceAst.as.AsParenthesizedExpression(node)?.Expression;
    case "KindAwaitExpression":
      return sourceAst.as.AsAwaitExpression(node)?.Expression;
    case "KindAsExpression":
      return sourceAst.as.AsAsExpression(node)?.Expression;
    case "KindSatisfiesExpression":
      return sourceAst.as.AsSatisfiesExpression(node)?.Expression;
    case "KindTypeAssertionExpression":
      return sourceAst.as.AsTypeAssertion(node)?.Expression;
    case "KindVoidExpression":
      return sourceAst.as.AsVoidExpression(node)?.Expression;
    case "KindYieldExpression":
      return sourceAst.as.AsYieldExpression(node)?.Expression;
    case "KindSpreadElement":
      return sourceAst.as.AsSpreadElement(node)?.Expression;
    default:
      return undefined;
  }
}

export function Node_Type(node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (sourceAst.kindName(node)) {
    case KindVariableDeclaration:
      return sourceAst.as.AsVariableDeclaration(node)?.Type;
    case KindParameter:
      return sourceAst.as.AsParameterDeclaration(node)?.Type;
    case KindFunctionDeclaration:
      return sourceAst.as.AsFunctionDeclaration(node)?.Type;
    case "KindMethodDeclaration":
      return sourceAst.as.AsMethodDeclaration(node)?.Type;
    case "KindMethodSignature":
      return sourceAst.as.AsMethodSignatureDeclaration(node)?.Type;
    case "KindPropertyDeclaration":
      return sourceAst.as.AsPropertyDeclaration(node)?.Type;
    case "KindPropertySignature":
      return sourceAst.as.AsPropertySignatureDeclaration(node)?.Type;
    case "KindCallSignature":
      return sourceAst.as.AsCallSignatureDeclaration(node)?.Type;
    case "KindConstructSignature":
      return sourceAst.as.AsConstructSignatureDeclaration(node)?.Type;
    case "KindConstructor":
      return sourceAst.as.AsConstructorDeclaration(node)?.Type;
    case "KindGetAccessor":
      return sourceAst.as.AsGetAccessorDeclaration(node)?.Type;
    case "KindSetAccessor":
      return sourceAst.as.AsSetAccessorDeclaration(node)?.Type;
    case "KindTypeAliasDeclaration":
      return sourceAst.as.AsTypeAliasDeclaration(node)?.Type;
    case "KindAsExpression":
      return sourceAst.as.AsAsExpression(node)?.Type;
    case "KindSatisfiesExpression":
      return sourceAst.as.AsSatisfiesExpression(node)?.Type;
    case "KindTypeAssertionExpression":
      return sourceAst.as.AsTypeAssertion(node)?.Type;
    case KindBinaryExpression:
      return sourceAst.as.AsBinaryExpression(node)?.Type;
    default:
      return undefined;
  }
}

export function TypeOperatorNode_Type(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsTypeOperatorNode(node)?.Type;
}

export function Node_Initializer(node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (sourceAst.kindName(node)) {
    case KindVariableDeclaration:
      return sourceAst.as.AsVariableDeclaration(node)?.Initializer;
    case KindParameter:
      return sourceAst.as.AsParameterDeclaration(node)?.Initializer;
    case "KindPropertyDeclaration":
      return sourceAst.as.AsPropertyDeclaration(node)?.Initializer;
    case "KindBindingElement":
      return sourceAst.as.AsBindingElement(node)?.Initializer;
    case "KindPropertyAssignment":
      return sourceAst.as.AsPropertyAssignment(node)?.Initializer;
    case "KindEnumMember":
      return sourceAst.as.AsEnumMember(node)?.Initializer;
    default:
      return undefined;
  }
}

export function BinaryExpression_Left(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsBinaryExpression(node)?.Left;
}

export function BinaryExpression_Right(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsBinaryExpression(node)?.Right;
}

export function BinaryExpression_OperatorToken(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsBinaryExpression(node)?.OperatorToken;
}

export function PrefixUnaryExpression_Operand(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsPrefixUnaryExpression(node)?.Operand;
}

export function IfStatement_ThenStatement(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsIfStatement(node)?.ThenStatement;
}

export function IfStatement_ElseStatement(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsIfStatement(node)?.ElseStatement;
}

export function ForStatement_Initializer(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsForStatement(node)?.Initializer;
}

export function ForStatement_Condition(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsForStatement(node)?.Condition;
}

export function ForStatement_Incrementor(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsForStatement(node)?.Incrementor;
}

export function ElementAccessExpression_ArgumentExpression(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsElementAccessExpression(node)?.ArgumentExpression;
}

export function ArrayTypeNode_ElementType(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsArrayTypeNode(node)?.ElementType;
}

export function ForInOrOfStatement_Initializer(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsForInOrOfStatement(node)?.Initializer;
}

export function ForInOrOfStatement_Statement(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsForInOrOfStatement(node)?.Statement;
}

export function IterationStatement_Statement(node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (sourceAst.kindName(node)) {
    case KindForStatement:
      return sourceAst.as.AsForStatement(node)?.Statement;
    case KindWhileStatement:
      return sourceAst.as.AsWhileStatement(node)?.Statement;
    case "KindDoStatement":
      return sourceAst.as.AsDoStatement(node)?.Statement;
    case KindForOfStatement:
    case "KindForInStatement":
      return sourceAst.as.AsForInOrOfStatement(node)?.Statement;
    default:
      return undefined;
  }
}

export function TypeReferenceNode_TypeName(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsTypeReferenceNode(node)?.TypeName;
}

export function Node_Operand(node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  const kind = sourceAst.kindName(node);
  return kind === KindPrefixUnaryExpression
    ? sourceAst.as.AsPrefixUnaryExpression(node)?.Operand
    : kind === KindPostfixUnaryExpression
      ? sourceAst.as.AsPostfixUnaryExpression(node)?.Operand
      : undefined;
}

export function TryStatement_TryBlock(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsTryStatement(node)?.TryBlock;
}

export function TryStatement_CatchClause(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsTryStatement(node)?.CatchClause;
}

export function TryStatement_FinallyBlock(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsTryStatement(node)?.FinallyBlock;
}

export function CatchClause_VariableDeclaration(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsCatchClause(node)?.VariableDeclaration;
}

export function CatchClause_Block(node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : sourceAst.as.AsCatchClause(node)?.Block;
}
