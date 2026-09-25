import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustOptionElementCarrier, isRustStringCarrier } from "../../../dist/target-model/types/index.js";

test("transparent call prerequisites preserve the raw optional carrier until destination selection", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    function accept(value: string | undefined): boolean { return value === undefined; }
    export function inspect(values: string[]): boolean {
      return accept((values[9])) && accept(values[9] satisfies string) &&
        accept(((values[9]) satisfies string));
    }
  ` } });
  let wrappers = 0;
  let indexedReads = 0;
  const visit = node => {
    const wrapped = source.ast.is.IsParenthesizedExpression(node) || source.ast.is.IsSatisfiesExpression(node);
    const indexed = source.ast.is.IsElementAccessExpression(node);
    if (wrapped || indexed) {
      const carrier = program.facts.getRuntimeCarrierFact(node)?.carrier;
      assert.equal(isRustStringCarrier(rustOptionElementCarrier(carrier)), true, source.ast.kindName(node));
      assert.equal(program.facts.getFact(node, rustFlowReadProjectionFactKey), undefined);
      if (wrapped) wrappers++;
      if (indexed) indexedReads++;
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(wrappers, 5);
  assert.equal(indexedReads, 3);
});
