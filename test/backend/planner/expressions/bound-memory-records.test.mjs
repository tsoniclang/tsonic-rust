import assert from "node:assert/strict";
import test from "node:test";
import { boundMemoryRecordProofFiles } from "../../../../../tsonic/test/fixtures/bound-memory-records.mjs";
import { emptyMemoryRecordProofFiles } from "../../../../../tsonic/test/fixtures/empty-memory-records.mjs";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { memoryAbiCapability } from "../../../helpers/memory-abi.mjs";

for (const surfaces of [undefined, ["js"]]) {
  test(`empty memory records preserve zero-field bindings in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const files = emptyMemoryRecordProofFiles(surfaces?.includes("js") === true);
    const { result } = compileRust({ surfaces, capabilities: [memoryAbiCapability("rust")],
      target: { id: "rust", options: { outputType: "bin", crateName: "empty_memory_records" } },
      files: { ...files, "index.ts": `${files["index.ts"]}
export function main(): void { if (!run()) throw new Error("empty bound record contract"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`empty-memory-records-${surfaces?.[0] ?? "native"}`, result.artifacts, { run: true }).status, 0);
  });
}

for (const valueRepresentation of [false, true]) {
  for (const surfaces of [undefined, ["js"]]) {
    const label = `${valueRepresentation ? "value" : "reference"}-${surfaces?.[0] ?? "native"}`;
    test(`bound records retain live field locations, ownership and errors in ${label}`, { timeout: 300_000 }, () => {
      const files = boundMemoryRecordProofFiles(valueRepresentation);
      const { result } = compileRust({ surfaces, capabilities: [memoryAbiCapability("rust")],
        target: { id: "rust", options: { outputType: "bin", crateName: "bound_memory_records" } },
        files: { ...files, "index.ts": `${files["index.ts"]}
export function main(): void { if (!run()) throw new Error("live bound record contract"); }` },
      });
      assert.deepEqual(result.diagnostics, []);
      assert.equal(validateGeneratedProject(`bound-records-${label}`, result.artifacts, { run: true }).status, 0);
    });
  }
}
