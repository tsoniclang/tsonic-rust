import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider performance uses one clock before authored initialization", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_performance" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import { performance as imported } from "node:perf_hooks";
const start = performance.now();
const origin = globalThis.performance.timeOrigin;
export function main(): void {
  check(start >= 0 && imported.now() >= start);
  check(origin === imported.timeOrigin && origin === performance.timeOrigin);
  const before = Date.now();
  const epoch = imported.timeOrigin + imported.now();
  const after = Date.now();
  check(epoch >= before - 100 && epoch <= after + 100);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const main = artifactText(result, "src/main.rs");
  const initializeClock = main.indexOf("tsonic_rust_node::perf_hooks::initialize_clock()");
  const initializeSource = main.indexOf("provider_performance::initialize()");
  const entry = main.indexOf("provider_performance::tsonic_entry()");
  const drain = main.indexOf("tsonic_rust_node::run_event_loop()");
  assert.ok(initializeClock >= 0 && initializeClock < initializeSource);
  assert.ok(initializeSource < entry && entry < drain, main);
  assert.equal(main.match(/initialize_clock\(\)/gu)?.length, 1);
  validateGeneratedProject("compiler-provider-performance", result.artifacts, { run: true });
});
