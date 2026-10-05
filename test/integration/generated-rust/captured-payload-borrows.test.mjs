import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`retained async payloads enter borrowed source arguments (${surfaces.length === 0 ? "native" : "js"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "captured_payload_borrows" } },
      files: { "index.ts": `
function matches(value: string, expected: string): boolean { return value === expected; }
function capture(value: string): () => Promise<boolean> {
  return async () => matches(value, "payload");
}
export async function main(): Promise<void> {
  const callback = capture("payload");
  if (!await callback() || !await callback()) throw new Error("retained payload borrowing");
}
` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject("captured-payload-borrows", result.artifacts, { run: true });
  });
}
