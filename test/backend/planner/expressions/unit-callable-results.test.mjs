import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { planRustCallableExpressionBody } from "../../../../dist/backend/planner/expressions/callable.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

for (const surfaces of [[], ["js"]]) {
  for (const [label, expression] of [
    ["expression absence", "(): void => undefined"],
    ["explicit absence return", "(): void => { return undefined; }"],
    ["explicit bare return", "(): void => { return; }"],
    ["implicit unit completion", "(): void => {}"],
    ["effectful void completion", "(): void => void effect()"],
  ]) {
    test(`native unit callable preserves its Result completion for ${label} on ${surfaces[0] ?? "native"}`, () => {
      const { program } = analyzeRust({ surfaces, files: { "index.ts": `
        let calls = 0;
        function effect(): number { calls += 1; return calls; }
        export function create(): () => void { return ${expression}; }
      ` } });
      const ast = program.source.ast;
      const arrows = [];
      const visit = node => {
        if (ast.is.IsArrowFunction(node)) arrows.push(node);
        ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      program.sourceFiles.forEach(visit);
      assert.equal(arrows.length, 1, "the exact checked producer supplies the callable body");
      const node = arrows[0];
      const selected = program.records.lambdaBody.get(node);
      assert.equal(selected?.construction === "native" && selected.unitBody && selected.bodyFallible, true,
        "the real physical callable carries Result<(),E> even when E is uninhabited");
      const planned = planRustCallableExpressionBody(node, rustSourceFilePlanContext(program, node));
      assert.equal(planned !== undefined, true, "the same actual producer is rendered");
      const text = printRustExpr(planned.expression);
      assert.match(text, /Ok::<_, core::convert::Infallible>\(\(\)\)/u,
        "tail normalization never erases the unit before its selected Result wrapper");
      assert.equal((text.match(/\beffect\(\)/gu) ?? []).length, label === "effectful void completion" ? 1 : 0,
        "only authored effects execute, exactly once");
      assert.doesNotMatch(text, /TsonicError|TsonicResult|map_err/u, "an infallible producer gains no fabricated runtime error channel");
    });
  }
}
