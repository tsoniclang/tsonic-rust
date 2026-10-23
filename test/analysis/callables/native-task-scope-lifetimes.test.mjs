import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustLifetimesEqual } from "../../../dist/target-model/lifetimes/index.js";

function declarationNamed(program, name) {
  const pending = program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile);
  while (pending.length !== 0) {
    const node = pending.pop();
    if (program.source.ast.is.IsFunctionDeclaration(node) &&
      program.source.ast.text(program.source.ast.name(node)) === name) return node;
    program.source.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return undefined;
}

test("an immediately awaited ordinary scheduling function retains its actual hidden scope borrow", () => {
  const { program } = analyzeRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `async function body(): Promise<void> { return; }
async function schedule(): Promise<void> { void body(); }
async function run(): Promise<void> { await schedule(); }
void run();`,
  } });
  const declaration = declarationNamed(program, "schedule");
  assert.equal(declaration !== undefined, true, "the scheduling owner is its original checked declaration");
  const task = program.records.nativeTaskUse.get(declaration);
  assert.equal(task?.kind === "owner" && task.binding === "borrowed-parameter", true,
    "the directly awaited activation borrows the existing scope rather than cloning an owned handle");
  assert.equal(task.inputCarrier.kind === "reference", true, "the native hidden formal is a real reference");
  const retained = program.records.retainedEnvironment.get(declaration);
  assert.equal(retained?.inputs.some(input => input.kind === "native-task-scope"), true,
    "the existing retained environment owns the ordinary hidden input lifetime");
  assert.equal(rustLifetimesEqual(retained.lifetime, task.inputCarrier.lifetime), true,
    "the input and lifetime owner publish the identical borrow");
  const producer = program.callableValues.nativeProducers.forDeclaration(declaration);
  assert.equal(producer.environment.filter(argument => argument.kind === "lifetime" &&
    rustLifetimesEqual(argument.lifetime, retained.lifetime)).length, 1,
    "the physical producer captures this exact scope-only lifetime once");
  const result = program.callableValues.nativeProducers.invocationResultFor(declaration);
  assert.equal(result?.kind === "impl-trait" && result.captures.some(argument => argument.kind === "lifetime" &&
    rustLifetimesEqual(argument.lifetime, retained.lifetime)), true,
    "the returned native future preserves its actual input borrow instead of fabricating static storage");
});

test("an ordinary task-free function gains no hidden input or retained lifetime", () => {
  const { program } = analyzeRust({ surfaces: [], files: {
    "index.ts": "export function plain(value: number): number { return value; }",
  } });
  const declaration = declarationNamed(program, "plain");
  assert.equal(program.records.nativeTaskUse.get(declaration) === undefined, true, "no task scope is published");
  assert.equal(program.records.retainedEnvironment.get(declaration) === undefined, true, "no scope lifetime is introduced");
  assert.equal(program.callableValues.nativeProducers.forDeclaration(declaration).environment.length, 0,
    "the native producer retains its original empty environment");
});
