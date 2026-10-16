import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustBinaryExecution } from "../../../dist/analysis/project/binary-execution.js";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";

const hook = phase => Object.freeze({ id: phase, phase, path: `native::${phase.replaceAll("-", "_")}`,
  dispatchGroups: [], isFallible: true, errorBoundary: "source-program" });
const select = (overrides = {}) => analyzeRustBinaryExecution({ outputType: "bin", jsEnabled: true,
  asynchronous: false, hooks: [hook("entry-execution"), hook("async-entry-execution")], ...overrides });

test("binary execution selects one exact owner before publication", () => {
  for (const asynchronous of [false, true]) {
    const selected = select({ asynchronous });
    assert.equal(selected.kind, "resolved");
    assert.equal(selected.value.kind, "owned");
    assert.equal(selected.value.execution, asynchronous ? "future" : "entry");
    assert.equal(selected.value.owner.phase, asynchronous ? "async-entry-execution" : "entry-execution");
    assert.equal(Object.isFrozen(selected.value), true);
  }
  assert.equal(select({ outputType: "lib" }).value.kind, "library");
  assert.equal(select({ jsEnabled: false }).value.kind, "native");
});

test("missing and conflicting loop owners reject at the analysis owner", () => {
  assert.equal(select({ hooks: [] }).diagnostics[0].code, "RUST_ENTRY_OWNER_NOT_PROVEN");
  assert.equal(select({ hooks: [hook("entry-execution"), { ...hook("entry-execution"), id: "other" }] })
    .diagnostics[0].code, "RUST_AMBIGUOUS_ENTRY_OWNER");
  assert.equal(select({ hooks: [hook("async-execution"), { ...hook("async-execution"), id: "other" }] })
    .diagnostics[0].code, "RUST_AMBIGUOUS_ASYNC_EXECUTOR");
});

for (const [name, statement, driver] of [
  ["synchronous", 'console.log("entry");', "run_entry_with_contexts"],
  ["asynchronous", "const value = await Promise.resolve(1); console.log(value);", "block_on_with_contexts"],
]) {
  test(`${name} JS binary enters one owner and returns its orderly exit status`, () => {
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `export {}; ${statement}` } });
    assert.deepEqual(result.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
    const main = artifactText(result, "src/main.rs");
    assert.equal(result.program.binaryExecution.kind, "owned");
    assert.equal(main.includes(driver), true, main);
    assert.equal((main.match(/(?:run_entry|block_on)_with_contexts\(/gu) ?? []).length, 1, main);
    assert.equal(main.includes("exit_requested()"), true, main);
    assert.equal(main.includes("std::process::ExitCode"), true, main);
    assert.equal(main.includes("process::exit("), false, main);
  });
}
