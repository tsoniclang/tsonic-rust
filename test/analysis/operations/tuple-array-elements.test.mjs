import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustProviderOperationFormContractViolation } from "../../../dist/policy/operations/forms.js";
import { validateOperationForm } from "../../../dist/providers/packages/validation/forms.js";

for (const [surface, surfaces] of [["native", []], ["js", ["js"]]]) {
  for (const [label, key, expected] of [["numeric zero", "0", 0], ["numeric one", "1", 1], ["string zero", '"0"', 0], ["string one", '"1"', 1]]) {
    test(`checked tuple-rest ${label} uses its actual physical array (${surface})`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": `
export function read(): number {
  const [first, ...rest] = [2, 7, 11] as const;
  first;
  return rest[${key}];
}` } });
      assert.equal(result.diagnostics.length, 0, "the actual checked tuple ordinal does not require a fabricated Array member identity");
      assert.equal(result.program !== undefined && result.plan !== undefined, true, "the complete physical array operation is admitted");
      const ast = result.program.source.ast;
      const pending = [...result.program.sourceFiles];
      let selected;
      while (pending.length !== 0) {
        const node = pending.pop();
        if (ast.is.IsElementAccessExpression(node)) selected = result.program.records.targetOperation.get(node);
        ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
      }
      assert.equal(selected?.kind === "provider-operation", true, "tuple-rest has actual array storage, not a fabricated native tuple");
      assert.equal(selected.abi.sourceArguments.length, 1, "the original key expression remains in the source evaluation vector");
      assert.equal(selected.abi.sourceArguments[0].disposition, "evaluation-only", "the checked key is evaluated, not passed as a guessed numeric carrier");
      const target = selected.abi.targetArguments[0];
      assert.equal(target?.source.kind, "constant", "the target input is the already-proven ordinal");
      assert.equal(target.source.value.value, expected, "the exact checked ordinal is preserved");
      assert.equal(target.source.value.kind, surface === "native" ? "integer" : "float64", "the target constant has its genuine native API domain");
      assert.equal(selected.abi.target.form, surface === "native" ? "index" : "receiver-method", "the existing target bounds/absence operation remains authoritative");
      if (surface === "js") {
        assert.equal(selected.abi.target.name, "get_number", "the actual JsArray API retains its single native absence state");
        assert.equal(selected.borrowedIndexOperation?.method, "borrow_number_element", "the existing canonical borrowed element operation is retained");
      }
    });
  }

  test(`tuple-rest receiver and singleton key effects execute exactly once in order (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
let trace = 0;
function receiver(): readonly [7, 11] {
  trace = trace * 10 + 1;
  const [first, ...rest] = [2, 7, 11] as const;
  first;
  return rest;
}
function key(): 0 { trace = trace * 10 + 2; return 0; }
const selected = receiver()[key()];
if (selected !== 7 || trace !== 12) throw new Error("tuple key evaluation order");
` } });
    assert.equal(result.diagnostics.length, 0, "a checked singleton key never licenses erasing its effects");
    assert.equal(result.program !== undefined && result.plan !== undefined, true, "the complete effectful array read is published");
    validateGeneratedProject(`tuple-array-key-order-${surface}`, result.artifacts, { run: true });
  });
}

test("constant physical indices admit only safe exclusive checked ordinals", () => {
  const contract = (form, operationKind, runtimeSourceIndexes) => rustProviderOperationFormContractViolation(
    operationKind, form, operationKind === "index-set" ? 2 : 1, runtimeSourceIndexes);
  assert.equal(contract({ form: "index", constantIndex: 1 }, "indexer", []) === undefined, true, "a checked constant has no runtime key operand");
  assert.equal(contract({ form: "index", constantIndex: 1 }, "index-set", [1]) === undefined, true, "a constant write still retains its actual value operand");
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(contract({ form: "index", constantIndex: value }, "indexer", []) !== undefined, true, "an invalid ordinal never acquires native bounds evidence");
  }
  assert.equal(contract({ form: "index", constantIndex: 0, indexConversion: "checked-i32-to-usize" }, "indexer", []) !== undefined, true,
    "a checked constant and a runtime key conversion are mutually exclusive");
  assert.equal(contract({ form: "index", constantIndex: 0 }, "indexer", [0]) !== undefined, true,
    "the original key cannot be duplicated into a runtime target operand");
  assert.equal(contract({ form: "index" }, "indexer", [0]) === undefined, true, "the original runtime index contract remains unchanged");
  assert.throws(() => validateOperationForm("indexer", { form: "index", constantIndex: 0 }, {}, "external index", [],
    message => { throw new Error(message); }), /compiler-owned/u, "external providers cannot fabricate compiler-selected tuple ordinals");
});
