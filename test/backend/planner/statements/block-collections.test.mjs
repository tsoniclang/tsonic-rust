import assert from "node:assert/strict";
import test from "node:test";
import { planBlockLike } from "../../../../dist/backend/planner/statements/core.js";

function context(children) {
  const sourceFile = {};
  const ast = {
    kindName: node => node.kind,
    statements: () => children,
    getFileName: () => "/src/index.ts",
    getSourceText: () => "{}",
    pos: () => 0,
    end: () => 2,
  };
  return { sourceFile, diagnostics: [], input: { program: {
    source: { ast },
    callableValues: { frames: { definitions: [] } },
    captureStorage: { deferredForScope: () => [] },
    lexicalFunctions: { valueDeclarationsAt: () => [] },
    borrowedElementReads: { forStatement: () => undefined, endingAt: () => [] },
    facts: { getFact: () => undefined },
  } } };
}

test("canonical block planning retains empty native bodies and rejects every missing statement slot", () => {
  const block = { kind: "KindBlock" };
  const emptyStatement = { kind: "KindEmptyStatement" };
  for (const children of [[], [emptyStatement]]) {
    const input = context(children);
    assert.deepEqual(planBlockLike(block, input), { statements: [] });
    assert.equal(input.diagnostics.length, 0);
  }
  for (const children of [[undefined], Array(1), [emptyStatement, undefined, emptyStatement], [undefined, undefined]]) {
    const input = context(children);
    assert.equal(planBlockLike(block, input) === undefined, true);
    const count = children.length === 2 ? 2 : 1;
    assert.equal(input.diagnostics.length, count);
    assert.equal(input.diagnostics.every(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT" &&
      diagnostic.message.includes("Source block contains an undefined statement slot")), true);
  }
});
