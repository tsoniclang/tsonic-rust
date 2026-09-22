import assert from "node:assert/strict";
import test from "node:test";
import { mixedWidthRecordSource } from "../../../../tsonic/test/fixtures/mixed-width-records.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`nested record fields retain only their selected numeric evidence in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "mixed_width_records" } },
      files: { "index.ts": `${mixedWidthRecordSource}
export function main(): void { if (!run()) throw new Error("mixed width records"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject("mixed-width-records", result.artifacts, { run: true }).status, 0);
  });
}

test("conflicting evidence on the same record field remains rejected", () => {
  const { result } = compileRust({ surfaces: ["js"], files: {
    "index.ts": mixedWidthRecordSource.replace("flags: uint32 }", "flags: int32 }"),
  } });
  assert.ok(result.diagnostics.length > 0);
  assert.equal(result.artifacts.length, 0);
});
