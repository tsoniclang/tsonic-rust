import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { authoredGenericBinderFiles } from "../../../../tsonic/test/fixtures/authored-generic-binders.mjs";

test("authored generic binders retain spelling and independent captured identities", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_generic_binders" } },
    files: { ...authoredGenericBinderFiles, "index.ts": `${authoredGenericBinderFiles["index.ts"]}
      export function main(): void { if (!run()) throw new Error("authored generic binders"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(generated, /\bfn identity<T\b/u);
  assert.doesNotMatch(generated, /\b(?:identity|pair)<T[0-9]+\b/u);
  const native = validateGeneratedProject("authored-generic-binders", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stderr || native.stdout);
});
