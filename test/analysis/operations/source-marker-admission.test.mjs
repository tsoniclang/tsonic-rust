import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/index.js";

const attributeProgram = `
import { attribute } from "@tsonic/core/lang.js";
class Subject {
  value = "";
}
function mark(): void {}
attribute<Subject>().property(value => value.value).target("field").add(() => mark());
`;

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces.length === 0 ? "native" : "js";
  test(`${surface}: the exact unsupported attribute marker is rejected before planning`, () => {
    const stages = { analysis: "not-run", planning: false };
    const { result } = compileRust({
      surfaces,
      files: { "index.ts": attributeProgram },
      compileTarget(request) {
        const analysis = analyzeRustAnalysisProgram(request);
        stages.analysis = analysis.kind;
        if (analysis.kind === "rejected") return analysis;
        stages.planning = true;
        return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
      },
    });
    assert.equal(stages.analysis, "rejected", "the actual target analysis rejects the program");
    assert.equal(stages.planning, false, "the planning branch is never reached");
    assert.equal(result.artifacts.length, 0, "no artifact is published");
    const markers = result.diagnostics.filter(diagnostic =>
      diagnostic.code === "RUST_SOURCE_MARKER_UNSUPPORTED" &&
      diagnostic.message === "Rust does not support selected source marker 'attribute' in this operation lane.");
    assert.equal(markers.length, 1, "one exact marker rejection");
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code.startsWith("TSONIC_INTERNAL_")), false,
      "source admission never becomes an internal invariant failure");
  });

  test(`${surface}: an ordinary function named attribute is not a source marker`, () => {
    const { result } = compileRust({
      surfaces,
      files: { "index.ts": `
function attribute(value: number): number { return value; }
export function read(): number { return attribute(1); }
` },
    });
    assert.equal(result.diagnostics.length, 0, "the ordinary source call is admitted");
    assert.equal(result.artifacts.length > 0, true, "ordinary source publishes its native project");
  });
}
