import { createRustTargetPack } from "../../dist/index.js";

// Canonical TargetCompileInput fixture for planner-only tests. It supplies a
// closed empty semantic program rather than preserving the retired flat input.

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
  return {
    statements: (sourceFile) => sourceFile.statements ?? [],
    kindName: (node) => node.kindName,
    pos: (node) => node.pos,
    end: (node) => node.end,
    getFileName: (sourceFile) => sourceFile?.fileName ?? "",
    getPath: (sourceFile) => sourceFile?.fileName ?? "",
    getSourceFile: (node) => sourceFileByNode.get(node) ?? node?.sourceFile ?? node,
    parent: (node) => parentByNode.get(node),
    getSourceText: (sourceFile) => sourceFile.text ?? "",
    isDeclarationFile: () => false,
    forEachChild: () => {},
    hasModifierKind: () => false,
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
  target = { id: "rust", options: {} },
  runtimeReferences = [],
} = {}) {
  const ast = fakeAstReader(sourceFiles);
  const sourceFacts = { getFact: () => undefined };
  const semanticsForFile = (sourceFile) => ({
    sourceFile,
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
      sourceReferenceFor: () => undefined,
      referenceFor: () => undefined,
      declarationFor: () => undefined,
      moduleDependencies: () => [],
      moduleReferences: () => [],
      moduleHasTopLevelAwait: () => false,
      memberDispatch: () => undefined,
      classConstructors: () => ({ kind: "resolved", constructors: [] }),
      declaredHeritage: () => ({ kind: "resolved", edges: [] }),
      declaredHeritagePath: () => ({ kind: "unrelated" }),
      bindingWritesWithin: () => [],
      hasReferenceOutside: () => false,
      isProjectShape: () => false,
      isProjectConstructibleObject: () => false,
      isProjectDeclaration: () => false,
    },
    semantics: {
      includes: (sourceFile) => sourceFiles.includes(sourceFile),
      forFile: semanticsForFile,
      forNode: (node) => semanticsForFile(ast.getSourceFile(node)),
      selectValueTypeRefinement: () => ({ kind: "not-project-reference" }),
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
    project: { entryPoint: "src/index.ts", targets: [target] },
    target,
    runtimeReferences,
    paths: {
      projectFilePath: "src/tsonic.json",
      projectRoot: "src",
      outputRoot: "out",
      targetOutputRoot: "out/rust",
    },
  };
}

export function fakeRuntimeContributionContext({ target = { id: "rust", options: {} }, selectedSurfaces = [], selectedPackages = [] } = {}) {
  return {
    project: { entryPoint: "src/index.ts", targets: [target] },
    target,
    selectedPackages,
    selectedSurfaces,
    paths: {
      projectFilePath: "tsonic.json",
      projectRoot: ".",
      outputRoot: "out",
      targetOutputRoot: "out/rust",
    },
  };
}

export function fakeBackendContext({ target = { id: "rust", options: {} } } = {}) {
  return {
    project: { entryPoint: "src/index.ts", targets: [target] },
    projectDirectory: ".",
    target,
    targetPack: createRustTargetPack(),
    selectedCapabilities: [],
    selectedSurfaces: [],
  };
}
