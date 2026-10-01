import assert from "node:assert/strict";
import test from "node:test";
import { overloadedRestCallbackSource, overloadedRestIntegerSource, overloadedRestOverrideSource } from "../../../../tsonic/test/fixtures/overloaded-rest-arguments.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("overloaded rest callbacks use the selected element and preserve effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": overloadedRestCallbackSource + '\nexport function main(): void { if (!run()) throw new Error("overloaded callbacks"); }' } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("overloaded-rest-callbacks", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`overloaded exact and virtual dispatch remain distinct in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": overloadedRestOverrideSource + '\nexport function main(): void { if (!run()) throw new Error("overloaded overrides"); }' } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`overloaded-rest-overrides-${lane}`, result.artifacts, { run: true });
  });
  test(`overloaded and generic rest arguments retain exact native integers in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": overloadedRestIntegerSource + '\nexport function main(): void { if (!run()) throw new Error("overloaded integers"); }' } });
    assert.deepEqual(result.diagnostics, []);
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(output, /9007199254740993/u);
    assert.doesNotMatch(output, /BigInt|\.collect\(/u);
    validateGeneratedProject(`overloaded-rest-integers-${lane}`, result.artifacts, { run: true });
  });
}

test("overloaded rest calls reject incompatible selected elements", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
    class Collector {
      collect(mode: "empty"): void;
      collect(mode: string, ...values: number[]): void;
      collect(mode: string, ...values: number[]): void {}
    }
    export function run(): void { new Collector().collect("run", "wrong"); }
  ` } }), /TS2345/u);
});
