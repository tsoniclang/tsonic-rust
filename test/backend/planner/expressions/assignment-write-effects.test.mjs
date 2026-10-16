import assert from "node:assert/strict";
import test from "node:test";
import { assignmentWriteEffectCases } from "../../../../../tsonic/test/fixtures/assignment-write-effects.mjs";
import { compileRust } from "../../../helpers/rust-session.mjs";

for (const fixture of assignmentWriteEffectCases) {
  test(`${fixture.id}: ${fixture.name}`, { timeout: 180_000 }, () => {
    const { result } = compileRust({ files: { "index.ts": fixture.source } });
    const program = result.program;
    assert.equal(program !== undefined, true, "checked source reaches target analysis");
    const { ast } = program.source;
    const evaluations = [];
    const visit = node => {
      const fact = program.records.computedMember.get(node);
      if (fact !== undefined && fact.accessMode !== "read" && fact.accessMode !== "delete") {
        evaluations.push(fact);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(evaluations.length > 0, true, "real checked computed write is selected");
    assert.equal(evaluations.every(fact => fact.evaluateKey), true, "selected call keys retain evaluation");
    assert.deepEqual(result.diagnostics.map(({ code, message, evidence }) => ({ code, message, evidence })), []);
    assert.equal(result.artifacts.some(artifact => artifact.path.endsWith(".rs")), true,
      "the complete native write and assignment result are emitted");
  });
}
