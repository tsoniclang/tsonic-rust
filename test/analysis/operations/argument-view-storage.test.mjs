import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { Node_Expression } from "@tsonic/target-api/source";
import { rustFinalizedSourceInputs } from "../../../dist/target-model/operations/finalized-inputs.js";
import { rustProviderInputBorrowMode } from "../../../dist/policy/operations/members/input-borrows.js";
import { rustBorrowedStrTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const rawStorage of [false, true]) {
  for (const [label, text, expected] of [
    ["ordinary source storage", `export function run(): number {
    let seed = "7";
    const value = ${rawStorage ? '((seed)).indexOf("7")' : "parseInt(((seed)))"};
    return value;
  }`, "plain"],
    ["captured mutable source storage", `export function run(): number {
    let seed = "7";
    function update(): void { seed = "8"; }
    const value = ${rawStorage ? '((seed)).indexOf("7")' : "parseInt(((seed)))"};
    update();
    return value;
  }`, "plain"],
    ["stored captured mutable source storage", `export function run(seed: string): () => number {
    return () => {
      const value = ${rawStorage ? '((seed)).indexOf("7")' : "parseInt(((seed)))"};
      seed = "8";
      return value;
    };
  }`, "borrow-guard"],
  ]) {
    test(`argument views retain ${label} through every transparent source wrapper${rawStorage ? " with raw source storage" : ""}`, () => {
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
          if (rawStorage ? receiverCall : convertedCall) {
            const operation = program.records.targetOperation.get(node);
            assert.equal(operation?.kind, "provider-operation", "the exact checked call has its native provider ABI");
            const inputs = rustFinalizedSourceInputs(operation.abi).filter(input => rawStorage
              ? input.source.kind === "receiver" : input.source.kind === "argument" && input.source.sourceIndex === 0);
            assert.equal(inputs.length, 1, "the actual receiver or first argument has one native use");
            const input = inputs[0];
            assert.equal(input.conversion.kind, rawStorage ? "semantic" : "identity",
              "the provider ABI distinguishes an input conversion from an already context-converted source");
            assert.equal(input.mode, "value", "the native str reference itself is passed by value");
            assert.equal(rustProviderInputBorrowMode(input), "ref",
              "the actual first source read is shared in both conversion stages");
            assert.equal(input.sharedConversion, rawStorage,
              "only the provider-side String-to-str conversion borrows an unconverted source");
            assert.equal(rustTargetTypeRefEquals(input.sourceCarrier,
              rawStorage ? rustStringTargetType() : rustBorrowedStrTargetType()), true,
            "the actual provider source carrier agrees with the completed source expression stage");
            let argument = rawStorage ? Node_Expression(ast, expression) : ast.arguments(node)[0];
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
      if (expected === "borrow-guard") {
        const binding = program.records.sourceBinding.get(selected.at(-1))?.sourceDeclaration;
        assert.equal(binding !== undefined, true, "the actual stored native capture has its checked binding");
        assert.equal(program.records.bindingStorage.get(binding)?.storage, "borrow-cell",
          "the borrow-guard inverse exercises finalized native cell storage rather than assuming every capture needs a cell");
      }
      for (const node of selected) {
        const view = program.records.argumentView.get(node);
        const contextual = program.records.contextualValueConversion.get(node);
        assert.equal(program.records.readOwnership.get(node)?.source.kind, "borrow",
          "the finalized native source conversion selects a borrow before storage views are sealed");
        assert.equal(view?.borrowedStorage, contextual === undefined ? expected : undefined,
          contextual === undefined ? "the physical source form is selected before sealing"
            : "the completed converted value is not relabelled as its original raw storage");
        assert.equal(Object.isFrozen(view), true, "the selected argument view is immutable");
      }
      const conversions = selected.flatMap(node => {
        const conversion = program.records.contextualValueConversion.get(node);
        return conversion === undefined ? [] : [conversion];
      });
      assert.equal(conversions.length, rawStorage ? 0 : 1,
        "the one contextual conversion is owned by the actual source read, not repeated at each wrapper");
      for (const conversion of conversions) {
        assert.equal(conversion.conversion.kind === "semantic-conversion" &&
          conversion.conversion.id === "borrowed-str-from-owned-string", true,
        "the original parseInt source keeps its actual String-to-str conversion");
        assert.equal(rustTargetTypeRefEquals(conversion.sourceCarrier, rustStringTargetType()) &&
          rustTargetTypeRefEquals(conversion.targetCarrier, rustBorrowedStrTargetType()), true,
        "contextual borrowing preserves the exact native source and destination carriers");
      }
    });
  }
}
