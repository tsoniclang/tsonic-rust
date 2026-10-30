// Canonical TargetCompileInput fixture for planner-only tests. It supplies a
// closed empty semantic program rather than preserving the retired flat input.

import { createSourceProgramNavigation } from "@tsonic/target-api/source";

export function fakeSourceFile({ fileName = "src/index.ts", text = "", statements = [] } = {}) {
  return { fileName, text, statements };
}

export function fakeStatement({ pos = 0, end = 0, kindName = "ExpressionStatement" } = {}) {
  return { pos, end, kindName };
}

export function fakeAstReader(sourceFiles = []) {
  const sourceFileByNode = new Map();
  const parentByNode = new Map();
  for (const sourceFile of sourceFiles) {
    sourceFileByNode.set(sourceFile, sourceFile);
    for (const statement of sourceFile.statements ?? []) {
      sourceFileByNode.set(statement, sourceFile);
      parentByNode.set(statement, sourceFile);
    }
  }
  // A fake node is only of the kinds listed below; every other kind predicate is false.
  const kinds = {
      IsArrowFunction: (node) => node.kindName === "KindArrowFunction",
      IsFunctionExpression: (node) => node.kindName === "KindFunctionExpression",
      IsFunctionDeclaration: () => false,
      IsParameterDeclaration: () => false,
      IsMethodDeclaration: () => false,
      IsAsExpression: () => false,
      IsSatisfiesExpression: () => false,
      IsNonNullExpression: () => false,
      IsTypeAssertion: () => false,
      IsExpressionStatement: () => false,
      IsBinaryExpression: () => false,
      IsPrefixUnaryExpression: () => false,
      IsPostfixUnaryExpression: () => false,
      IsConditionalExpression: () => false,
      IsForStatement: () => false,
      IsForOfStatement: () => false,
      IsForInStatement: () => false,
      IsWhileStatement: () => false,
      IsDoStatement: () => false,
      IsAwaitExpression: () => false,
      IsDeleteExpression: () => false,
      IsYieldExpression: () => false,
      IsExportAssignment: () => false,
      IsIfStatement: () => false,
      IsVoidExpression: () => false,
      IsTypeOfExpression: (node) => node.kindName === "KindTypeOfExpression",
      IsArrayBindingPattern: () => false,
      IsArrayLiteralExpression: () => false,
      IsArrayTypeNode: () => false,
      IsBindingElement: () => false,
      IsCatchClause: () => false,
      IsConstructorDeclaration: () => false,
      IsElementAccessExpression: () => false,
      IsGetAccessorDeclaration: () => false,
      IsMethodSignatureDeclaration: () => false,
      IsObjectBindingPattern: () => false,
      IsOmittedExpression: () => false,
      IsPropertyAssignment: () => false,
      IsPropertyDeclaration: () => false,
      IsReturnStatement: () => false,
      IsSetAccessorDeclaration: () => false,
      IsShorthandPropertyAssignment: () => false,
      IsSourceFile: (node) => sourceFiles.includes(node),
      IsSpreadAssignment: (node) => node.kindName === "KindSpreadAssignment",
      IsSpreadElement: () => false,
      IsThrowStatement: () => false,
      IsTryStatement: () => false,
      IsTupleTypeNode: () => false,
      IsBlock: () => false,
      IsCallExpression: () => false,
      IsClassDeclaration: () => false,
      IsClassExpression: () => false,
      IsClassStaticBlockDeclaration: () => false,
      IsExpressionWithTypeArguments: () => false,
      IsComputedPropertyName: () => false,
      IsIdentifier: () => false,
      IsNewExpression: () => false,
      IsObjectLiteralExpression: () => false,
      IsParenthesizedExpression: () => false,
      IsPropertyAccessExpression: () => false,
      IsVariableDeclaration: () => false,
      IsVariableStatement: () => false,
      IsInterfaceDeclaration: () => false,
      IsTypeAliasDeclaration: () => false,
      IsTypeLiteralNode: () => false,
      IsTypeQueryNode: () => false,
      IsKeywordTypeNode: () => false,
      IsTypeReferenceNode: () => false,
      IsUnionTypeNode: () => false,
      IsIntersectionTypeNode: () => false,
      IsConditionalTypeNode: () => false,
      IsInferTypeNode: () => false,
      IsIndexedAccessTypeNode: () => false,
      IsLiteralTypeNode: () => false,
      IsThisTypeNode: () => false,
      IsMappedTypeNode: () => false,
      IsOptionalTypeNode: () => false,
      IsRestTypeNode: () => false,
      IsParenthesizedTypeNode: () => false,
      IsFunctionTypeNode: () => false,
      IsConstructorTypeNode: () => false,
      IsTemplateLiteralTypeNode: () => false,
      IsImportTypeNode: () => false,
      IsStringLiteral: () => false,
      IsNoSubstitutionTemplateLiteral: () => false,
      IsNumericLiteral: () => false,
      IsBigIntLiteral: () => false,
  };
  return {
    is: new Proxy(kinds, { get: (target, name) => target[name] ?? (() => false) }),
    statements: (sourceFile) => sourceFile.statements ?? [],
    members: () => [],
    kind: (node) => node.kindName,
    kindName: (node) => node.kindName,
    pos: (node) => node.pos,
    end: (node) => node.end,
    getFileName: (sourceFile) => sourceFile?.fileName ?? "",
    getPath: (sourceFile) => sourceFile?.fileName ?? "",
    getSourceFile: (node) => sourceFileByNode.get(node) ?? node?.sourceFile ?? node,
    parent: (node) => parentByNode.get(node),
    getSourceText: (sourceFile) => sourceFile.text ?? "",
    isDeclarationFile: () => false,
    forEachChild: (node, visit) => {
      for (const statement of node.statements ?? []) visit(statement);
    },
    hasModifierKind: () => false,
    modifiers: () => [],
    name: () => undefined,
    parameters: () => [],
    arguments: () => [],
    body: () => undefined,
    text: (node) => node?.text ?? "",
    children: () => [],
  };
}

export function fakeCompileInput({
  sourceFiles = [],
  ast = fakeAstReader(sourceFiles),
  target = { id: "rust", options: { outputType: "lib" } },
  runtimeReferences = [],
  runtimeActivatedCapabilityIds = [],
} = {}) {
  const inventory = createSourceProgramNavigation({
    ast,
    sourceFiles,
    containsSourceFile: (sourceFile) => sourceFiles.includes(sourceFile),
  });
  const sourceFacts = { getFact: () => undefined };
  const semanticsForFile = (sourceFile) => ({
    sourceFile,
    propertyNames: Object.freeze({ entries: Object.freeze([]), issues: Object.freeze([]), get: () => undefined }),
    getAuthoredTypeFactSubjects: () => [],
    getSelectedFactSubjects: () => [],
    getTypeFactSubjects: () => [],
  });
  const source = {
    ast,
    sourceFiles,
    sourceFacts,
    navigation: {
      sourceFiles,
      nodes: inventory.nodes,
      nodesForFiles: inventory.nodesForFiles,
      sourceReferenceFor: () => undefined,
      referenceFor: () => undefined,
      declarationFor: () => undefined,
      moduleDependencies: () => [],
      moduleReferences: () => [],
      moduleHasTopLevelAwait: () => false,
      moduleExports: () => [],
      memberDispatch: () => undefined,
      memberImplementation: () => ({ kind: "unrelated" }),
      memberContracts: (declaration) => ({
        kind: "resolved",
        implementationDeclaration: declaration,
        contracts: [],
      }),
      callableImplementation: () => ({ kind: "unrelated" }),
      classConstructors: () => ({ kind: "resolved", constructors: [] }),
      declaredHeritage: () => ({ kind: "resolved", edges: [] }),
      declaredHeritagePath: () => ({ kind: "unrelated" }),
      bindingWritesWithin: () => [],
      symbolReferencesWithin: () => [],
      hasReferenceOutside: () => false,
      declarationUses: () => [],
      declarationUseSummary: (declaration) => ({
        declaration,
        uses: [],
        directCallCount: 0,
        firstClassUseCount: 0,
        bindingWritten: false,
        memberWritten: false,
        constructorInitialized: false,
        mutatedAfterInitialization: false,
        receiverUsed: false,
        identityCompared: false,
        conditionallyRead: false,
        aliasedOrStored: false,
        captured: false,
        exported: false,
        escapeKinds: [],
        hasUnclassifiedValueUse: false,
      }),
      parameterUseSummary: () => undefined,
      expressionResultUse: () => "discarded",
      expressionEffects: () => ({
        invokes: false,
        mutates: false,
        suspends: false,
        mayThrow: false,
      }),
      expressionValueFlow: (expression) => ({
        expression,
        aliasDeclarations: [],
        uses: [],
        bindingAliased: false,
        memberWritten: false,
        receiverUsed: false,
        identityCompared: false,
        captured: false,
        returned: false,
        yielded: false,
        passedAsArgument: false,
        storedOutsideBinding: false,
        exported: false,
        discarded: true,
        hasUnclassifiedUse: false,
        escapes: false,
      }),
      countedLoop: () => undefined,
      isProjectShape: () => false,
      isProjectConstructibleObject: () => false,
      isProjectDeclaration: () => false,
    },
    semantics: {
      includes: (sourceFile) => sourceFiles.includes(sourceFile),
      forFile: semanticsForFile,
      forNode: (node) => semanticsForFile(ast.getSourceFile(node)),
      selectValueTypeRefinement: () => ({ kind: "not-project-reference" }),
      // A program without enum declarations has no enum constants and no enum admission issues.
      enumConstants: Object.freeze({ entries: Object.freeze([]), issues: Object.freeze([]),
        get: () => undefined, integerWidth: () => undefined }),
    },
    documents: {
      all: [],
      includes: () => false,
      forFile: () => { throw new Error("Planner-only fixture has no source document."); },
      forNode: () => { throw new Error("Planner-only fixture has no source document."); },
      occurrenceFor: () => { throw new Error("Planner-only fixture has no source occurrence."); },
      lookupAuthored: () => ({ kind: "missing" }),
    },
  };
  return {
    source,
    sourcePackages: fakeSourcePackageGraph(sourceFiles),
    project: { entryPoint: "src/index.ts", targets: [target] },
    target,
    runtimeReferences,
    runtimeActivatedCapabilityIds,
    paths: {
      projectFilePath: "src/tsonic.json",
      projectRoot: "src",
      outputRoot: "out",
      targetOutputRoot: "out/rust",
      cacheRoot: ".tsonic/cache",
    },
  };
}

export function fakeSourcePackageGraph(
  sourceFiles,
  { packageRoot = ".", sourceRoot = "src", exports = [] } = {},
) {
  const packageId = "fixture:root";
  const componentId = "fixture:component";
  return {
    fingerprint: "fixture-source-package-graph",
    rootPackageId: packageId,
    packages: [{
      id: packageId,
      name: "fixture",
      packageRoot,
      sourceRoot,
      sourceFiles: sourceFiles.map((sourceFile) => sourceFile.fileName),
      dependencies: [],
      exports,
      componentId,
    }],
    components: [{ id: componentId, packages: [packageId], dependencies: [] }],
  };
}
