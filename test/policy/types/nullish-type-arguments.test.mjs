import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`inferred generic arguments retain distinct null and undefined types (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "nullish_type_arguments" } },
      files: { "index.ts": `
function retain<T>(value: T): T { return value; }
function absent(): undefined { return retain(undefined); }
function nil(): null { return retain(null); }
export function main(): void {
  const missing: undefined = absent();
  const empty: null = nil();
  if (missing !== undefined || empty !== null) {
    throw new Error("distinct nullish values");
  }
}
` },
    });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /fn absent\(\) -> rt::Undefined/u);
    assert.match(output, /fn nil\(\) -> rt::Null/u);
    validateGeneratedProject(`nullish-type-arguments-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
