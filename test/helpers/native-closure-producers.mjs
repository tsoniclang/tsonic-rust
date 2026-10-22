import assert from "node:assert/strict";
import { analyzeRust } from "./rust-session.mjs";
import { createRustProviderPackage } from "../../dist/public/provider.js";

import { rustPackageFallibleBoundary } from "../../dist/backend/planner/program/fallible-boundaries.js";
import { rustSourceFilePlanContext } from "./plan-context.mjs";
import { planRustCallableExpressionBody } from "../../dist/backend/planner/expressions/callable.js";
import { printRustExpr } from "../../dist/print/source/expressions/core.js";

export function nativeClosureProducerFixture({ asynchronous = false, surfaces = [], source, packages = [],
  selectRecords = records => records, selectProducers = value => value,
  selectErrorRegions = regions => regions,
  body = () => ({ kind: "int-literal", text: "3" }),
} = {}) {
  const output = asynchronous ? "Promise<int32>" : "int32";
  const analyzed = analyzeRust({ surfaces, packages, files: { "index.ts": source ?? `
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
  // The planner reads only the sealed records; analysis-side overrides of producer and error-region plans are
  // reflected through the records a test selects.
  const program = { ...original, records, errorRegions: selectErrorRegions(original.errorRegions, node),
    callableValues: { ...original.callableValues,
    nativeProducers: selectProducers(original.callableValues.nativeProducers),
  } };
  const bodyContexts = [];
  const context = rustSourceFilePlanContext(program, node, {
    fallibleBoundary: rustPackageFallibleBoundary({ componentId: "unrelated-consumer", errorDomain: "program",
      errorTypeIdentity: "unrelated:ConsumerFailure", errorTypePath: "ConsumerFailure",
    }),
    planBlock: (_block, bodyContext) => {
      bodyContexts.push(bodyContext);
      return { statements: [{ kind: "tail", expr: body(bodyContext) }] };
    },
  });
  return { node, program, original, context, bodyContexts,
    // planRustCallableExpressionBody returns the expression with an optional shared invocation owner.
    plan: () => planRustCallableExpressionBody(node, context)?.expression,
  };
}

export function nativeClosureProducerFailurePackage(errorType, { path = "fail", parameters = [], result = "int32" } = {}) {
  const resultCarrier = { kind: "source-primitive", name: result };
  return createRustProviderPackage({
    id: "native-closure-producer-proof", version: "1.0.0", displayName: "Native closure producer proof",
    crates: [],
    modules: [{ moduleSpecifier: "test:producer", providerModuleId: "test.producer", exports: [{
      id: "test:producer::fail", name: "fail", kind: "function", signatures: [{
        id: "test:producer::fail()", name: "fail", parameters: parameters.map(parameter => ({
          name: parameter.name, type: { kind: "source-primitive", name: parameter.type },
        })), returnType: resultCarrier,
      }],
    }] }],
    operations: [{ exportId: "test:producer::fail", operationKind: "method",
      target: { form: "call", path }, parameterCarriers: parameters.map(parameter => ({ kind: "source-primitive", name: parameter.type })),
      resultCarrier, isFallible: true,
      errorBoundary: "provider-native", errorCarrier: errorType,
    }],
  });
}

export function planNativeClosureProducer(fixture) {
  const expression = fixture.plan();
  assert.equal(expression !== undefined, true,
    fixture.context.diagnostics.map(diagnostic => diagnostic.message).join("\n") || "closure producer exists");
  assert.equal(fixture.context.diagnostics.length, 0, "closure diagnostics");
  return expression;
}

export function printNativeClosureProducer(fixture) {
  return printRustExpr(planNativeClosureProducer(fixture));
}
