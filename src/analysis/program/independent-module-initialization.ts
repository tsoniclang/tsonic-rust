import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  Node_Expression,
  Node_Initializer,
  Node_Operand,
  sourceClassFieldIsTypeOnly,
  sourceParameterIsProperty,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "./context.js";
import { rustMemoryMetadataKey } from "../../target-model/operations/memory-layout.js";

type Input = Pick<RustAnalysisContext, "ast" | "source" | "facts">;

export function rustModuleInitializationIsStateIndependent(
  input: Input,
  sourceFile: SourceFile,
  component: ReadonlySet<SourceFile>,
): boolean {
  const { ast } = input;
  const activeConstructors = new Set<Node>();
  const none = new Set<Node>();
  const selectedClass = (expression: Node): Node | undefined => {
    const semantics = input.source.semantics.forNode(expression);
    const type = semantics.types.expressionType(expression);
    const symbol = type === undefined ? undefined : semantics.declarations.typeSymbol(type);
    const declaration = symbol === undefined ? undefined : semantics.declarations.primarySymbolDeclaration(symbol);
    return declaration !== undefined && ast.is.IsClassDeclaration(declaration) ? declaration : undefined;
  };
  const expressionIsIndependent = (expression: Node, parameters: ReadonlySet<Node>, point: Node): boolean => {
    if (input.facts.getFact(expression, rustMemoryMetadataKey)) return true;
    switch (ast.kindName(expression)) {
      case "KindNumericLiteral":
      case "KindBigIntLiteral":
      case "KindStringLiteral":
      case "KindNoSubstitutionTemplateLiteral":
      case "KindTrueKeyword":
      case "KindFalseKeyword":
      case "KindNullKeyword":
        return true;
      case "KindIdentifier": {
        const declaration = input.source.navigation.sourceReferenceFor(expression)?.declaration;
        return declaration !== undefined && parameters.has(declaration);
      }
      case "KindParenthesizedExpression":
      case "KindAsExpression":
      case "KindTypeAssertionExpression":
      case "KindSatisfiesExpression":
      case "KindVoidExpression": {
        const operand = Node_Expression(ast, expression);
        return operand !== undefined && expressionIsIndependent(operand, parameters, point);
      }
      case "KindPrefixUnaryExpression": {
        const operand = Node_Operand(ast, expression);
        const operator = ast.operatorKindName(expression);
        return operand !== undefined && (operator === "KindPlusToken" || operator === "KindMinusToken" ||
          operator === "KindExclamationToken" || operator === "KindTildeToken") &&
          ["KindNumericLiteral", "KindBigIntLiteral", "KindStringLiteral", "KindNoSubstitutionTemplateLiteral",
            "KindTrueKeyword", "KindFalseKeyword", "KindNullKeyword"].includes(ast.kindName(operand));
      }
      case "KindArrayLiteralExpression":
        return ast.elements(expression).every(element => element !== undefined && expressionIsIndependent(element, parameters, point));
      case "KindObjectLiteralExpression":
        return ast.properties(expression).every(property => {
          if (property === undefined || ast.kindName(property) !== "KindPropertyAssignment") return false;
          const name = ast.name(property);
          const value = Node_Initializer(ast, property);
          return name !== undefined && ast.kindName(name) !== "KindComputedPropertyName" && value !== undefined &&
            expressionIsIndependent(value, parameters, point);
        });
      case "KindNewExpression": {
        const declaration = selectedClass(expression);
        return declaration !== undefined && ast.getSourceFile(declaration) === sourceFile &&
          ast.pos(declaration) < ast.pos(point) &&
          ast.arguments(expression).every(argument => argument !== undefined && expressionIsIndependent(argument, parameters, point)) &&
          constructorIsIndependent(declaration, point);
      }
      default:
        return false;
    }
  };
  const constructorIsIndependent = (declaration: Node, point: Node): boolean => {
    if (activeConstructors.has(declaration) || ast.extendsHeritageElements(declaration).length !== 0) return false;
    activeConstructors.add(declaration);
    try {
      const members = ast.members(declaration);
      const constructors = members.filter(member => member !== undefined && ast.is.IsConstructorDeclaration(member));
      if (constructors.length > 1 || members.some(member => member === undefined)) return false;
      const constructor = constructors[0];
      const parameters = constructor === undefined ? [] : ast.parameters(constructor);
      if (parameters.some(parameter => parameter === undefined || Node_Initializer(ast, parameter) !== undefined)) return false;
      const parameterSet = new Set(parameters.filter((parameter): parameter is Node => parameter !== undefined));
      const fields = new Set(members.filter((member): member is Node => member !== undefined &&
        ast.kindName(member) === "KindPropertyDeclaration" && !ast.hasModifierKind(member, "static") &&
        !sourceClassFieldIsTypeOnly(ast, member)));
      for (const parameter of parameterSet) if (sourceParameterIsProperty(ast, parameter)) fields.add(parameter);
      for (const field of fields) {
        const value = Node_Initializer(ast, field);
        if (value !== undefined && !expressionIsIndependent(value, parameterSet, point)) return false;
      }
      if (constructor === undefined) return true;
      const body = ast.body(constructor);
      return body !== undefined && ast.statements(body).every(statement => {
        if (statement === undefined || ast.kindName(statement) !== "KindExpressionStatement") return false;
        const expression = Node_Expression(ast, statement);
        if (expression === undefined || ast.kindName(expression) !== "KindBinaryExpression") return false;
        const operator = BinaryExpression_OperatorToken(ast, expression);
        const target = BinaryExpression_Left(ast, expression);
        const value = BinaryExpression_Right(ast, expression);
        if (operator === undefined || ast.kindName(operator) !== "KindEqualsToken" || target === undefined ||
          ast.kindName(target) !== "KindPropertyAccessExpression" || value === undefined) return false;
        const receiver = Node_Expression(ast, target);
        const selected = input.source.semantics.forNode(target).operations.propertyAccess(target)?.selectedDeclaration;
        return receiver !== undefined && ast.kindName(receiver) === "KindThisKeyword" &&
          selected !== undefined && fields.has(selected) && expressionIsIndependent(value, parameterSet, point);
      });
    } finally {
      activeConstructors.delete(declaration);
    }
  };
  for (const statement of ast.statements(sourceFile)) {
    if (statement === undefined) return false;
    if (input.facts.getFact(statement, rustMemoryMetadataKey)) continue;
    switch (ast.kindName(statement)) {
      case "KindImportDeclaration":
      case "KindExportDeclaration":
      case "KindFunctionDeclaration":
      case "KindInterfaceDeclaration":
      case "KindTypeAliasDeclaration":
      case "KindEmptyStatement":
      case "KindEndOfFile":
        break;
      case "KindVariableStatement": {
        const declarations = VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement));
        if (declarations === undefined || declarations.some(declaration => {
          if (declaration === undefined) return true;
          if (input.facts.getFact(declaration, rustMemoryMetadataKey)) return false;
          const value = Node_Initializer(ast, declaration);
          return value !== undefined && !expressionIsIndependent(value, none, declaration);
        })) return false;
        break;
      }
      case "KindClassDeclaration": {
        const heritage = input.source.navigation.declaredHeritage(statement);
        if (heritage.kind === "unresolved") return false;
        for (const edge of heritage.edges) {
          if (edge.kind !== "extends") continue;
          const base = edge.target.declaration;
          const baseFile = ast.getSourceFile(base);
          if (baseFile === undefined || component.has(baseFile) &&
            (baseFile !== sourceFile || ast.pos(base) >= ast.pos(statement))) return false;
        }
        for (const member of ast.members(statement)) {
          if (member === undefined || ast.kindName(member) === "KindClassStaticBlockDeclaration") return false;
          const name = ast.name(member);
          if (name !== undefined && ast.kindName(name) === "KindComputedPropertyName" && !sourceClassFieldIsTypeOnly(ast, member)) return false;
          if (!ast.hasModifierKind(member, "static") || sourceClassFieldIsTypeOnly(ast, member)) continue;
          const value = Node_Initializer(ast, member);
          if (value !== undefined && !expressionIsIndependent(value, none, member)) return false;
        }
        break;
      }
      default:
        return false;
    }
  }
  return true;
}
