import assert from "node:assert/strict";
import test from "node:test";
import { boundMemoryRecordProofFiles } from "../../../../../tsonic/test/fixtures/bound-memory-records.mjs";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { memoryAbiCapability } from "../../../helpers/memory-abi.mjs";

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
