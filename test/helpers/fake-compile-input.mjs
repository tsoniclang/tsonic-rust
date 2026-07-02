// Fake TargetCompileInput pieces for backend tests. Only the members the R1
// planner actually reads are provided; anything else throwing keeps the tests
// honest about what the backend consumes.

export function fakeSourceFile({ fileName = "src/index.ts", text = "", statements = [] } = {}) {
  return { fileName, text, statements };
}

export function fakeStatement({ pos = 0, end = 0, kindName = "ExpressionStatement" } = {}) {
  return { pos, end, kindName };
}

export function fakeAstReader() {
  return {
    statements: (sourceFile) => sourceFile.statements ?? [],
    kindName: (node) => node.kindName,
    pos: (node) => node.pos,
    end: (node) => node.end,
    getFileName: (sourceFile) => sourceFile.fileName,
    getSourceFile: (node) => node.sourceFile ?? node,
    getSourceText: (sourceFile) => sourceFile.text ?? "",
    forEachChild: () => {},
    hasModifierKind: () => false,
    name: () => undefined,
    parameters: () => [],
    arguments: () => [],
    body: () => undefined,
    text: (node) => node.text ?? "",
  };
}

export function fakeCompileInput({
  sourceFiles = [],
  target = { id: "rust", options: {} },
  runtimeReferences = [],
} = {}) {
  return {
    program: {},
    ast: fakeAstReader(),
    types: {},
    sourceFiles,
    facts: {
      getFact: () => undefined,
      getRuntimeCarrierFact: () => undefined,
      getSelectedTargetCall: () => undefined,
    },
    analysis: {
      getSymbolName: () => undefined,
      getProjectSourceReferenceForNode: () => undefined,
    },
    targetFacts: {},
    project: { entryPoint: "src/index.ts", targets: [target] },
    target,
    runtimeReferences,
    paths: {
      projectFilePath: "tsonic.json",
      projectRoot: ".",
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
