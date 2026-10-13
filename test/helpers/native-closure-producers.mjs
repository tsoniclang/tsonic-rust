import assert from "node:assert/strict";
import { analyzeRust } from "./rust-session.mjs";

import { createRustErrorRegionCatalog } from "../../dist/backend/planner/program/error-regions.js";
import { rustPackageFallibleBoundary } from "../../dist/backend/planner/program/fallible-boundaries.js";
import { rustRuntimeErrorTypeIdentity } from "../../dist/target-model/operations/error-boundary.js";
import { createRustSyntheticNameState } from "../../dist/backend/planner/names/synthetic.js";
import { planRustCallableExpressionBody } from "../../dist/backend/planner/expressions/callable.js";
import { printRustExpr } from "../../dist/print/source/expressions/core.js";

export function nativeClosureProducerFixture({ asynchronous = false, surfaces = [], source,
  selectRecords = records => records, selectProducers = value => value,
  body = () => ({ kind: "int-literal", text: "3" }),
} = {}) {
  const output = asynchronous ? "Promise<int32>" : "int32";
  const analyzed = analyzeRust({ surfaces, files: { "index.ts": source ?? `
import type { int32 } from "@tsonic/core/types.js";
export function create(): () => ${output} {
  return ${asynchronous ? "async " : ""}(): ${output} => { return 3; };
}
` } });
  const original = analyzed.program;
  const { ast } = original.source;
  const closures = [];
  const visit = node => {
    if (original.records.targetOperation.get(node)?.kind === "closure") closures.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  original.sourceFiles.forEach(visit);
  assert.equal(closures.length, 1, "one checked closure producer");
  const node = closures[0];
  const records = selectRecords(original.records, node);
  const program = { ...original, records, callableValues: { ...original.callableValues,
    nativeProducers: selectProducers(original.callableValues.nativeProducers),
  } };
  const fileNames = program.sourceFiles.map(file => ast.getFileName(file));
  const bodyContexts = [];
  const context = {
    input: { program, errorRegions: createRustErrorRegionCatalog(program) },
    sourceFile: ast.getSourceFile(node), sourcePackageComponentId: "root", moduleName: "index",
    moduleNameByFileName: new Map(fileNames.map(file => [file, "index"])),
    externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map(),
    programModuleName: "program", structuralShapesModuleName: "shapes",
    publicImplementationItemIdentities: new Set(), publishesImplementationAbi: false,
    usedAliases: new Set(), diagnostics: [], syntheticNames: createRustSyntheticNameState(ast, node, []),
    sourcePackageErrors: {
      componentIdByFileName: new Map(fileNames.map(file => [file, "root"])),
      componentIdByDefinition: new Map(), dependencyErrorsByComponentId: new Map(),
      domainsByComponentId: new Map([["root", { componentId: "root", errorDomain: "runtime",
        errorTypeIdentity: rustRuntimeErrorTypeIdentity, errorOwnerComponentId: undefined,
        definitions: [], externalErrors: [],
      }]]),
    },
    fallibleBoundary: rustPackageFallibleBoundary({ componentId: "unrelated-consumer", errorDomain: "program",
      errorTypeIdentity: "unrelated:ConsumerFailure", errorTypePath: "ConsumerFailure",
    }),
    planBlock: (_block, bodyContext) => {
      bodyContexts.push(bodyContext);
      return { statements: [{ kind: "tail", expr: body(bodyContext) }] };
    },
  };
  return { node, program, original, context, bodyContexts,
    plan: () => planRustCallableExpressionBody(node, context),
  };
}

export function nativeClosureProducerErrorRecords(errorType) {
  return (records, producer) => ({ ...records, errorEffects: {
    get: node => node === producer
      ? { localErrors: false, nativeErrors: [{ identity: "fixture:failure", errorType }] }
      : records.errorEffects.get(node),
  } });
}

export function printNativeClosureProducer(fixture) {
  const expression = fixture.plan();
  assert.equal(expression !== undefined, true,
    fixture.context.diagnostics.map(diagnostic => diagnostic.message).join("\n") || "closure producer exists");
  assert.equal(fixture.context.diagnostics.length, 0, "closure diagnostics");
  return printRustExpr(expression);
}
