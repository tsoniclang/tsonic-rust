import assert from "node:assert/strict";
import { createRustAnalysisContext } from "../../../dist/analysis/program/context.js";
import { analyzeRustProgram } from "../../../dist/analysis/program/analyze.js";
import { analyzeRustRuntimeReferences, analyzeRustDispatchContextCatalog } from "../../../dist/analysis/project/index.js";

export function analyzeRustCheckedContext(request, configureContext) {
  const references = analyzeRustRuntimeReferences(request.input.runtimeReferences, request.configuration.foundation);
  assert.equal(references.kind, "resolved");
  const dispatch = analyzeRustDispatchContextCatalog(request.providerSemantics.dispatchContexts, references.plan.activeCrates);
  assert.equal(dispatch.kind, "resolved");
  let context = createRustAnalysisContext(request.input, request.providerSemantics, request.jsEnabled,
    request.rootPublishesLibrary, dispatch.plan);
  if (configureContext !== undefined) context = configureContext(context);
  analyzeRustProgram(context);
  return context;
}
