import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRust,
  nodejsCapability,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("process identity, timing, and memory APIs compile and execute", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "node_process_parity" } },
    files: {
      "index.ts": `
import { ok } from "node:assert";
import processDefault, {
  argv0,
  availableMemory,
  chdir,
  constrainedMemory,
  cwd,
  hrtime,
  memoryUsage,
  uptime,
  version,
} from "node:process";

export function main(): void {
  const originalDirectory = cwd();
  chdir(originalDirectory);
  ok(cwd() === originalDirectory);
  ok(argv0.length >= 0);
  ok(version.length > 0);
  ok(availableMemory() >= 0);
  ok(constrainedMemory() >= 0);
  ok(uptime() >= 0);

  const first = hrtime();
  const elapsed = hrtime(first);
  ok(first.length === 2);
  ok(elapsed.length === 2);
  ok(elapsed[0] >= 0);
  ok(elapsed[1] >= 0 && elapsed[1] < 1000000000);

  const usage = memoryUsage();
  ok(usage.rss >= 0);
  ok(usage.heapTotal >= 0);
  ok(usage.heapUsed >= 0);
  ok(usage.external >= 0);
  ok(usage.arrayBuffers >= 0);

  ok(processDefault.argv0 === argv0);
  ok(processDefault.version === version);
  ok(processDefault.uptime() >= 0);
  ok(processDefault.memoryUsage().rss >= 0);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /tsonic_rust_node::process::hrtime_open_number/u);
  assert.match(source, /tsonic_rust_node::process::hrtime_since_number/u);
  assert.match(source, /tsonic_rust_node::process::memory_usage/u);
  assert.match(source, /\.heap_total/u);
  const run = validateGeneratedProject("node-process-parity-20260817", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
