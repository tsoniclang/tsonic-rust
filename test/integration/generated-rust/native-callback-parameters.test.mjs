import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native callbacks retain explicit local arithmetic (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_parameters" } },
      files: { "index.ts": `
import type { uint8 } from "@tsonic/core/types.js";
function consume(action: (value: uint8) => number): number { return action(3); }
export function main(): void {
  let captured = 0;
  const fractional = consume((value: number): number => {
    captured += value;
    value += 2;
    return value / 2;
  });
  if (fractional !== 2.5 || captured !== 3) throw new Error("authored arithmetic");
  const integral = consume((value): number => value / 2);
  if (integral !== 1) throw new Error("native arithmetic");
}
` } });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /let mut value: f64 = /u);
    assert.doesNotMatch(output, /Box::new\([^)]*value|u8_to_f64\(.*u8_to_f64/u);
    validateGeneratedProject(`native-callback-parameters-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("native callbacks reject implicit precision loss from wide integers", () => {
  const { result } = compileRust({ files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
function consume(action: (value: uint64) => number, value: uint64): number { return action(value); }
export function example(value: uint64): number { return consume((input: number): number => input, value); }
` } });
  assert.notEqual(result.diagnostics.length, 0);
  assert.deepEqual(result.artifacts, []);
});
