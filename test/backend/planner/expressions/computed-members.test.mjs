import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { prepareRustComputedMemberEvaluation } from "../../../../dist/backend/planner/expressions/computed-members.js";
import { rustComputedMemberFactKey, rustTargetOperationFactKey } from "../../../../dist/analysis/facts/operations/keys.js";

for (const [form, source] of [
  ["method", `class Value { read(): number { return 3; } }
export function main(): number { return new Value()["read"](); }`],
  ["callable", `export function main(): number {
const callbacks: (() => number)[] = [() => 3]; return callbacks[0](); }`],
]) for (const mutation of ["missing", "receiver", "key"]) {
  test(`computed ${form} source call rejects ${mutation} evaluation evidence`, () => {
    const { program } = analyzeRust({ files: { "index.ts": `
${source}
` } });
    const { ast } = program.source;
    let selected;
    const visit = node => {
      if (ast.is.IsElementAccessExpression(node)) {
        const parent = ast.parent(node);
        if (parent !== undefined && program.facts.getFact(parent, rustTargetOperationFactKey)?.kind === "source-call") {
          selected = node;
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(selected !== undefined, true, "one exact computed native call");
    const original = program.facts.getFact(selected, rustComputedMemberFactKey);
    assert.equal(original !== undefined, true, "analysis owns the evaluation evidence");
    const changed = mutation === "missing" ? undefined
      : { ...original, [mutation]: selected };
    const context = {
      input: { program: { ...program, facts: {
        ...program.facts,
        getFact: (node, key) => node === selected && key === rustComputedMemberFactKey
          ? changed : program.facts.getFact(node, key),
      } } },
      sourceFile: ast.getSourceFile(selected), diagnostics: [],
    };
    assert.equal(prepareRustComputedMemberEvaluation(selected, context) === undefined, true,
      "no source effect can be silently discarded");
    assert.equal(context.diagnostics.length, 1);
    assert.equal(context.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
    assert.equal(context.diagnostics[0].evidence.includes(
      "target.capability=rust.backend.computed-member-evaluation"), true);
  });
}

test("an indexed source-call argument is not mistaken for the computed callee", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function accept(value: number): number { return value; }
export function main(): number { const values: number[] = [3]; return accept(values[0]); }
` } });
  const { ast } = program.source;
  let selected;
  const visit = node => {
    if (ast.is.IsElementAccessExpression(node)) selected = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selected !== undefined, true, "one exact indexed argument");
  const parent = ast.parent(selected);
  assert.equal(program.facts.getFact(parent, rustTargetOperationFactKey)?.kind, "source-call");
  assert.equal(program.facts.getFact(selected, rustComputedMemberFactKey) === undefined, true);
  const context = { input: { program }, diagnostics: [] };
  const evaluation = prepareRustComputedMemberEvaluation(selected, context);
  assert.equal(evaluation?.context === context && evaluation.bindings.length === 0, true);
  assert.equal(context.diagnostics.length, 0);
});

test("computed member fact identity retains both evaluation decisions", () => {
  const receiver = {};
  const key = {};
  const original = { receiver, key, accessMode: "read", evaluateReceiver: true, evaluateKey: true };
  assert.equal(rustComputedMemberFactKey.equals(original, { ...original }), true);
  for (const field of ["evaluateReceiver", "evaluateKey"]) {
    assert.equal(rustComputedMemberFactKey.equals(original, { ...original, [field]: false }), false, field);
  }
});
