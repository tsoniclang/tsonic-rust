import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { authoredLocalTypesFiles } from "../../../../../tsonic/test/fixtures/authored-local-types.mjs";

test("local class scopes preserve repeated authored names through native construction and cross-file returns", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_local_types" } },
    files: { ...authoredLocalTypesFiles, "index.ts": `${authoredLocalTypesFiles["index.ts"]}
      export function main(): void { if (!run()) throw new Error("authored local types"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const sources = result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))
    .map(artifact => artifact.text).join("\n");
  assert.equal([...sources.matchAll(/\bstruct Entry\b/g)].length, 4);
  assert.match(sources, /\bfn readValue\b/);
  assert.doesNotMatch(sources, /\b(?:struct (?:FirstEntry|SecondEntry|GenericEntry)|fn read_value)\b/);
  const native = validateGeneratedProject("authored-local-types", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stderr || native.stdout);
});
