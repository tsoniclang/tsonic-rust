import assert from "node:assert/strict";
import test from "node:test";
import { sourceNativeCalleeFiles } from "../../../../tsonic/test/fixtures/source-native-callees.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native callee selection preserves method dispatch, generics and lazy arguments in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `source_native_callees_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { ...sourceNativeCalleeFiles, "index.ts": `${sourceNativeCalleeFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("native callee dispatch"); }
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(name, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
}
