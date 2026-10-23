import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../../dist/analysis/program/target-program.js";
import { rustInfallibleTargetId } from "../../../../dist/target-model/types/carriers/source-types.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

for (const surfaces of [[], ["js"]]) {
  test(`native empty error completion is sealed before rendering in ${surfaces[0] ?? "native"}`, () => {
    let program;
    const { result } = compileRust({ surfaces, files: { "index.ts": `
function identity(value: number): number { return value; }
const callback: (value: number) => number = identity;
export function run(): number { return callback(1); }
` }, compileTarget(request) {
      const analyzed = analyzeRustAnalysisProgram(request);
      if (analyzed.kind === "rejected") return analyzed;
      program = analyzed.value;
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
    } });
    assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const empty = program.records.typeEmission.get({ kind: "target-named", id: rustInfallibleTargetId });
    assert.equal(empty?.completion, "never", "native Infallible has no value and needs no active error boundary");
    const inhabited = program.records.typeEmission.get(rustSourcePrimitiveTargetType("float64"));
    assert.equal(inhabited?.completion, "value", "an inhabited native payload is not treated as an impossible error");
  });
}
