import type { AstReader, Node } from "@tsonic/tsts";
import {
  KindCallExpression,
  KindEmptyStatement,
  KindExportDeclaration,
  KindFalseKeyword,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindImportDeclaration,
  KindInterfaceDeclaration,
  KindNoSubstitutionTemplateLiteral,
  KindNonNullExpression,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  KindStringLiteral,
  KindTrueKeyword,
  KindVariableDeclaration,
  KindVariableStatement,
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import { cyclicSourceFiles } from "./module-graph.js";
import type { TargetTypeRef } from "../../policy/types/model.js";
import type { RustAnalysisContext } from "./context.js";
import type { RustModuleBindingFact } from "../facts/keys.js";

export interface RustModuleBindingPolicy {
  nativeFunction(declaration: Node): RustNativeModuleFunction | undefined;
  classifyValue(
    declaration: Node,
    declarationKind: "const" | "let" | "var",
    valueCarrier: TargetTypeRef,
  ): Exclude<RustModuleBindingFact, { readonly storage: "native-function" }>;
}

export interface RustNativeModuleFunction {
  readonly callableDeclaration: Node;
  readonly name: string;
}

export function createRustModuleBindingPolicy(
  context: RustAnalysisContext,
): RustModuleBindingPolicy {
  const callableByDeclaration = collectNativeCallableCandidates(context);
  const cyclic = cyclicSourceFiles(context.source.navigation, context.sourceFiles);
  const nativeFunctions = new Map<Node, RustNativeModuleFunction>();
  for (const [declaration, callableDeclaration] of callableByDeclaration) {
    const sourceFile = context.ast.getSourceFile(declaration);
    const name = context.names.functionNameForDeclaration(declaration);
    if (sourceFile !== undefined && name !== undefined && !cyclic.has(sourceFile) &&
      context.source.navigation.referencesToDeclaration(declaration)
        .every((reference) => referenceAllowsNativeFunction(reference, context.ast))) {
      nativeFunctions.set(declaration, Object.freeze({ callableDeclaration, name }));
    }
  }
  return Object.freeze({
    nativeFunction(declaration: Node) {
      return nativeFunctions.get(declaration);
    },
    classifyValue(
      declaration: Node,
      declarationKind: "const" | "let" | "var",
      valueCarrier: TargetTypeRef,
    ): Exclude<RustModuleBindingFact, { readonly storage: "native-function" }> {
      const initializer = Node_Initializer(context.ast, declaration);
      const initializerKind = initializer === undefined
        ? undefined
        : context.ast.kindName(initializer);
      const nativeConst = declarationKind === "const" && (
        initializerKind === KindNumericLiteral ||
        initializerKind === KindTrueKeyword ||
        initializerKind === KindFalseKeyword
      );
      if (nativeConst) {
        return {
          declarationKind: "const",
          storage: "native-const",
          valueCarrier,
        };
      }
      return {
        declarationKind,
        storage: "module-cell",
        valueCarrier,
      };
    },
  });
}

function collectNativeCallableCandidates(
  context: RustAnalysisContext,
): ReadonlyMap<Node, Node> {
  const candidates = new Map<Node, Node>();
  for (const sourceFile of context.sourceFiles) {
    let safePrefix = true;
    for (const statement of context.ast.statements(sourceFile)) {
      if (statement === undefined || !safePrefix) {
        continue;
      }
      const kind = context.ast.kindName(statement);
      if (kind !== KindVariableStatement) {
        safePrefix = sourcePrefixStatementIsEvaluationFree(kind);
        continue;
      }
      const declarations = VariableDeclarationList_Declarations(
        context.ast,
        VariableStatement_DeclarationList(context.ast, statement),
      );
      if (declarations === undefined || declarations.length === 0 ||
        declarations.some((declaration) =>
          declaration === undefined ||
          context.ast.kindName(declaration) !== KindVariableDeclaration ||
          context.ast.variableDeclarationKind(declaration) !== "const" ||
          !sourcePrefixInitializerIsEvaluationFree(declaration, context))) {
        safePrefix = false;
        continue;
      }
      for (const declaration of declarations) {
        const callable = declaration === undefined
          ? undefined
          : exactNativeCallableInitializer(declaration, context);
        if (declaration !== undefined && callable !== undefined) {
          candidates.set(declaration, callable);
        }
      }
    }
  }
  return candidates;
}

function sourcePrefixStatementIsEvaluationFree(kind: string): boolean {
  return kind === KindImportDeclaration ||
    kind === KindExportDeclaration ||
    kind === KindFunctionDeclaration ||
    kind === KindInterfaceDeclaration ||
    kind === "KindTypeAliasDeclaration" ||
    kind === KindEmptyStatement ||
    kind === "KindEndOfFile";
}

function sourcePrefixInitializerIsEvaluationFree(
  declaration: Node,
  context: RustAnalysisContext,
): boolean {
  if (exactNativeCallableInitializer(declaration, context) !== undefined) {
    return true;
  }
  const initializer = transparentExpression(
    Node_Initializer(context.ast, declaration),
    context.ast,
  );
  const kind = initializer === undefined ? undefined : context.ast.kindName(initializer);
  return kind === KindNumericLiteral ||
    kind === KindStringLiteral ||
    kind === KindNoSubstitutionTemplateLiteral ||
    kind === KindTrueKeyword ||
    kind === KindFalseKeyword ||
    kind === "KindNullKeyword";
}

function exactNativeCallableInitializer(
  declaration: Node,
  context: RustAnalysisContext,
): Node | undefined {
  const initializer = transparentExpression(
    Node_Initializer(context.ast, declaration),
    context.ast,
  );
  const kind = initializer === undefined ? undefined : context.ast.kindName(initializer);
  if (initializer === undefined ||
    (kind !== "KindArrowFunction" && kind !== KindFunctionExpression) ||
    context.ast.hasModifierKind(initializer, "async") ||
    context.semanticsFor(initializer).getResolvedGeneratorInfo(initializer) !== undefined ||
    context.ast.body(initializer) === undefined ||
    kind === KindFunctionExpression && context.ast.name(initializer) !== undefined) {
    return undefined;
  }
  return initializer;
}

function transparentExpression(
  expression: Node | undefined,
  ast: AstReader,
): Node | undefined {
  let current = expression;
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
      kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
      kind !== "KindTypeAssertionExpression") {
      return current;
    }
    current = Node_Expression(ast, current);
  }
  return undefined;
}

function referenceAllowsNativeFunction(reference: Node, ast: AstReader): boolean {
  const parent = ast.parent(reference);
  if (parent !== undefined && sourceLinkageKind(ast.kindName(parent))) {
    return true;
  }
  let callee = reference;
  let owner = ast.parent(callee);
  while (owner !== undefined && transparentCallTarget(owner, callee, ast)) {
    callee = owner;
    owner = ast.parent(callee);
  }
  return owner !== undefined && ast.kindName(owner) === KindCallExpression &&
    Node_Expression(ast, owner) === callee;
}

function sourceLinkageKind(kind: string): boolean {
  return kind === "KindImportSpecifier" ||
    kind === "KindImportClause" ||
    kind === "KindNamespaceImport" ||
    kind === "KindNamedImports" ||
    kind === KindImportDeclaration ||
    kind === "KindExportSpecifier" ||
    kind === "KindNamedExports" ||
    kind === "KindNamespaceExport" ||
    kind === KindExportDeclaration;
}

function transparentCallTarget(owner: Node, expression: Node, ast: AstReader): boolean {
  const kind = ast.kindName(owner);
  return (kind === KindParenthesizedExpression || kind === KindNonNullExpression ||
      kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
      kind === "KindTypeAssertionExpression") &&
    Node_Expression(ast, owner) === expression;
}
