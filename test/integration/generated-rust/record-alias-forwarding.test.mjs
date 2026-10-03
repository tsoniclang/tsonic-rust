import assert from "node:assert/strict";
import test from "node:test";
import { recordAliasForwardingFiles, recordAliasListenerFiles } from "../../../../tsonic/test/fixtures/record-alias-forwarding.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surface of [undefined, "js"]) {
  test(`record alias forwarding retains indexed storage on ${surface ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === undefined ? [] : [surface],
      target: { id: "rust", options: { outputType: "bin", crateName: "record_alias_forwarding" } },
      files: { ...recordAliasForwardingFiles, "index.ts": `${recordAliasForwardingFiles["index.ts"]}
        export function main(): void { if (!run()) throw new Error("record alias forwarding"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject(`record-alias-forwarding-${surface ?? "native"}`, result.artifacts, { run: true });
  });
}

test("record aliases retain generic rest-callable array storage on JS", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "record_alias_listeners" } },
    files: { ...recordAliasListenerFiles, "index.ts": `${recordAliasListenerFiles["index.ts"]}
      export function main(): void { if (!run()) throw new Error("record alias listeners"); }` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  validateGeneratedProject("record-alias-listeners-js", result.artifacts, { run: true });
});
