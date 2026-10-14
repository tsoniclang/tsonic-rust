import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { selectRustOperationReadUses } from "../../../dist/policy/ownership/read-use.js";

function select(ast, node, operation) {
  return selectRustOperationReadUses(ast, node, { operation, nativeInputs: [], argumentModes: [],
    arguments: undefined, address: undefined, location: undefined, guard: undefined, callableMode: undefined });
}

test("operator ownership consumes selected operand modes instead of rediscovering them from token or result type", async () => {
  const source = createTargetSourceProgram(await checkedSource("ownership-native-operand-modes", {
    "src/index.ts": "function add(left: number, right: number) { return left + right; }",
  }));
  let node;
  const visit = current => {
    if (source.ast.is.IsBinaryExpression(current)) node = current;
    source.ast.forEachChild(current, child => { if (child !== undefined) visit(child); });
  };
  for (const file of source.sourceFiles) visit(file);
  assert.equal(node !== undefined, true, "checked binary operands");
  const binary = source.ast.as.AsBinaryExpression(node);
  for (const [modes, expected] of [
    [["value", "value"], [undefined, undefined]],
    [["ref", "value"], ["shared", undefined]],
    [["value", "ref"], [undefined, "shared"]],
    [["mut-ref", "ref"], ["mutable", "shared"]],
  ]) {
    const operation = { kind: "operator-token", operationId: "fixture-selected-native-operands",
      operator: "+", resultCarrier: { kind: "source-primitive", name: "float64" }, operandModes: modes };
    for (const selected of [operation, { ...operation, kind: "operator-call", path: "fixture::add", fallible: false }]) {
      const uses = select(source.ast, node, selected);
      assert.deepEqual([uses.get(binary.Left)?.mode, uses.get(binary.Right)?.mode], expected);
      if (uses.has(binary.Left)) assert.equal(uses.get(binary.Left).later[0] === binary.Right, true);
    }
  }
});

test("native string append and arithmetic carry their exact operand contracts before ownership analysis", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function append(output: string, suffix: string): string { output += suffix; return output; }
    export function add(left: number, right: number): number { return left + right; }
  ` } });
  const operations = [];
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "operator-token" && program.source.ast.is.IsBinaryExpression(node)) {
      const binary = program.source.ast.as.AsBinaryExpression(node);
      operations.push(operation.operator);
      assert.deepEqual(operation.operandModes, operation.operator === "+=" ? ["mut-ref", "ref"] : ["value", "value"]);
      const uses = select(program.source.ast, node, operation);
      assert.equal(uses.get(binary.Right)?.mode, operation.operator === "+=" ? "shared" : undefined);
      if (operation.operator === "+=") assert.equal(program.ownership.reads.get(binary.Right)?.value.kind, "borrow");
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.deepEqual(operations, ["+=", "+"]);
});
