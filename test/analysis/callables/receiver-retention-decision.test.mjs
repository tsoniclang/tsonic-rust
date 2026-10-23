import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { sealRustAnalysisProgram } from "../../../dist/analysis/program/index.js";

for (const surfaces of [[], ["js"]]) {
  for (const [name, body] of [
    ["borrowed receiver", "return () => this.read();"],
    ["nested receiver", "return () => { const read = () => this.read(); return read(); };"],
  ]) {
    test(`${name} capture owns a presealed native read in ${surfaces[0] ?? "native"}`, () => {
      const { program } = analyzeRust({ surfaces, files: { "index.ts": `
export class Counter {
  readonly count = 2;
  read(): number { return this.count; }
  make(): () => number { ${body} }
}
` } });
      const owners = [];
      const visit = node => {
        if ((program.records.closureCapture.get(node)?.receivers.length ?? 0) > 0) owners.push(node);
        program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      for (const sourceFile of program.sourceFiles) visit(sourceFile);
      assert.equal(owners.length > 0, true, "checked whole-receiver captures participate in ownership analysis");
      for (const owner of owners) {
        const captures = program.records.closureCapture.get(owner);
        const ownership = program.ownership.captures.get(owner);
        assert.equal(ownership !== undefined, true, "the analysis owner computes capture reads before publication");
        for (const receiver of captures.receivers) {
          const selected = ownership.filter(candidate =>
            candidate.declaration === receiver.owner && candidate.reference === receiver.reference);
          assert.equal(selected.length, 1, "one exact receiver occurrence has one physical ownership decision");
          assert.equal(selected[0].carrier === receiver.carrier, true, "retention uses the actual captured native carrier");
          assert.equal(selected[0].read.kind, "clone", "a borrowed native receiver retains one owning handle");
          assert.equal(Object.isFrozen(selected[0]), true, "the selected capture operation is immutable");
        }
      }
      const sealed = sealRustAnalysisProgram(program);
      for (const owner of owners) {
        const before = program.ownership.captures.get(owner);
        const after = sealed.records.captureOwnership.get(owner);
        assert.equal(after.length, before.length, "publication preserves the complete capture inventory");
        assert.equal(after.every((selection, index) => selection === before[index]), true,
          "the renderer receives the selected operations without recomputation");
      }
    });
  }
}
