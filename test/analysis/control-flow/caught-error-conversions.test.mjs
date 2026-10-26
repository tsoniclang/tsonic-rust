import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { recursiveCallbackProtocolCases } from "../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";
import { selectRustCaughtErrorConversion } from "../../../dist/analysis/control-flow/statement-completion.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustNativeErrorJoinReference, rustNativeErrorJoinTargetType } from "../../../dist/target-model/types/native-error-joins.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("native caught conversion folds every nested error arm from exact input proofs", () => {
  const target = rustProgramErrorTargetType({ kind: "physical", domain: "runtime" });
  const input = rustJsErrorTargetType();
  const never = { kind: "target-named", id: rustInfallibleTargetId };
  const inner = rustNativeErrorJoinTargetType("/src/index.ts", [input, never]);
  assert.equal(inner !== undefined, true, "the inner native sum has two exact error arms");
  const source = rustNativeErrorJoinTargetType("/src/index.ts", [target, inner]);
  assert.equal(source !== undefined, true, "the outer native sum preserves its nested error arm");
  const selected = selectRustCaughtErrorConversion(source, target, [{ error: input, target }]);
  assert.equal(selected?.kind, "native-join", "the owner selects one catch-boundary match");
  assert.equal(selected.arms.length, 2, "every outer native variant is covered");
  assert.equal(selected.arms[0].kind, "identity", "the exact common physical owner moves unchanged");
  assert.equal(selected.arms[1].kind, "native-join", "the nested sum retains its own exact match");
  assert.equal(selected.arms[1].arms.length, 2, "every inner native variant is covered");
  assert.equal(selected.arms[1].arms[0].kind, "into", "only the input with its exact native obligation converts");
  assert.equal(selected.arms[1].arms[1].kind, "uninhabited", "the impossible native error is eliminated without conversion");
  assert.equal(rustTargetTypeRefEquals(selected.arms[1].arms[0].carrier, input), true, "the leaf keeps its original physical carrier");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.arms) && selected.arms.every(Object.isFrozen) &&
    Object.isFrozen(selected.arms[1].arms), true, "the complete selected conversion tree is immutable");
});

test("native caught conversion refuses missing, foreign and cyclic input evidence", () => {
  const target = rustProgramErrorTargetType({ kind: "physical", domain: "runtime" });
  const foreign = rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "foreign" });
  const input = rustJsErrorTargetType();
  const source = rustNativeErrorJoinTargetType("/src/index.ts", [target, input]);
  assert.equal(source !== undefined, true, "the actual input sum is valid");
  assert.equal(selectRustCaughtErrorConversion(source, target, []), undefined, "a missing leaf obligation never converts the whole sum");
  assert.equal(selectRustCaughtErrorConversion(source, target, [{ error: input, target: foreign }]), undefined,
    "an obligation to a different physical package owner is not interchangeable");
  assert.equal(selectRustCaughtErrorConversion(source, target, [{ error: rustSourcePrimitiveTargetType("int32"), target }]), undefined,
    "a different native input cannot supply the missing leaf proof");
  const partial = rustNativeErrorJoinTargetType("/src/index.ts", [input, foreign]);
  assert.equal(partial !== undefined, true, "the partially covered sum is valid native metadata");
  assert.equal(selectRustCaughtErrorConversion(partial, target, [{ error: input, target }]), undefined,
    "one proven arm never discharges an unrelated inhabited arm");
  const cyclic = { kind: "target-specific", target: "rust", name: "native-error-join", value: { fileName: "/src/index.ts", errors: [] } };
  cyclic.value.errors.push(target, cyclic);
  assert.equal(selectRustCaughtErrorConversion(cyclic, target, [{ error: input, target }]), undefined,
    "cyclic error metadata is refused within the owner budget");
});

test("observed native error joins publish one immutable catch conversion", () => {
  const fixture = recursiveCallbackProtocolCases.find(current => current.name === "recursive-callback-typed-failures");
  assert.equal(fixture !== undefined, true, "the unchanged recursive callback identity fixture exists");
  const { program } = analyzeRust({ files: { "index.ts": fixture.source } });
  const ast = program.source.ast;
  const catches = [];
  const visit = node => {
    if (ast.is.IsCatchClause(node)) catches.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(catches.length, 1, "the actual callback fixture has one catch owner");
  const selected = program.records.catchBinding.get(catches[0]);
  const source = rustNativeErrorJoinReference(selected?.inputCarrier);
  assert.equal(source?.errors.length, 2, "the protected body retains the local and associated native errors");
  assert.equal(selected.conversion?.operand.kind, "native-join", "the common observation is selected at catch admission");
  assert.equal(selected.conversion.operand.arms.length, 2, "both original error variants are consumed once");
  assert.equal(selected.conversion.operand.arms[0].kind, "identity", "the existing physical program error is not repackaged");
  assert.equal(selected.conversion.operand.arms[1].kind, "into", "the exact native callable input uses its admitted obligation");
  assert.equal(rustTargetTypeRefEquals(selected.readCarrier, selected.conversion.target), true,
    "all catch consumers receive the same selected physical observation carrier");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.conversion) && Object.isFrozen(selected.conversion.operand.arms),
    true, "no consumer can alter the published catch plan");
});

test("unobserved native error joins retain their exact input without a catch conversion", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function ignored(callback: () => void): void {
  try { callback(); throw new Error("local"); } catch (error) { void error; }
}
export function rethrown(callback: () => void): void {
  try { callback(); throw new Error("local"); } catch (error) { throw error; }
}
` } });
  const ast = program.source.ast;
  let count = 0;
  const visit = node => {
    if (ast.is.IsCatchClause(node)) {
      count += 1;
      const selected = program.records.catchBinding.get(node);
      assert.equal(rustNativeErrorJoinReference(selected?.inputCarrier)?.errors.length, 2,
        "each original protected body retains both local and native input errors");
      assert.equal(selected.conversion, undefined, "unused and rethrow-only catches perform no observation conversion");
      assert.equal(rustTargetTypeRefEquals(selected.readCarrier, selected.inputCarrier), true,
        "the exact native error sum remains unchanged");
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(count, 2, "both original native inverse cases are inspected");
});

for (const surface of ["native", "js"]) test(`native joined catch observations and rethrows preserve alias identity in ${surface}`, { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: surface === "native" ? [] : ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
function inspect(callback: () => void): void {
  try { callback(); throw new Error("local"); }
  catch (error) {
    const alias = error;
    if (alias instanceof Error && alias.message === "original") throw error;
  }
}
export function main(): void {
  const original = new Error("original");
  try { inspect(() => { throw original; }); }
  catch (error) { if (error === original) return; }
  throw new Error("catch rethrow lost original identity");
}
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(issue => issue.message).join("\n"));
  validateGeneratedProject(`joined-catch-rethrow-${surface}`, result.artifacts, { run: true });
});
