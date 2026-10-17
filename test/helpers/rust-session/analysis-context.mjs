import assert from "node:assert/strict";
import { createRustAnalysisContext } from "../../../dist/analysis/program/context.js";
import { analyzeRustProgram } from "../../../dist/analysis/program/analyze.js";
import { analyzeRustRuntimeReferences, analyzeRustDispatchContextCatalog } from "../../../dist/analysis/project/index.js";
import { analyzeRustSourceOutputIdentities } from "../../../dist/analysis/names/source-output-identities.js";

export function analyzeRustCheckedContext(request, configureContext) {
  const references = analyzeRustRuntimeReferences(request.input.runtimeReferences, request.configuration.foundation);
  assert.equal(references.kind, "resolved");
  const dispatch = analyzeRustDispatchContextCatalog(request.providerSemantics.dispatchContexts, references.plan.activeCrates);
  assert.equal(dispatch.kind, "resolved");
  const created = createRustAnalysisContext(request.input, request.providerSemantics, request.jsEnabled,
    request.rootPublishesLibrary, dispatch.plan);
  assert.equal(created.kind, "resolved", "the actual checked native context is admitted before body analysis");
  let context = created.value;
  if (configureContext !== undefined) context = configureContext(context);
  const identities = analyzeRustSourceOutputIdentities({ ast: context.ast, sourceFiles: context.sourceFiles,
    sourcePackages: context.sourcePackages, paths: request.input.paths });
  assert.equal(identities.kind, "accepted", "the actual checked source output identities are selected before body analysis");
  analyzeRustProgram(context, request.configuration.outputType, identities.identities);
  return Object.freeze({ ...context, sourceOutputIdentities: identities.identities });
}
