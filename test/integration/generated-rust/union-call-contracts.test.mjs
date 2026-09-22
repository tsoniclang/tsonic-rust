import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, createRustSession, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { unionCallContractsFiles, incompatibleUnionCalls } from "../../../../tsonic/test/fixtures/union-call-contracts.mjs";

test("union calls compose generic, default, rest and async contracts without dispatch closures", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "union_call_contracts" } },
    files: { ...unionCallContractsFiles, "index.ts": `${unionCallContractsFiles["index.ts"]}
export async function main(): Promise<void> {
  if (!await run()) throw new Error("union call contracts");
}` },
  });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject("union-call-contracts", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  const source = result.artifacts.map(artifact => artifact.text).join("\n");
  assert.match(source, /match &/u);
  for (const sourceText of incompatibleUnionCalls) {
    const diagnostics = rustSourceDiagnostics(createRustSession({ surfaces: ["js"], files: { "index.ts": sourceText } }));
    assert.match(diagnostics, /error TS/u);
  }
});
