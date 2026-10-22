import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

test("project callable return and native error types are closed before publication", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    export class Counter { value: int32 = 0; add(delta: int32): int32 { this.value += delta; return this.value; } }
  ` } });
  const nodes = [];
  const visit = node => { nodes.push(node); source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  for (const { sourceFile } of program.records.sourceArtifacts.get()) visit(sourceFile);
  const signatures = nodes.flatMap(node => {
    const selected = program.records.projectCallableSignature.get(node);
    return selected === undefined ? [] : [selected];
  });
  assert.equal(signatures.length > 0, true, "the native dispatch contract has an admitted callable signature");
  let errors = 0;
  for (const signature of signatures) {
    assert.equal(program.records.typeEmission.get(signature.returnCarrier) !== undefined, true, "the exact return carrier is renderable");
    if (signature.errorCarrier === undefined) continue;
    errors++;
    const selected = program.records.typeEmission.get(signature.errorCarrier);
    assert.equal(selected !== undefined && selected.positions.general, true, "the selected native error carrier has sealed position evidence");
    assert.equal(Object.isFrozen(selected), true, "type evidence is immutable before planning");
  }
  assert.equal(errors > 0, true, "the regression covers a physical native error carrier");
});
