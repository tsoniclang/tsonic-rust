import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText, rustSourceText } from "../../../helpers/rust-session.mjs";
import { nativeFunction, nativeNodes } from "../../../helpers/native-ast.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";

test("native tasks thread through ordinary callers and evaluate arguments before eager spawn", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin", crateName: "native_task_scope" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
let effects: int32 = 0;
let observed: int32 = 0;
function input(): int32 { effects += 1; return effects; }
async function body(value: int32): Promise<void> { observed = value; }
function schedule(): void {
  void body(input());
  if (effects !== 1 || observed !== 1) throw new Error("native task was not eagerly polled once");
}
function outer(): void { schedule(); }
outer();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  for (const name of ["schedule", "outer"]) {
    const owner = nativeFunction(result, name);
    assert.equal(owner.params.length, 1, `${name} has only its required hidden scope input`);
    assert.equal(owner.params[0].type.kind, "reference", `${name} borrows the existing task owner`);
    assert.equal(owner.params[0].type.referent.path, "rt::TaskScope", name);
    assert.equal(nativeNodes(owner.body, node => node.kind === "method-call" && node.method === "clone").length, 0,
      `${name} forwards the borrow, without an owning scope clone`);
  }
  const schedule = nativeFunction(result, "schedule");
  const futures = nativeNodes(schedule.body, node => node.kind === "let" && node.name.startsWith("native_task_future"));
  assert.equal(futures.length, 1, "one selected future is constructed before runtime registration");
  assert.equal(nativeNodes(futures[0].init, node => node.kind === "call" && node.path.endsWith("::input")).length, 1,
    "the source argument effect is evaluated once in the future construction, not delayed into its task");
  const spawned = nativeNodes(schedule.body, node => node.kind === "call" && node.path === "tsonic_rust_runtime::spawn");
  assert.equal(spawned.length, 1, "the one source void has one native spawn");
  assert.equal(spawned[0].args[1].kind, "async-block", "spawn receives a future, not a second executor or a factory");
  const main = artifactText(result, "src/main.rs");
  assert.equal((main.match(/tsonic_rust_runtime::run_tasks\(/gu) ?? []).length, 1, "one aggregate future owns the whole lifecycle");
  assert.equal((main.match(/tsonic_rust_runtime::block_on\(/gu) ?? []).length, 1, "the existing native executor drives that aggregate");
  assert.equal(validateGeneratedProject("native-task-scope", result.artifacts, { run: true }).status, 0);
});

test("an immediately awaited scheduling function retains its actual borrowed task lifetime", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin", crateName: "borrowed_native_task_scope" } },
    files: { "index.ts": `
async function body(): Promise<void> { return; }
async function schedule(): Promise<void> { void body(); }
await schedule();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const schedule = nativeFunction(result, "schedule");
  assert.equal(schedule.params.length, 1, "the ordinary async body has its one selected hidden formal");
  assert.equal(schedule.params[0].type.kind, "reference", "the directly awaited owner uses the selected borrow");
  assert.equal(schedule.params[0].type.referent.path, "rt::TaskScope", "the borrow is the same native runtime scope");
  assert.equal(validateGeneratedProject("borrowed-native-task-scope", result.artifacts, { run: true }).status, 0);
});

test("scope-free native programs emit no task ownership or tracking machinery", () => {
  const { result } = compileRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function add(value: int32): int32 { return value + 1; }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(nativeFunction(result, "add").params.length, 1, "the authored argument is the whole native ABI");
  assert.doesNotMatch(rustSourceText(result), /TaskScope|run_tasks|native_task_scope/u,
    "programs without native tasks do not pay for a scope, queue, TLS access or hidden parameter");
});
