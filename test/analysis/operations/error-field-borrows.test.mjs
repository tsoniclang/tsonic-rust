import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  for (const property of ["name", "message", "stack"]) {
    const output = property === "stack" ? "string | undefined" : "string";
    for (const [form, source] of [
      ["parameter", `export function read(error: Error): ${output} { return error.${property}; }`],
      ["capture", `export function read(error: Error): ${output} { const observed = (): ${output} => error.${property}; return observed(); }`],
      ["closed", `export function read(error: Error | string): ${output} { if (typeof error === "string") return error; return error.${property}; }`],
    ]) {
      test(`Error ${property} ${form} observation keeps its exact native shared input on ${surfaces[0] ?? "native"}`, () => {
        const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
        const selected = [];
        const visit = node => {
          const field = program.records.errorFieldEmission.get(node);
          if (field?.kind === "property" && field.property === property) selected.push(field);
          program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
        };
        for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
        assert.equal(selected.length, 1, "the authored observation has one physical field owner");
        const field = selected[0];
        const read = program.records.readOwnership.get(field.receiver);
        assert.equal(read !== undefined, true, "the exact checked receiver has a sealed physical read");
        assert.equal(read.source.kind, "borrow", "ErrorObject observation shares its receiver without cloning or moving its owner");
        assert.equal(field.guarded, property === "stack" || field.shared, "the selected native field guard is preserved");
        assert.equal(field.expression !== undefined && field.receiver !== undefined, true,
          "the exact observation and original receiver remain in the one existing record family");
      });
    }
  }
}
