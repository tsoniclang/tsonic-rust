import type { AstReader, ExtensionFactSubject, Node } from "@tsonic/tsts";

export const KindBinaryExpression = "KindBinaryExpression";
export const KindArrayBindingPattern = "KindArrayBindingPattern";
export const KindBigIntLiteral = "KindBigIntLiteral";
export const KindBindingElement = "KindBindingElement";
export const KindBlock = "KindBlock";
export const KindBreakStatement = "KindBreakStatement";
export const KindBooleanKeyword = "KindBooleanKeyword";
export const KindCallExpression = "KindCallExpression";
export const KindCaseClause = "KindCaseClause";
export const KindConditionalExpression = "KindConditionalExpression";
export const KindContinueStatement = "KindContinueStatement";
export const KindDebuggerStatement = "KindDebuggerStatement";
export const KindDefaultClause = "KindDefaultClause";
export const KindDeleteExpression = "KindDeleteExpression";
export const KindDoStatement = "KindDoStatement";
export const KindElementAccessExpression = "KindElementAccessExpression";
export const KindEmptyStatement = "KindEmptyStatement";
export const KindExpressionStatement = "KindExpressionStatement";
export const KindExportDeclaration = "KindExportDeclaration";
export const KindFalseKeyword = "KindFalseKeyword";
export const KindForStatement = "KindForStatement";
export const KindForInStatement = "KindForInStatement";
export const KindFunctionDeclaration = "KindFunctionDeclaration";
export const KindFunctionExpression = "KindFunctionExpression";
export const KindIdentifier = "KindIdentifier";
export const KindIfStatement = "KindIfStatement";
export const KindImportDeclaration = "KindImportDeclaration";
export const KindArrayLiteralExpression = "KindArrayLiteralExpression";
export const KindArrayType = "KindArrayType";
export const KindTypeOperator = "KindTypeOperator";
export const KindOmittedExpression = "KindOmittedExpression";
export const KindForOfStatement = "KindForOfStatement";
export const KindInterfaceDeclaration = "KindInterfaceDeclaration";
export const KindLabeledStatement = "KindLabeledStatement";
export const KindNewExpression = "KindNewExpression";
export const KindNoSubstitutionTemplateLiteral = "KindNoSubstitutionTemplateLiteral";
export const KindNonNullExpression = "KindNonNullExpression";
export const KindNumericLiteral = "KindNumericLiteral";
export const KindObjectBindingPattern = "KindObjectBindingPattern";
export const KindParameter = "KindParameter";
export const KindParenthesizedExpression = "KindParenthesizedExpression";
export const KindPostfixUnaryExpression = "KindPostfixUnaryExpression";
export const KindPrefixUnaryExpression = "KindPrefixUnaryExpression";
export const KindPropertyAccessExpression = "KindPropertyAccessExpression";
export const KindReturnStatement = "KindReturnStatement";
export const KindStringKeyword = "KindStringKeyword";
export const KindStringLiteral = "KindStringLiteral";
export const KindSatisfiesExpression = "KindSatisfiesExpression";
export const KindSwitchStatement = "KindSwitchStatement";
export const KindTemplateExpression = "KindTemplateExpression";
export const KindTrueKeyword = "KindTrueKeyword";
export const KindTypeOfExpression = "KindTypeOfExpression";
export const KindTypeReference = "KindTypeReference";
export const KindVariableDeclaration = "KindVariableDeclaration";
export const KindVariableDeclarationList = "KindVariableDeclarationList";
export const KindVariableStatement = "KindVariableStatement";
export const KindVoidKeyword = "KindVoidKeyword";
export const KindVoidExpression = "KindVoidExpression";
export const KindWhileStatement = "KindWhileStatement";

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
export const KindQuestionQuestionToken = "KindQuestionQuestionToken";
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

export function asSourceNode(
  subject: ExtensionFactSubject | undefined,
  ast: Pick<AstReader, "kind">,
): Node | undefined {
  if (subject === undefined) {
    return undefined;
  }
  return ast.kind(subject as Node) === undefined ? undefined : subject as Node;
}

export function Node_Name(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined ? undefined : ast.name(node);
}

export function Node_Expression(ast: AstReader, node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (ast.kindName(node)) {
    case KindExpressionStatement:
      return ast.as.AsExpressionStatement(node)?.Expression;
    case KindReturnStatement:
      return ast.as.AsReturnStatement(node)?.Expression;
    case "KindThrowStatement":
      return ast.as.AsThrowStatement(node)?.Expression;
    case KindIfStatement:
      return ast.as.AsIfStatement(node)?.Expression;
    case KindWhileStatement:
      return ast.as.AsWhileStatement(node)?.Expression;
    case "KindDoStatement":
      return ast.as.AsDoStatement(node)?.Expression;
    case KindForOfStatement:
    case KindForInStatement:
      return ast.as.AsForInOrOfStatement(node)?.Expression;
    case KindPropertyAccessExpression:
      return ast.as.AsPropertyAccessExpression(node)?.Expression;
    case KindElementAccessExpression:
      return ast.as.AsElementAccessExpression(node)?.Expression;
    case KindCallExpression:
      return ast.as.AsCallExpression(node)?.Expression;
    case KindNewExpression:
      return ast.as.AsNewExpression(node)?.Expression;
    case KindParenthesizedExpression:
      return ast.as.AsParenthesizedExpression(node)?.Expression;
    case "KindAwaitExpression":
      return ast.as.AsAwaitExpression(node)?.Expression;
    case "KindAsExpression":
      return ast.as.AsAsExpression(node)?.Expression;
    case "KindSatisfiesExpression":
      return ast.as.AsSatisfiesExpression(node)?.Expression;
    case KindNonNullExpression:
      return ast.as.AsNonNullExpression(node)?.Expression;
    case "KindTypeAssertionExpression":
      return ast.as.AsTypeAssertion(node)?.Expression;
    case KindDeleteExpression:
      return ast.as.AsDeleteExpression(node)?.Expression;
    case KindVoidExpression:
      return ast.as.AsVoidExpression(node)?.Expression;
    case KindTypeOfExpression:
      return ast.as.AsTypeOfExpression(node)?.Expression;
    case "KindYieldExpression":
      return ast.as.AsYieldExpression(node)?.Expression;
    case "KindSpreadElement":
      return ast.as.AsSpreadElement(node)?.Expression;
    default:
      return undefined;
  }
}

export function ConditionalExpression_Condition(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindConditionalExpression
    ? undefined
    : ast.as.AsConditionalExpression(node)?.Condition;
}

export function ConditionalExpression_WhenTrue(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindConditionalExpression
    ? undefined
    : ast.as.AsConditionalExpression(node)?.WhenTrue;
}

export function ConditionalExpression_WhenFalse(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindConditionalExpression
    ? undefined
    : ast.as.AsConditionalExpression(node)?.WhenFalse;
}

export function TemplateExpression_Head(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindTemplateExpression
    ? undefined
    : ast.as.AsTemplateExpression(node)?.Head;
}

export function TemplateExpression_TemplateSpans(
  ast: AstReader,
  node: Node | undefined,
): readonly (Node | undefined)[] | undefined {
  return node === undefined || ast.kindName(node) !== KindTemplateExpression
    ? undefined
    : ast.as.AsTemplateExpression(node)?.TemplateSpans?.Nodes;
}

export function TemplateSpan_Expression(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== "KindTemplateSpan"
    ? undefined
    : ast.as.AsTemplateSpan(node)?.Expression;
}

export function TemplateSpan_Literal(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== "KindTemplateSpan"
    ? undefined
    : ast.as.AsTemplateSpan(node)?.Literal;
}

export function Node_Type(ast: AstReader, node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (ast.kindName(node)) {
    case KindVariableDeclaration:
      return ast.as.AsVariableDeclaration(node)?.Type;
    case KindParameter:
      return ast.as.AsParameterDeclaration(node)?.Type;
    case KindFunctionDeclaration:
      return ast.as.AsFunctionDeclaration(node)?.Type;
    case "KindArrowFunction":
      return ast.as.AsArrowFunction(node)?.Type;
    case KindFunctionExpression:
      return ast.as.AsFunctionExpression(node)?.Type;
    case "KindFunctionType":
      return ast.as.AsFunctionTypeNode(node)?.Type;
    case "KindConstructorType":
      return ast.as.AsConstructorTypeNode(node)?.Type;
    case "KindMethodDeclaration":
      return ast.as.AsMethodDeclaration(node)?.Type;
    case "KindMethodSignature":
      return ast.as.AsMethodSignatureDeclaration(node)?.Type;
    case "KindPropertyDeclaration":
      return ast.as.AsPropertyDeclaration(node)?.Type;
    case "KindPropertySignature":
      return ast.as.AsPropertySignatureDeclaration(node)?.Type;
    case "KindCallSignature":
      return ast.as.AsCallSignatureDeclaration(node)?.Type;
    case "KindConstructSignature":
      return ast.as.AsConstructSignatureDeclaration(node)?.Type;
    case "KindConstructor":
      return ast.as.AsConstructorDeclaration(node)?.Type;
    case "KindGetAccessor":
      return ast.as.AsGetAccessorDeclaration(node)?.Type;
    case "KindSetAccessor":
      return ast.as.AsSetAccessorDeclaration(node)?.Type;
    case "KindTypeAliasDeclaration":
      return ast.as.AsTypeAliasDeclaration(node)?.Type;
    case "KindAsExpression":
      return ast.as.AsAsExpression(node)?.Type;
    case "KindSatisfiesExpression":
      return ast.as.AsSatisfiesExpression(node)?.Type;
    case "KindTypeAssertionExpression":
      return ast.as.AsTypeAssertion(node)?.Type;
    case KindBinaryExpression:
      return ast.as.AsBinaryExpression(node)?.Type;
    default:
      return undefined;
  }
}

export function TypeOperatorNode_Type(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindTypeOperator
    ? undefined
    : ast.as.AsTypeOperatorNode(node)?.Type;
}

export function Node_Initializer(ast: AstReader, node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (ast.kindName(node)) {
    case KindVariableDeclaration:
      return ast.as.AsVariableDeclaration(node)?.Initializer;
    case KindParameter:
      return ast.as.AsParameterDeclaration(node)?.Initializer;
    case "KindPropertyDeclaration":
      return ast.as.AsPropertyDeclaration(node)?.Initializer;
    case "KindBindingElement":
      return ast.as.AsBindingElement(node)?.Initializer;
    case "KindPropertyAssignment":
      return ast.as.AsPropertyAssignment(node)?.Initializer;
    case "KindEnumMember":
      return ast.as.AsEnumMember(node)?.Initializer;
    default:
      return undefined;
  }
}

export function BindingElement_PropertyName(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || !ast.is.IsBindingElement(node)
    ? undefined
    : ast.as.AsBindingElement(node)?.PropertyName;
}

export function BindingElement_IsRest(ast: AstReader, node: Node | undefined): boolean {
  return node !== undefined && ast.is.IsBindingElement(node) &&
    ast.as.AsBindingElement(node)?.DotDotDotToken !== undefined;
}

export function VariableDeclarationList_Declarations(
  ast: AstReader,
  node: Node | undefined,
): readonly (Node | undefined)[] | undefined {
  if (node === undefined || ast.kindName(node) !== KindVariableDeclarationList) {
    return undefined;
  }
  return ast.as.AsVariableDeclarationList(node)?.Declarations?.Nodes;
}

export function BinaryExpression_Left(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindBinaryExpression
    ? undefined
    : ast.as.AsBinaryExpression(node)?.Left;
}

export function BinaryExpression_Right(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindBinaryExpression
    ? undefined
    : ast.as.AsBinaryExpression(node)?.Right;
}

export function BinaryExpression_OperatorToken(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindBinaryExpression
    ? undefined
    : ast.as.AsBinaryExpression(node)?.OperatorToken;
}

export function PrefixUnaryExpression_Operand(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindPrefixUnaryExpression
    ? undefined
    : ast.as.AsPrefixUnaryExpression(node)?.Operand;
}

export function IfStatement_ThenStatement(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindIfStatement
    ? undefined
    : ast.as.AsIfStatement(node)?.ThenStatement;
}

export function DoStatement_Statement(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindDoStatement
    ? undefined
    : ast.as.AsDoStatement(node)?.Statement;
}

export function LabeledStatement_Label(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindLabeledStatement
    ? undefined
    : ast.as.AsLabeledStatement(node)?.Label;
}

export function LabeledStatement_Statement(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindLabeledStatement
    ? undefined
    : ast.as.AsLabeledStatement(node)?.Statement;
}

export function SwitchStatement_Expression(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindSwitchStatement
    ? undefined
    : ast.as.AsSwitchStatement(node)?.Expression;
}

export function SwitchStatement_CaseBlock(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindSwitchStatement
    ? undefined
    : ast.as.AsSwitchStatement(node)?.CaseBlock;
}

export function CaseBlock_Clauses(
  ast: AstReader,
  node: Node | undefined,
): readonly (Node | undefined)[] | undefined {
  return node === undefined || ast.kindName(node) !== "KindCaseBlock"
    ? undefined
    : ast.as.AsCaseBlock(node)?.Clauses?.Nodes;
}

export function CaseOrDefaultClause_Expression(
  ast: AstReader,
  node: Node | undefined,
): Node | undefined {
  const kind = node === undefined ? undefined : ast.kindName(node);
  return kind !== KindCaseClause && kind !== KindDefaultClause
    ? undefined
    : ast.as.AsCaseOrDefaultClause(node)?.Expression;
}

export function CaseOrDefaultClause_Statements(
  ast: AstReader,
  node: Node | undefined,
): readonly (Node | undefined)[] | undefined {
  const kind = node === undefined ? undefined : ast.kindName(node);
  return kind !== KindCaseClause && kind !== KindDefaultClause
    ? undefined
    : ast.as.AsCaseOrDefaultClause(node)?.Statements?.Nodes;
}

export function IfStatement_ElseStatement(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindIfStatement
    ? undefined
    : ast.as.AsIfStatement(node)?.ElseStatement;
}

export function ForStatement_Initializer(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindForStatement
    ? undefined
    : ast.as.AsForStatement(node)?.Initializer;
}

export function ForStatement_Condition(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindForStatement
    ? undefined
    : ast.as.AsForStatement(node)?.Condition;
}

export function ForStatement_Incrementor(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindForStatement
    ? undefined
    : ast.as.AsForStatement(node)?.Incrementor;
}

export function ElementAccessExpression_ArgumentExpression(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindElementAccessExpression
    ? undefined
    : ast.as.AsElementAccessExpression(node)?.ArgumentExpression;
}

export function ArrayTypeNode_ElementType(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindArrayType
    ? undefined
    : ast.as.AsArrayTypeNode(node)?.ElementType;
}

function isForInOrOf(ast: AstReader, node: Node | undefined): node is Node {
  const kind = node === undefined ? undefined : ast.kindName(node);
  return kind === KindForOfStatement || kind === KindForInStatement;
}

export function ForInOrOfStatement_Initializer(ast: AstReader, node: Node | undefined): Node | undefined {
  return isForInOrOf(ast, node) ? ast.as.AsForInOrOfStatement(node)?.Initializer : undefined;
}

export function ForInOrOfStatement_Statement(ast: AstReader, node: Node | undefined): Node | undefined {
  return isForInOrOf(ast, node) ? ast.as.AsForInOrOfStatement(node)?.Statement : undefined;
}

export function IterationStatement_Statement(ast: AstReader, node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  switch (ast.kindName(node)) {
    case KindForStatement:
      return ast.as.AsForStatement(node)?.Statement;
    case KindWhileStatement:
      return ast.as.AsWhileStatement(node)?.Statement;
    case "KindDoStatement":
      return ast.as.AsDoStatement(node)?.Statement;
    case KindForOfStatement:
    case KindForInStatement:
      return ast.as.AsForInOrOfStatement(node)?.Statement;
    default:
      return undefined;
  }
}

export function TypeReferenceNode_TypeName(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== KindTypeReference
    ? undefined
    : ast.as.AsTypeReferenceNode(node)?.TypeName;
}

export function Node_Operand(ast: AstReader, node: Node | undefined): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  const kind = ast.kindName(node);
  return kind === KindPrefixUnaryExpression
    ? ast.as.AsPrefixUnaryExpression(node)?.Operand
    : kind === KindPostfixUnaryExpression
      ? ast.as.AsPostfixUnaryExpression(node)?.Operand
      : undefined;
}

export function TryStatement_TryBlock(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== "KindTryStatement"
    ? undefined
    : ast.as.AsTryStatement(node)?.TryBlock;
}

export function TryStatement_CatchClause(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== "KindTryStatement"
    ? undefined
    : ast.as.AsTryStatement(node)?.CatchClause;
}

export function TryStatement_FinallyBlock(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== "KindTryStatement"
    ? undefined
    : ast.as.AsTryStatement(node)?.FinallyBlock;
}

export function CatchClause_VariableDeclaration(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== "KindCatchClause"
    ? undefined
    : ast.as.AsCatchClause(node)?.VariableDeclaration;
}

export function CatchClause_Block(ast: AstReader, node: Node | undefined): Node | undefined {
  return node === undefined || ast.kindName(node) !== "KindCatchClause"
    ? undefined
    : ast.as.AsCatchClause(node)?.Block;
}

export function BreakOrContinueStatement_Label(
  ast: AstReader,
  node: Node | undefined,
): Node | undefined {
  if (node === undefined) {
    return undefined;
  }
  const kind = ast.kindName(node);
  return kind === KindBreakStatement
    ? ast.as.AsBreakStatement(node)?.Label
    : kind === KindContinueStatement
      ? ast.as.AsContinueStatement(node)?.Label
      : undefined;
}
