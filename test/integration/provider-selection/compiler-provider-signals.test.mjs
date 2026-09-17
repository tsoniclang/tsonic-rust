import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler signal registration uses the native process object and event loop", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_signals" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import importedProcess from "node:process";
import { setTimeout } from "node:timers";
export function main(): void {
  check(process.kill(process.pid, 0));
  const removed = (): void => { throw new Error("removed callback ran"); };
  importedProcess.once("SIGUSR1", removed).removeListener("SIGUSR1", removed);
  process.once("SIGUSR1", (): void => {
    check(importedProcess.kill(importedProcess.pid, 0));
    importedProcess.exitCode = 0;
  });
  importedProcess.exitCode = 9;
  setTimeout((): void => { check(importedProcess.exitCode === 0); }, 200);
  check(process.kill(process.pid, "SIGUSR1"));
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-signals", result.artifacts, { run: true });
});
