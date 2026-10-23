import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { Node_Expression } from "@tsonic/target-api/source";

for (const [label, text, expected] of [
  ["ordinary source storage", `export function run(): number {
    let seed = "7";
    const value = parseInt(((seed)));
    return value;
  }`, "plain"],
  ["captured mutable source storage", `export function run(): number {
    let seed = "7";
    function update(): void { seed = "8"; }
    const value = parseInt(((seed)));
    update();
    return value;
  }`, "borrow-guard"],
]) {
  test(`argument views retain ${label} through every transparent source wrapper`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": text } });
    assert.equal(program !== undefined, true, "the actual checked source is admitted");
    const { ast } = program.source;
    const selected = [];
    const visit = node => {
      if (ast.is.IsCallExpression(node)) {
        const expression = Node_Expression(ast, node);
        if (expression !== undefined && ast.is.IsIdentifier(expression) && ast.text(expression) === "parseInt") {
          let argument = ast.arguments(node)[0];
          while (argument !== undefined) {
            selected.push(argument);
            argument = ast.is.IsParenthesizedExpression(argument) ? Node_Expression(ast, argument) : undefined;
          }
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(selected.length, 3, "both wrappers and their original storage read are covered");
    for (const node of selected) {
      const view = program.records.argumentView.get(node);
      assert.equal(view?.borrowedStorage, expected, "the physical source form is selected before sealing");
      assert.equal(Object.isFrozen(view), true, "the selected argument view is immutable");
    }
  });
}
