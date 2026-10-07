import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("retained async and generator inputs keep owned carriers without disabling synchronous borrows", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "readers.ts": `
      export function read(value: string): number { return value.length; }
      export async function later(value: string): Promise<number> {
        await Promise.resolve(undefined);
        return value.length;
      }
      export function forward(value: string): Promise<number> { return later(value); }
      export function* sequence(value: string): Generator<number, void, void> { yield value.length; }
    `, "index.ts": `
      import { read, later, forward, sequence } from "./readers.js";
      function retained(): Promise<number> { const value = "retained"; return later(value); }
      export async function main(): Promise<void> {
        const ordinary = "read";
        if (read(ordinary) !== 4 || ordinary !== "read") throw new Error("synchronous borrow");
        const pending = retained();
        if (await pending !== 8 || await forward("forward") !== 7) throw new Error("owned future");
        let total = 0;
        for (const value of sequence("generator")) total += value;
        if (total !== 9) throw new Error("owned generator");
      }
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const readers = artifactText(result, "src/readers.rs");
  assert.match(readers, /fn read\(value: &(?:String|str)\)/);
  for (const name of ["later", "forward", "sequence"]) assert.match(readers, new RegExp(`fn ${name}\\(value: String\\)`));
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /later\(value\.clone\(\)\)/);
  validateGeneratedProject("suspended-owned-parameters", result.artifacts, { run: true });
});
