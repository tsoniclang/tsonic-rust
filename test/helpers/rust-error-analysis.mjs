import assert from "node:assert/strict";
import { compileRust } from "./rust-session.mjs";
import { createRustAnalysisContext } from "../../dist/analysis/program/context.js";
import { analyzeRustProgram } from "../../dist/analysis/program/analyze.js";
import { analyzeRustRuntimeReferences, analyzeRustDispatchContextCatalog } from "../../dist/analysis/project/index.js";

export function analyzeRustErrorEffects(text, options = {}, configureContext) {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, ...options, compileTarget(request) {
    const references = analyzeRustRuntimeReferences(request.input.runtimeReferences, request.configuration.foundation);
    assert.equal(references.kind, "resolved");
    const dispatch = analyzeRustDispatchContextCatalog(request.providerSemantics.dispatchContexts, references.plan.activeCrates);
    assert.equal(dispatch.kind, "resolved");
    context = createRustAnalysisContext(request.input, request.providerSemantics, request.jsEnabled,
      request.rootPublishesLibrary, dispatch.plan);
    if (configureContext !== undefined) context = configureContext(context);
    analyzeRustProgram(context);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.deepEqual(result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`), []);
  return context;
}
