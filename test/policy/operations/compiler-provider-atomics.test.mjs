import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider sleep uses a real shared buffer and atomic wait", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_atomics" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
const values = new Int32Array(buffer);
export function main(): void {
  check(buffer.byteLength === 8);
  check(Atomics.wait(values, 0, 1, 100) === "not-equal");
  check(Atomics.store(values, 0, 7) === 7 && Atomics.load(values, 0) === 7);
  const alias = new Int32Array(buffer, 0, 1);
  check(Atomics.load(alias, 0) === 7);
  check(Atomics.wait(alias, 0, 7, 2) === "timed-out");
  check(Atomics.notify(values, 0) === 0 && Atomics.notify(values, 0, 1) === 0);
  const ordinary = new Int32Array(1);
  let rejected = false;
  try { Atomics.wait(ordinary, 0, 0, 0); } catch { rejected = true; }
  check(rejected);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-atomics", result.artifacts, { run: true });
});
