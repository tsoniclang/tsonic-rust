import { createRustRecordFixture, rustNativeFixtureNodes } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustBorrowedElementReads } from "../../../dist/analysis/program/borrowed-element-reads.js";


for (const expression of ["values[0]", "values[0]!"]) {
  test(`indexed String input ${expression} retains its native str borrow`, () => {
    const options = { surfaces: ["js"], files: { "index.ts": `
export function read(values: string[]): number { return parseInt(${expression}, 10); }
` } };
    const { program } = analyzeRust(options);
    const ast = program.source.ast;
    let call;
    const visit = node => {
      if (ast.is.IsCallExpression(node)) call = node;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(call !== undefined, true);
    const selected = program.borrowedElementReads.forExpression(call);
    assert.equal(selected !== undefined, true);
    assert.equal(selected.valueForm, "storage", "provider source input form is selected before publication");
    assert.equal(Object.isFrozen(selected), true, "selected expression read is immutable");
    assert.equal(program.borrowedElementReads.forRead(selected.element) === selected, true);
    const operation = program.records.targetOperation.get(call);
    assert.equal(operation.abi.sourceArguments[0].carrier.kind, "reference");
    const altered = [
      { ...operation, abi: { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "observable" } } },
      { ...operation, abi: { ...operation.abi, targetArguments: operation.abi.targetArguments.map((input, index) =>
        index === 0 ? { ...input, parameterCarrier: { kind: "source-primitive", name: "int32" } } : input) } },
    ];
    for (const [index, replacement] of altered.entries()) {
      const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === call ? replacement : program.records.targetOperation.get(node);
} }}, program.records);
      const reads = analyzeRustBorrowedElementReads(ast, rustNativeFixtureNodes(program), records, program.sourceNavigation);
      assert.equal(reads.forExpression(call) === undefined, true, `invalid native input contract ${index}`);
    }
    const { result } = compileRust(options);
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /borrow_number_element/u);
    assert.match(output, /number_parse_int_radix/u);
    assert.doesNotMatch(output, /get_number|\.clone\(\)|to_owned\(/u);
  });
}
