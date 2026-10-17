import { createRustRecordFixture, rustNativeFixtureNodes } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustBorrowedElementReads } from "../../../dist/analysis/program/borrowed-element-reads.js";
import { createRustBorrowUseAnalysis } from "../../../dist/analysis/ownership/effects.js";
import { rustBorrowedElementRead } from "../../../dist/analysis/program/borrowed-element-purity.js";
import { rustIndexedLocationContract } from "../../../dist/analysis/operations/indexed-location.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/operations/finalized-operation/finalize.js";


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
    assert.equal(selected.targetIndex === program.records.targetOperation.get(selected.element).abi.targetArguments[0], true,
      "the admitted read retains the original finalized native index input");
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
      const nodes = rustNativeFixtureNodes(program);
      const domain = new Set(nodes);
      const isNativeNode = node => domain.has(node);
      const uses = createRustBorrowUseAnalysis({ ast, navigation: program.sourceNavigation, isNativeNode });
      const reads = analyzeRustBorrowedElementReads(ast, nodes, records, program.sourceNavigation, uses, isNativeNode);
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

test("constant native indices retain their original checked key and reject contradictory source correspondence", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
function key(): 0 { return 0; }
export function read(values: string[]): number { return parseInt(values[key()]!, 10); }
` } });
  const ast = program.source.ast;
  const selected = rustNativeFixtureNodes(program).map(node => program.borrowedElementReads.forExpression(node))
    .find(read => read !== undefined);
  assert.equal(selected !== undefined, true, "the real checked indexed String read is admitted");
  const original = program.records.targetOperation.get(selected.element);
  const abi = finalizeRustProviderOperationAbi({ operationKind: "indexer",
    form: { ...original.abi.target, argOrder: [], argModes: [], argConversions: [],
      trailingArguments: [{ kind: "float64", value: 0 }] },
    sourceReceiver: { kind: "runtime", carrier: original.abi.sourceReceiver.carrier },
    sourceArgumentCarriers: original.abi.sourceArguments.map(argument => argument.carrier),
    evaluationOnlySourceArgumentIndexes: [0],
    resultCarrier: original.abi.result.carrier,
    ...(original.abi.result.conversion.kind === "semantic" ? { resultConversion: original.abi.result.conversion.conversion } : {}),
    evaluation: "pure", isAsync: false, isFallible: false }, program.typeDefinitions);
  assert.equal(abi !== undefined, true, "the existing finalizer admits a target constant separately from original key evaluation");
  const operation = { ...original, abi };
  const records = createRustRecordFixture({ targetOperation: { get: node =>
    node === selected.element ? operation : program.records.targetOperation.get(node) } }, program.records);
  const read = rustBorrowedElementRead(selected.receiver, ast, records);
  assert.equal(read !== undefined, true, "the existing borrowed-element owner consumes the constant ABI");
  assert.equal(read.index === selected.index, true, "the original effectful source key is never replaced by a target constant");
  assert.equal(read.targetIndex === abi.targetArguments[0], true, "the exact admitted target constant is retained without reselection");
  assert.equal(rustIndexedLocationContract(operation, program.typeDefinitions)?.index === abi.targetArguments[0], true,
    "address formation uses the same exact native index input");
  for (const altered of [
    { ...abi, sourceArguments: [{ ...abi.sourceArguments[0], disposition: "runtime", role: "index" }] },
    { ...abi, sourceArguments: [{ ...abi.sourceArguments[0], sourceIndex: 1 }] },
    { ...abi, sourceArguments: [{ ...abi.sourceArguments[0], role: "index" }] },
    { ...abi, targetArguments: [abi.targetArguments[0], abi.targetArguments[0]] },
    { ...abi, targetArguments: [{ ...original.abi.targetArguments[0], source: { kind: "receiver" } }] },
  ]) {
    const changed = { ...operation, abi: altered };
    const changedRecords = createRustRecordFixture({ targetOperation: { get: node =>
      node === selected.element ? changed : program.records.targetOperation.get(node) } }, program.records);
    assert.equal(rustBorrowedElementRead(selected.receiver, ast, changedRecords) === undefined, true,
      "an altered native/source index correspondence never publishes a borrowed read");
    assert.equal(rustIndexedLocationContract(changed, program.typeDefinitions) === undefined, true,
      "the same altered correspondence cannot publish an addressable location");
  }
});
