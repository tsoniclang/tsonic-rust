import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustFinalizedSourceInputs } from "../../../dist/target-model/operations/finalized-inputs.js";

for (const identity of [false, true]) {
  for (const [label, text, expected] of [
    ["ordinary source storage", `export function run(): number {
    let seed = "7";
    const value = ${identity ? '((seed)).indexOf("7")' : "parseInt(((seed)))"};
    return value;
  }`, "plain"],
    ["captured mutable source storage", `export function run(): number {
    let seed = "7";
    function update(): void { seed = "8"; }
    const value = ${identity ? '((seed)).indexOf("7")' : "parseInt(((seed)))"};
    update();
    return value;
  }`, "borrow-guard"],
  ]) {
    test(`argument views retain ${label} through every transparent source wrapper${identity ? " with identity storage" : ""}`, () => {
      const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": text } });
      assert.equal(program !== undefined, true, "the actual checked source is admitted");
      const { ast } = program.source;
      const selected = [];
      const visit = node => {
        if (ast.is.IsCallExpression(node)) {
          const expression = Node_Expression(ast, node);
          const receiverCall = expression !== undefined && ast.is.IsPropertyAccessExpression(expression) &&
            ast.text(ast.name(expression)) === "indexOf";
          const convertedCall = expression !== undefined && ast.is.IsIdentifier(expression) && ast.text(expression) === "parseInt";
          if (identity ? receiverCall : convertedCall) {
            const operation = program.records.targetOperation.get(node);
            assert.equal(operation?.kind, "provider-operation", "the exact checked call has its native provider ABI");
            const inputs = rustFinalizedSourceInputs(operation.abi).filter(input => identity
              ? input.source.kind === "receiver" : input.source.kind === "argument" && input.source.sourceIndex === 0);
            assert.equal(inputs.length, 1, "the actual receiver or first argument has one native use");
            assert.equal(inputs[0].conversion.kind === "identity", identity,
              "a borrowed String-to-str conversion is not the original native storage identity");
            assert.equal(identity ? inputs[0].mode === "ref" : inputs[0].sharedConversion, true,
              "both inputs borrow their actual native source without manufacturing an owned snapshot");
            let argument = identity ? Node_Expression(ast, expression) : ast.arguments(node)[0];
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
        assert.equal(program.records.readOwnership.get(node)?.source.kind, "borrow",
          "the finalized native source conversion selects a borrow before storage views are sealed");
        assert.equal(view?.borrowedStorage, identity ? expected : undefined,
          identity ? "the physical source form is selected before sealing"
            : "the completed converted value is not relabelled as its original raw storage");
        assert.equal(Object.isFrozen(view), true, "the selected argument view is immutable");
      }
    });
  }
}
