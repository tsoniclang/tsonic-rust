import assert from "node:assert/strict";
import { compileRust } from "./rust-session.mjs";
import { analyzeRustCheckedContext } from "./rust-session-analysis-context.mjs";

export function analyzeRustErrorEffects(text, options = {}, configureContext) {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, ...options, compileTarget(request) {
    context = analyzeRustCheckedContext(request, configureContext);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.deepEqual(result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`), []);
  return context;
}
