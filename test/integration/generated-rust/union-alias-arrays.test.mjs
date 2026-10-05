import assert from "node:assert/strict";
import test from "node:test";
import { unionAliasArrayFiles } from "../../../../tsonic/test/fixtures/union-alias-arrays.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`equivalent cross-file union aliases retain one array element representation on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: unionAliasArrayFiles });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => `${row.code}: ${row.message.slice(0, 256)}`).join("\n"));
    assert.equal(/\.map\([^;]+\.collect|transmute|from_raw_parts/u.test(rustSourceText(result)), false,
      "equivalent element aliases need no backing conversion or unsafe reinterpretation");
    validateGeneratedProject(`union-alias-arrays-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
