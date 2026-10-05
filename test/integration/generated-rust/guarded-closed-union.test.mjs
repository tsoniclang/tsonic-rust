import assert from "node:assert/strict";
import test from "node:test";
import { guardedClosedUnionFiles } from "../../../../tsonic/test/fixtures/guarded-closed-union.mjs";
import { compileRust, nodejsCapability, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native guards retain every surviving cross-file union arm before explicit JSON conversion", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } }, files: guardedClosedUnionFiles });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 4).map(row => `${row.code}: ${row.message.slice(0, 256)}`).join("\n"));
  assert.equal(/js_value_from_closed\(&.*(?:Buffer|Uint8Array)/u.test(rustSourceText(result)), false,
    "excluded byte carriers must not be boxed to repair missing flow selection");
  validateGeneratedProject("guarded-closed-union", result.artifacts, { run: true });
});
