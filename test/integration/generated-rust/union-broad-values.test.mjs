import assert from "node:assert/strict";
import test from "node:test";
import { unionBroadValuesSource } from "../../../../tsonic/test/fixtures/union-broad-values.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native union leaves retain their broad scalar values", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": unionBroadValuesSource + '\nexport function main(): void { if (!run()) throw new Error("union broad values"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const mixed = artifactText(result, "src/index.rs").split("fn mixed(")[1]?.split(/\n(?:pub(?:\([^)]*\))? )?fn /u)[0];
  assert.ok(mixed !== undefined);
  assert.match(mixed, /match /u);
  assert.doesNotMatch(mixed, /\.clone\(|Box::|Rc::|from_closed/u);
  validateGeneratedProject("union-broad-values", result.artifacts, { run: true });
});
