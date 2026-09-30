import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { callableInterfaceFiles, asyncCallableInterfaceFiles, nonErasedCallableInterfaces } from "../../../../tsonic/test/fixtures/callable-interfaces.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`callable interfaces retain exact native signatures on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...callableInterfaceFiles,
      "index.ts": callableInterfaceFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("callable interface"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("callable-interfaces", result.artifacts, { run: true });
  });
  test(`callable interfaces retain async results and one absence on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...asyncCallableInterfaceFiles,
      "index.ts": asyncCallableInterfaceFiles["index.ts"] + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("async callable interface"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("async-callable-interfaces", result.artifacts, { run: true });
  });
}

test("callable interface representation cannot erase extra contracts", () => {
  for (const declaration of nonErasedCallableInterfaces) {
    const { result } = compileRust({ files: { "index.ts": `${declaration}
export function apply(callback: Callback): number { return callback(2); }` } });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  }
});
