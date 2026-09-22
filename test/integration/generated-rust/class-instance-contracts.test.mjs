import assert from "node:assert/strict";
import test from "node:test";
import { classInstanceContractSource } from "../../../../tsonic/test/fixtures/class-instance-contracts.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [undefined, ["js"]]) {
  test(`class instance contracts preserve real ancestry in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "class_instance_contracts" } },
      files: { "index.ts": `${classInstanceContractSource}
export function main(): void { if (!run()) throw new Error("class instance contract"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject("class-instance-contracts", result.artifacts, { run: true }).status, 0);
  });
}
